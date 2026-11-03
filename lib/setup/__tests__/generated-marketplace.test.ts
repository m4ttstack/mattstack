import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathToFileURL } from "url";
import { generatedMarketplaceDir, orgDirUnder } from "../../rt-paths.ts";
import { renderGeneratedMarketplace, writeGeneratedMarketplace } from "../generated-marketplace.ts";
import { PACK_EXEC_TIMEOUT_MS } from "../pack-cache.ts";
import { fakeProbes } from "./fakes.ts";

const home = "/h";
const clone = orgDirUnder(home, "acme");
const orgFile = JSON.stringify({
  name: "acme",
  owner: { name: "Acme" },
  plugins: [
    { name: "widgets", source: "./mattstack/teams/widgets/plugin", description: "w" },
    { name: "remote", source: { source: "github", repo: "x/y" } },
    { name: "escape", source: "./../outside" },
  ],
});

describe("renderGeneratedMarketplace", () => {
  test("turns each ./ source into a git-subdir entry on this clone at the ref, keeping the name and other fields", () => {
    const out = renderGeneratedMarketplace(orgFile, clone, "mattstack");
    const parsed = JSON.parse(out.json!);
    expect(parsed.name).toBe("acme");
    expect(parsed.owner).toEqual({ name: "Acme" });
    expect(parsed.plugins).toEqual([
      { name: "widgets", description: "w", source: { source: "git-subdir", url: pathToFileURL(clone).href, path: "mattstack/teams/widgets/plugin", ref: "mattstack" } },
    ]);
    expect(out.dropped).toHaveLength(2);
    expect(out.dropped[0]).toContain("remote");
    expect(out.dropped[1]).toContain("escape");
  });

  test("an org file with no plugins still renders, so a new team's pack can be added later", () => {
    const out = renderGeneratedMarketplace(JSON.stringify({ name: "acme", plugins: [] }), clone, "main");
    expect(JSON.parse(out.json!)).toEqual({ name: "acme", owner: { name: "acme" }, plugins: [] });
  });

  test("an unparseable or nameless org file renders nothing", () => {
    expect(renderGeneratedMarketplace("{ broken", clone, "main").json).toBeNull();
    expect(renderGeneratedMarketplace(JSON.stringify({ plugins: [] }), clone, "main").json).toBeNull();
  });
});

describe("writeGeneratedMarketplace", () => {
  const target = join(generatedMarketplaceDir(home, "acme"), ".claude-plugin", "marketplace.json");
  const marker = join(clone, "mattstack", "mattstack.jsonc");

  test("reads the org file at the data branch with git show, writes atomically, and only on change", async () => {
    const p = fakeProbes({
      home,
      files: { [marker]: JSON.stringify({ role: "org", org: "acme", layout: 5, dataBranch: "mattstack" }) },
      exec: () => ({ code: 0, stdout: orgFile, stderr: "" }),
    });
    const first = await writeGeneratedMarketplace(p, "acme");
    expect(first).toMatchObject({ path: generatedMarketplaceDir(home, "acme"), changed: true });
    expect(p.calls.exec[0]).toEqual(["git", "-C", clone, "show", "mattstack:.claude-plugin/marketplace.json"]);
    expect(p.calls.renames.at(-1)![1]).toBe(target);
    expect(JSON.parse(p.readFile(target)!).plugins[0].source.ref).toBe("mattstack");

    const second = await writeGeneratedMarketplace(p, "acme");
    expect(second.changed).toBe(false);
    expect(p.calls.renames).toHaveLength(1);
  });

  test("a layout 3 org with no data branch reads main", async () => {
    const p = fakeProbes({ home, exec: () => ({ code: 0, stdout: orgFile, stderr: "" }) });
    await writeGeneratedMarketplace(p, "acme");
    expect(p.calls.exec[0]).toEqual(["git", "-C", clone, "show", "main:.claude-plugin/marketplace.json"]);
  });

  test("the git show is bounded, since the daemon runs it on every pull", async () => {
    const timeouts: (number | undefined)[] = [];
    const p = fakeProbes({ home, exec: (_argv, o) => { timeouts.push(o?.timeoutMs); return { code: 0, stdout: orgFile, stderr: "" }; } });
    await writeGeneratedMarketplace(p, "acme");
    expect(timeouts).toEqual([PACK_EXEC_TIMEOUT_MS]);
  });

  test("a clone without the file at the ref is skipped, not thrown", async () => {
    const p = fakeProbes({ home, exec: () => ({ code: 128, stdout: "", stderr: "fatal: invalid object name" }) });
    const res = await writeGeneratedMarketplace(p, "acme");
    expect(res.changed).toBe(false);
    expect(res.skipped).toContain("main");
    expect(p.calls.renames).toHaveLength(0);
  });
});
