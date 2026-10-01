import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initFailure, initMaterializeVerdict, initOutcomeBlocks, initRefusalBlocks, parseInitArgs, skillsInit } from "../skills-init.ts";
import type { InitDeps, InitOutcome } from "../../lib/skills/init.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";

describe("parseInitArgs", () => {
  test("defaults: cwd repo, no zone, human output", () => {
    expect(parseInitArgs([])).toEqual({ repo: process.cwd(), zone: null, json: false });
  });
  test("reads every flag", () => {
    expect(parseInitArgs(["--repo", "/r", "--zone", "z", "--json"])).toEqual({ repo: "/r", zone: "z", json: true });
  });
  test("a flag without a value throws a usage error", () => {
    expect(() => parseInitArgs(["--zone"])).toThrow(/--zone needs a value/);
  });
  test("--pack is not an argument", () => {
    expect(() => parseInitArgs(["--pack", "x"])).toThrow(/unrecognized argument "--pack"/);
  });
});

describe("init outcome", () => {
  const okOutcome = {
    ok: true as const,
    pack: { name: "acme", dir: "/z/mattstack/packs/acme", zone: "acme", marketplace: "acme" },
    repo: { slug: "gitlab.com-acme-api", manifest: "/h/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc" },
    wrote: ["/z/mattstack/packs/acme/pack/stubs.jsonc"],
    installed: { plugin: "acme@acme", version: "0.1.0" },
    restartNeeded: true as const,
    tryNext: "/acme:work <ticket>",
  } satisfies InitOutcome;

  test("success names the pack, where things are, and what to try next", () => {
    const text = renderPlain(initOutcomeBlocks(okOutcome));
    expect(text.split("\n")[0]).toBe(`[ok] Created the ${okOutcome.pack.name} pack  ${okOutcome.pack.dir}`);
    expect(text).toContain(`Zone: ${okOutcome.pack.zone}\n`);
    expect(text).toContain(`Installed: ${okOutcome.installed.plugin} ${okOutcome.installed.version}\n`);
    expect(text).toContain(`  next: Run /reload-plugins in your Claude session, then try ${okOutcome.tryNext}\n`);
    expect(text).not.toContain("restart");
  });

  test("a policy refusal is a refused line, with its command as next", () => {
    expect(
      renderPlain(
        initRefusalBlocks({
          ok: false,
          refused: true,
          code: "zone-has-pack",
          detail: "The acme zone already has a team pack, and a zone holds only one (a base pack can sit beside it)",
          next: "rt team create <name> --remote <url>",
        }),
      ),
    ).toBe(
      "[refused] The acme zone already has a team pack, and a zone holds only one (a base pack can sit beside it)\n  next: rt team create <name> --remote <url>\n",
    );
  });

  test("a refusal that is not a policy one is a failure, its command as next", () => {
    const failure = initFailure({ ok: false, refused: true, code: "zone-ambiguous", detail: "More than one team zone could hold this pack: acme, beta", next: "rt skills init --zone <slug>" });
    expect(renderPlain([ui.failure(failure)])).toBe("More than one team zone could hold this pack: acme, beta\n  next: rt skills init --zone <slug>\n");
  });

  test("a failure names each command of its remedy, then what was written", () => {
    const failure = initFailure({
      ok: false,
      refused: false,
      code: "compile-failed",
      detail: "boom",
      wrote: ["/a", "/b"],
      remedy: { commands: ["rt skills compile --pack-dir /z/mattstack/packs/acme", "rt skills check --pack-dir /z/mattstack/packs/acme"] },
    });
    expect(renderPlain([ui.failure(failure)])).toBe(
      "boom\n  next: Run rt skills compile --pack-dir /z/mattstack/packs/acme, then rt skills check --pack-dir /z/mattstack/packs/acme\n  Written so far:\n  /a\n  /b\n",
    );
  });

  test("a write failure says to delete the folder it started, then run init again", () => {
    const failure = initFailure({
      ok: false,
      refused: false,
      code: "write-failed",
      detail: "disk full",
      wrote: ["/z/mattstack/packs/acme/.claude-plugin/plugin.json"],
      remedy: { commands: ["rt skills init"], folder: "/z/mattstack/packs/acme" },
    });
    expect(renderPlain([ui.failure(failure)])).toBe(
      "disk full\n  next: Delete the pack folder it started, then run rt skills init\n  Pack folder: /z/mattstack/packs/acme\n  Written so far:\n  /z/mattstack/packs/acme/.claude-plugin/plugin.json\n",
    );
  });

  test("with no remedy, the next step is the general one", () => {
    expect(renderPlain([ui.failure(initFailure({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: [] }))])).toBe(
      "boom\n  next: Fix it, then run rt skills compile and rt skills check\n",
    );
  });
});

function stubDeps(overrides: Partial<InitDeps> = {}): InitDeps {
  return {
    fs: { exists: () => false, readFile: () => null, writeFile: () => {}, mkdirp: () => {}, readDir: () => [] },
    home: "/h",
    gitRemote: async () => ({ kind: "no-remote" }),
    isTTY: false,
    promptZone: async () => { throw new Error("promptZone should not be called"); },
    createZone: async () => { throw new Error("createZone should not be called"); },
    engineDescription: () => "engine description",
    claude: async () => ({ code: 0, stdout: "", stderr: "" }),
    registerRepo: async () => "repo-slug",
    materialize: async () => ({ ok: true, detail: "materialized" }),
    compile: async () => ({ ok: true, errors: [] }),
    check: async () => ({ drift: false }),
    ...overrides,
  };
}

function memFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  return {
    exists: (p: string) => store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/")),
    readFile: (p: string) => store.get(p) ?? null,
    writeFile: (p: string, text: string) => { store.set(p, text); },
    mkdirp: () => {},
    readDir: (p: string) => {
      const names = new Set<string>();
      for (const k of store.keys()) {
        if (!k.startsWith(p + "/")) continue;
        names.add(k.slice(p.length + 1).split("/")[0]!);
      }
      return [...names];
    },
  };
}

describe("skillsInit", () => {
  let io: ReturnType<typeof captureSkills>;
  beforeEach(() => {
    io = captureSkills();
  });

  afterEach(() => {
    io.restore();
    // Bun's process.exitCode setter ignores undefined; only 0 clears it.
    process.exitCode = 0;
  });

  test("a plain refusal (no-remote) is a failure on stderr and exits 2", async () => {
    await skillsInit([], {}, stubDeps());
    expect(io.stdout()).toBe("");
    expect(io.errLines()).toHaveLength(1);
    expect(io.stderr()).not.toContain("rt skills init:");
    expect(io.stderr()).not.toContain("[refused]");
    expect(process.exitCode).toBe(2);
  });

  test("a policy refusal is a refused note on stderr, exit 2", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "acme", "org": "x" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/api"] }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/pack/stubs.jsonc`]: "{}",
    });
    await skillsInit([], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    expect(io.stdout()).toBe("");
    expect(io.errLines()[0]).toStartWith("[refused] This zone already has a pack for this repo");
    expect(io.stderr()).not.toContain("[failed]");
    expect(process.exitCode).toBe(2);
  });

  test("--json: a thrown UserActionableError from the zone-creation prompt path refuses cleanly", async () => {
    const deps = stubDeps({
      gitRemote: async () => ({ kind: "ok", url: "https://gitlab.com/acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "" }),
      createZone: async () => {
        throw new UserActionableError("remote-required", "a remote is required");
      },
    });
    await skillsInit(["--json"], {}, deps);
    expect(io.lines()).toHaveLength(1);
    const printed = JSON.parse(io.lines()[0]!);
    expect(printed.error.code).toBe("remote-required");
    expect(printed.error.message).toBe("a remote is required");
    expect(printed.error.refused).toBe(true);
    expect(process.exitCode).toBe(2);
  });

  test("without --json, the same crash-path refusal prints the message as a failure", async () => {
    const deps = stubDeps({
      gitRemote: async () => ({ kind: "ok", url: "https://gitlab.com/acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "" }),
      createZone: async () => {
        throw new UserActionableError("remote-required", "a remote is required");
      },
    });
    await skillsInit([], {}, deps);
    expect(io.stderr()).toBe("a remote is required\n");
    expect(io.stdout()).toBe("");
    expect(process.exitCode).toBe(2);
  });

  test("--json: a usage error from parseInitArgs prints envelope({ error })", async () => {
    await skillsInit(["--zone", "--json"], {}, stubDeps());
    expect(io.lines()).toHaveLength(1);
    const printed = JSON.parse(io.lines()[0]!);
    expect(printed.error.code).toBe("usage");
    expect(printed.error.message).toMatch(/--zone needs a value/);
    expect(process.exitCode).toBe(2);
  });

  test("--json: a post-write compile failure envelope carries the wrote list", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "acme", "org": "x" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": [] }`,
      [`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`]: `{ "name": "acme-market", "owner": { "name": "acme" }, "plugins": [] }`,
    });
    const deps = stubDeps({
      fs,
      home: HOME,
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
      engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null),
      claude: async () => ({ code: 0, stdout: "", stderr: "" }),
      registerRepo: async () => "gitlab.com/acme/api",
      materialize: async () => {
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc`, "{}");
        return { ok: true, detail: "merged" };
      },
      compile: async () => ({ ok: false, errors: ["boom"] }),
      check: async () => ({ drift: false }),
    });
    await skillsInit(["--json"], {}, deps);
    expect(io.lines()).toHaveLength(1);
    const printed = JSON.parse(io.lines()[0]!);
    expect(printed.error.code).toBe("compile-failed");
    expect(printed.error.message).toContain("boom");
    expect(printed.error.refused).toBe(false);
    expect(Array.isArray(printed.error.wrote)).toBe(true);
    expect(printed.error.wrote.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });
});

describe("initMaterializeVerdict", () => {
  const written = (pack: string) => ({ pack, zone: "acme", ok: true as const, path: `/h/${pack}/skills.jsonc`, layers: ["pack"] });
  const broken = (pack: string, detail: string) => ({ pack, zone: "acme-gadgets", ok: false as const, detail });

  test("a sibling pack's failure is a warning; the new pack's own outcome decides", () => {
    const verdict = initMaterializeVerdict(
      { skipped: false, repos: [{ name: "repo-a", path: "/r/a", ok: false, detail: "gadgets: boom", packs: [written("widgets"), broken("gadgets", "boom")] }] },
      "widgets",
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings).toEqual(["gadgets (repo-a): boom"]);
  });

  test("the new pack's own failure is materialize-failed material", () => {
    const verdict = initMaterializeVerdict(
      { skipped: false, repos: [{ name: "repo-a", path: "/r/a", ok: false, detail: "widgets: boom", packs: [broken("widgets", "boom")] }] },
      "widgets",
    );
    expect(verdict).toEqual({ ok: false, detail: "widgets (repo-a): boom", warnings: [], pruneWarnings: [] });
  });

  test("no outcome for the new pack carries the row's own detail", () => {
    const verdict = initMaterializeVerdict(
      { skipped: false, repos: [{ name: "repo-a", path: "/r/a", ok: false, noManifest: true, detail: "no team declares gitlab.example.com/acme/widgets" }] },
      "widgets",
    );
    expect(verdict).toEqual({ ok: false, detail: "no team declares gitlab.example.com/acme/widgets", warnings: [], pruneWarnings: [] });
  });

  test("a skipped run fails with its reason", () => {
    expect(initMaterializeVerdict({ skipped: true, reason: "engine-pack-missing", repos: [] }, "widgets")).toEqual({ ok: false, detail: "engine-pack-missing", warnings: [], pruneWarnings: [] });
  });

  test("a stale file that could not be set aside is a prune warning, and the pack still succeeds", () => {
    const verdict = initMaterializeVerdict(
      { skipped: false, repos: [{ name: "repo-a", path: "/r/a", ok: true, detail: "wrote 1 pack file: widgets", packs: [written("widgets")], pruneWarnings: ["could not set aside /h/gadgets/skills.jsonc: EACCES"] }] },
      "widgets",
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.pruneWarnings).toEqual(["could not set aside /h/gadgets/skills.jsonc: EACCES"]);
  });
});
