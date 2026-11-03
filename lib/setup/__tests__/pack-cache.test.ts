import { describe, test, expect } from "bun:test";
import { join } from "path";
import { fakeProbes, gitShowFromFiles } from "./fakes.ts";
import { PACK_EXEC_TIMEOUT_MS, parsePluginList, readServedPacks } from "../pack-cache.ts";

const home = "/fake-home";
const clone = join(home, ".mattstack", "orgs", "acme");
const marketplacePath = join(clone, ".claude-plugin", "marketplace.json");

describe("parsePluginList", () => {
  test("keeps id, version and enabled", () => {
    const out = JSON.stringify([{ id: "a@m", version: "1.2.0", enabled: true }]);
    expect(parsePluginList(out)).toEqual([{ id: "a@m", version: "1.2.0", enabled: true }]);
  });

  test("a missing string id rejects the WHOLE payload, not just that element", () => {
    const out = JSON.stringify([{ id: "a@m", enabled: true }, { enabled: false }]);
    expect(parsePluginList(out)).toBeNull();
  });

  test("a missing enabled normalizes to false; a missing version to null", () => {
    expect(parsePluginList(JSON.stringify([{ id: "a@m" }]))).toEqual([{ id: "a@m", version: null, enabled: false }]);
  });

  test("unparsable or non-array output is null", () => {
    expect(parsePluginList("not json")).toBeNull();
    expect(parsePluginList(JSON.stringify({ id: "a@m" }))).toBeNull();
  });
});

describe("readServedPacks", () => {
  /** Plugin files are answered through `git show` at any ref, as if the working tree matched it. */
  const probes = (files: Record<string, string> = {}) =>
    fakeProbes({ home, files, exec: (argv) => gitShowFromFiles(files, argv) ?? { code: 0, stdout: "", stderr: "" } });

  test("an absent marketplace.json is not an error", async () => {
    expect(await readServedPacks(probes(), "acme")).toEqual({ packs: [], error: null });
  });

  test("an unparsable marketplace.json reports an error rather than vanishing", async () => {
    const result = await readServedPacks(probes({ [marketplacePath]: "{ broken" }), "acme");
    expect(result.packs).toEqual([]);
    expect(result.error).toContain(marketplacePath);
  });

  test("a string source resolves the served version from the pack's plugin.json", async () => {
    const p = probes({
      [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "acme-skills", source: "./packs/acme-skills" }] }),
      [join(clone, "packs", "acme-skills", ".claude-plugin", "plugin.json")]: JSON.stringify({ version: "0.5.28" }),
    });
    expect(await readServedPacks(p, "acme")).toEqual({
      packs: [{ id: "acme-skills@acme-market", name: "acme-skills", servedVersion: "0.5.28", floor: null }],
      error: null,
    });
  });

  test("a served pack carries the floor in its pack/requires.json", async () => {
    const p = probes({
      [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "acme-skills", source: "./packs/acme-skills" }] }),
      [join(clone, "packs", "acme-skills", ".claude-plugin", "plugin.json")]: JSON.stringify({ version: "0.6.0" }),
      [join(clone, "packs", "acme-skills", "pack", "requires.json")]: JSON.stringify({ minEngine: "0.31.0" }),
    });
    expect((await readServedPacks(p, "acme")).packs[0]).toEqual({ id: "acme-skills@acme-market", name: "acme-skills", servedVersion: "0.6.0", floor: "0.31.0" });
  });

  /** Answers `git show` from `atRef` alone, keyed `<ref>:<path>`; anything else is a path the ref does not carry. */
  function refProbes(files: Record<string, string>, atRef: Record<string, string>, fail: Record<string, { code: number; stderr: string }> = {}) {
    const shows: { spec: string; timeoutMs: number | undefined }[] = [];
    const p = fakeProbes({
      home,
      files,
      exec: (argv, o) => {
        if (argv[0] !== "git" || argv[3] !== "show") return { code: 1, stdout: "", stderr: "" };
        expect(argv.slice(0, 3)).toEqual(["git", "-C", clone]);
        const spec = argv[4]!;
        shows.push({ spec, timeoutMs: o?.timeoutMs });
        const broken = fail[spec];
        if (broken) return { code: broken.code, stdout: "", stderr: broken.stderr };
        const text = atRef[spec];
        const [ref, path] = spec.split(":");
        return text === undefined ? { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in '${ref}'` } : { code: 0, stdout: text, stderr: "" };
      },
    });
    return { p, shows };
  }

  const recordPath = join(home, ".mattstack", "rt", "teams", "acme.json");

  test("the version and floor come from the data branch, not a working tree ahead of it", async () => {
    const pluginRel = "mattstack/teams/widgets/plugin";
    const files = {
      [marketplacePath]: JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: `./${pluginRel}` }] }),
      [recordPath]: JSON.stringify({ dataBranch: "mattstack" }),
      [join(clone, pluginRel, ".claude-plugin", "plugin.json")]: JSON.stringify({ version: "2.0.0" }),
      [join(clone, pluginRel, "pack", "requires.json")]: JSON.stringify({ minEngine: "9.0.0" }),
    };
    const atRef: Record<string, string> = {
      "mattstack:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: `./${pluginRel}` }] }),
      [`mattstack:${pluginRel}/.claude-plugin/plugin.json`]: JSON.stringify({ version: "1.0.0" }),
      [`mattstack:${pluginRel}/pack/requires.json`]: JSON.stringify({ minEngine: "0.30.0" }),
    };
    const { p, shows } = refProbes(files, atRef);
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: "1.0.0", floor: "0.30.0" }]);
    expect(shows.map((s) => s.spec).sort()).toEqual(Object.keys(atRef).sort());
  });

  test("the entries and the marketplace name come from the data branch too", async () => {
    const files = {
      [marketplacePath]: JSON.stringify({ name: "renamed", plugins: [{ name: "widgets", source: "./packs/widgets" }, { name: "gadgets", source: "./packs/gadgets" }] }),
      [recordPath]: JSON.stringify({ dataBranch: "mattstack" }),
    };
    const { p } = refProbes(files, {
      "mattstack:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }),
      "mattstack:packs/widgets/.claude-plugin/plugin.json": JSON.stringify({ version: "1.0.0" }),
    });
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: "1.0.0", floor: null }]);
  });

  test("a data branch with no marketplace.json serves nothing, though the working tree has one", async () => {
    const { p } = refProbes({ [marketplacePath]: JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }) }, {});
    expect(await readServedPacks(p, "acme")).toEqual({ packs: [], error: null });
  });

  test("a marketplace.json git could not read is an error, not an empty catalog", async () => {
    const { p } = refProbes({}, {}, { "main:.claude-plugin/marketplace.json": { code: 124, stderr: "" } });
    const result = await readServedPacks(p, "acme");
    expect(result.packs).toEqual([]);
    expect(result.error).toContain("main");
  });

  test("a pack the data branch does not carry yet reads with no version, though the working tree has one", async () => {
    const { p } = refProbes(
      { [join(clone, "packs", "widgets", ".claude-plugin", "plugin.json")]: JSON.stringify({ version: "1.0.0" }) },
      { "main:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }) },
      { "main:packs/widgets/.claude-plugin/plugin.json": { code: 128, stderr: "fatal: path 'packs/widgets/.claude-plugin/plugin.json' exists on disk, but not in 'main'" } },
    );
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: null, floor: null }]);
  });

  test("a floor git could not read leaves the version unknown, so no update gets past the floor", async () => {
    const { p } = refProbes({}, {
      "main:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }),
      "main:packs/widgets/.claude-plugin/plugin.json": JSON.stringify({ version: "2.0.0" }),
    }, { "main:packs/widgets/pack/requires.json": { code: 128, stderr: "fatal: unable to read 1234abcd" } });
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: null, floor: null }]);
  });

  test("a manifest git could not read leaves the version unknown", async () => {
    const { p } = refProbes({}, {
      "main:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }),
    }, { "main:packs/widgets/.claude-plugin/plugin.json": { code: 124, stderr: "" } });
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: null, floor: null }]);
  });

  test("every git show is bounded, since the daemon runs them on every pull", async () => {
    const { p, shows } = refProbes({}, {
      "main:.claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./packs/widgets" }] }),
      "main:packs/widgets/.claude-plugin/plugin.json": JSON.stringify({ version: "1.0.0" }),
    });
    await readServedPacks(p, "acme");
    expect(shows).toHaveLength(3);
    expect(shows.every((s) => s.timeoutMs === PACK_EXEC_TIMEOUT_MS)).toBe(true);
  });

  test("a source that climbs out of the clone is never shown and reads with no version", async () => {
    const p = probes({ [marketplacePath]: JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "../elsewhere" }] }) });
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "widgets@acme", name: "widgets", servedVersion: null, floor: null }]);
    expect(p.calls.exec).toEqual([["git", "-C", clone, "show", "main:.claude-plugin/marketplace.json"]]);
  });

  test("an object-form source is listed with a null served version", async () => {
    const p = probes({ [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "remote", source: { source: "github", repo: "o/r" } }] }) });
    expect(await readServedPacks(p, "acme")).toEqual({
      packs: [{ id: "remote@acme-market", name: "remote", servedVersion: null, floor: null }],
      error: null,
    });
  });

  test("a missing or unparsable plugin.json yields a null served version, not a dropped pack", async () => {
    const p = probes({ [marketplacePath]: JSON.stringify({ name: "acme-market", plugins: [{ name: "acme-skills", source: "./packs/acme-skills" }] }) });
    expect((await readServedPacks(p, "acme")).packs).toEqual([{ id: "acme-skills@acme-market", name: "acme-skills", servedVersion: null, floor: null }]);
  });

  test("the marketplace name falls back to the slug when the file omits it", async () => {
    const p = probes({ [marketplacePath]: JSON.stringify({ plugins: [{ name: "p", source: { source: "url" } }] }) });
    expect((await readServedPacks(p, "acme")).packs[0]!.id).toBe("p@acme");
  });
});
