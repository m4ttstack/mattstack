import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { initMaterializeVerdict, parseInitArgs, renderInitOutcome, skillsInit } from "../skills-init.ts";
import type { InitDeps, InitOutcome } from "../../lib/skills/init.ts";
import { UserActionableError } from "../../lib/errors.ts";

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

describe("renderInitOutcome", () => {
  const okOutcome: InitOutcome = {
    ok: true,
    pack: { name: "acme", dir: "/z/mattstack/packs/acme", zone: "acme", marketplace: "acme" },
    repo: { slug: "gitlab.com-acme-api", manifest: "/h/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc" },
    wrote: ["/z/mattstack/packs/acme/pack/stubs.jsonc"],
    installed: { plugin: "acme@acme", version: "0.1.0" },
    restartNeeded: true,
    tryNext: "/acme:work <ticket>",
  };
  test("human output names the pack dir, /reload-plugins, and what to try", () => {
    const text = renderInitOutcome(okOutcome);
    expect(text).toContain("/z/mattstack/packs/acme");
    expect(text).toContain("/reload-plugins");
    expect(text).not.toContain("restart");
    expect(text).toContain("/acme:work <ticket>");
  });
  test("a refusal renders as rt skills init: <detail>", () => {
    const text = renderInitOutcome({ ok: false, refused: true, code: "pack-exists", detail: "exists" });
    expect(text).toBe("rt skills init: exists");
  });
  test("a failure lists what was written", () => {
    const text = renderInitOutcome({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: ["/a", "/b"] });
    expect(text).toContain("boom");
    expect(text).toContain("/a");
    expect(text).toContain("/b");
  });
  test("a failure with a remedy prints the remedy in place of the generic advice", () => {
    const text = renderInitOutcome({
      ok: false,
      refused: false,
      code: "compile-failed",
      detail: "boom",
      wrote: ["/a"],
      remedy: "then: rt skills compile --pack-dir /z/mattstack/packs/acme and rt skills check --pack-dir /z/mattstack/packs/acme",
    });
    expect(text).toContain("rt skills compile --pack-dir /z/mattstack/packs/acme");
    expect(text).toContain("rt skills check --pack-dir /z/mattstack/packs/acme");
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

describe("skillsInit", () => {
  afterEach(() => {
    // Bun's process.exitCode setter ignores undefined; only 0 clears it.
    process.exitCode = 0;
  });

  test("a plain refusal (no-remote) prints the human message and exits 2", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await skillsInit([], {}, stubDeps());
      expect(logSpy.mock.calls.length).toBe(1);
      expect(String(logSpy.mock.calls[0]?.[0])).toContain("rt skills init:");
      expect(process.exitCode).toBe(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("--json: a thrown UserActionableError from the zone-creation prompt path refuses cleanly", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = stubDeps({
      gitRemote: async () => ({ kind: "ok", url: "https://gitlab.com/acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "" }),
      createZone: async () => {
        throw new UserActionableError("remote-required", "a remote is required");
      },
    });
    try {
      await skillsInit(["--json"], {}, deps);
      expect(logSpy.mock.calls.length).toBe(1);
      const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(printed.error.code).toBe("remote-required");
      expect(printed.error.message).toBe("a remote is required");
      expect(printed.error.refused).toBe(true);
      expect(process.exitCode).toBe(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("without --json, the same crash-path refusal prints rt skills init: <message>", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const deps = stubDeps({
      gitRemote: async () => ({ kind: "ok", url: "https://gitlab.com/acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "" }),
      createZone: async () => {
        throw new UserActionableError("remote-required", "a remote is required");
      },
    });
    try {
      await skillsInit([], {}, deps);
      expect(errorSpy).toHaveBeenCalledWith("rt skills init: a remote is required");
      expect(process.exitCode).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("--json: a usage error from parseInitArgs prints envelope({ error })", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await skillsInit(["--zone", "--json"], {}, stubDeps());
      expect(logSpy.mock.calls.length).toBe(1);
      const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(printed.error.code).toBe("usage");
      expect(printed.error.message).toMatch(/--zone needs a value/);
      expect(process.exitCode).toBe(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("--json: a post-write compile failure envelope carries the wrote list", async () => {
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
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await skillsInit(["--json"], {}, deps);
      expect(logSpy.mock.calls.length).toBe(1);
      const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(printed.error.code).toBe("compile-failed");
      expect(printed.error.message).toContain("boom");
      expect(printed.error.refused).toBe(false);
      expect(Array.isArray(printed.error.wrote)).toBe(true);
      expect(printed.error.wrote.length).toBeGreaterThan(0);
      expect(process.exitCode).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
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
