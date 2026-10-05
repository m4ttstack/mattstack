import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initFailure, initFailureAfter, initMaterializeVerdict, initOutcomeBlocks, initRefusalBlocks, parseInitArgs, repoListFailure, skillsInit } from "../skills-init.ts";
import * as syncCommand from "../skills-sync.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { InitDeps, InitOutcome } from "../../lib/skills/init.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";

describe("parseInitArgs", () => {
  test("defaults: cwd repo, no zone, no team, human output", () => {
    expect(parseInitArgs([])).toEqual({ repo: process.cwd(), zone: null, team: null, json: false });
  });
  test("reads every flag", () => {
    expect(parseInitArgs(["--repo", "/r", "--zone", "z", "--team", "t", "--json"])).toEqual({ repo: "/r", zone: "z", team: "t", json: true });
  });
  test("--team names a team folder and --zone the clone", () => {
    expect(parseInitArgs(["--team", "gadgets", "--zone", "acme"])).toMatchObject({ team: "gadgets", zone: "acme" });
  });
  test("--team without a value throws a usage error", () => {
    expect(() => parseInitArgs(["--team"])).toThrow(/--team needs a value/);
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
    published: { pushed: true as const, remote: "https://gitlab.example.com/acme/org.git" },
  } satisfies InitOutcome;

  test("success names the pack, where things are, and what to try next", () => {
    const text = renderPlain(initOutcomeBlocks(okOutcome));
    expect(text.split("\n")[0]).toBe(`[ok] Created the ${okOutcome.pack.name} pack  ${okOutcome.pack.dir}`);
    expect(text).toContain(`Zone: ${okOutcome.pack.zone}\n`);
    expect(text).toContain(`Installed: ${okOutcome.installed.plugin} ${okOutcome.installed.version}\n`);
    expect(text).toContain("[ok] Shared the acme pack with your org  https://gitlab.example.com/acme/org.git\n");
    expect(text).toContain(`  next: Run /reload-plugins in your Claude session, then try ${okOutcome.tryNext}\n`);
    expect(text).not.toContain("restart");
  });

  test("a pack that is not shared yet says so and names the publish command", () => {
    const text = renderPlain(initOutcomeBlocks({ ...okOutcome, published: { pushed: false, reason: "rt could not push the team repo", next: "rt team publish" } }));
    expect(text.split("\n")[0]).toBe(`[ok] Created the ${okOutcome.pack.name} pack  ${okOutcome.pack.dir}`);
    expect(text).toContain("[not yet] The acme pack is not shared with your org yet  rt could not push the team repo\n");
    expect(text).toContain("  next: Share it with rt team publish\n");
  });

  test("a policy refusal is a refused line, with its command as next", () => {
    expect(
      renderPlain(
        initRefusalBlocks({
          ok: false,
          refused: true,
          code: "pack-exists",
          detail: "This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill",
          next: "rt skills init --team <name>",
        }),
      ),
    ).toBe(
      "[refused] This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill\n  next: rt skills init --team <name>\n",
    );
  });

  test("a refusal that is not a policy one is a failure, its command as next", () => {
    const failure = initFailure({ ok: false, refused: true, code: "zone-ambiguous", detail: "More than one team could hold this pack: acme, beta", next: "rt skills init --team <name>" });
    expect(renderPlain([ui.failure(failure)])).toBe("More than one team could hold this pack: acme, beta\n  next: rt skills init --team <name>\n");
  });

  test("the failure prefers the error's next to the generic remedy", () => {
    const f = initFailure({
      ok: false,
      refused: false,
      code: "materialize-failed",
      detail: "rt could not add this repo to its list",
      wrote: [],
      remedy: { commands: ["rt skills materialize --dir /code/x"] },
      why: "The rt daemon is not running.",
      next: "rt daemon start",
    });
    expect(f).toMatchObject({ title: "rt could not add this repo to its list", why: "The rt daemon is not running.", next: ui.cmd("rt daemon start") });
  });

  test("a failure names each command of its remedy, then what was written", () => {
    const outcome: Extract<InitOutcome, { ok: false; refused: false }> = {
      ok: false,
      refused: false,
      code: "compile-failed",
      detail: "boom",
      wrote: ["/a", "/b"],
      remedy: { commands: ["rt skills compile --pack-dir /z/mattstack/packs/acme", "rt skills check --pack-dir /z/mattstack/packs/acme"] },
    };
    const failure = initFailure(outcome);
    expect(renderPlain([ui.failure(failure)])).toBe(
      "The new pack did not compile\n  next: Run rt skills compile --pack-dir /z/mattstack/packs/acme, then rt skills check --pack-dir /z/mattstack/packs/acme\n",
    );
    expect(initFailureAfter(outcome)).toEqual([ui.verbatim(["boom", "Written so far:", "/a", "/b"], "what did not compile")]);
  });

  test("a multi-line compile detail keeps each line under its caption", () => {
    const outcome: Extract<InitOutcome, { ok: false; refused: false }> = {
      ok: false,
      refused: false,
      code: "compile-failed",
      detail: "stubs.jsonc: unknown slot review\nskills.jsonc: duplicate name work",
      wrote: ["/a"],
      remedy: { commands: ["rt skills compile --pack-dir /z/p"] },
    };
    const failure = initFailure(outcome);
    expect(renderPlain([ui.failure(failure)])).toBe(
      "The new pack did not compile\n  next: Run rt skills compile --pack-dir /z/p\n",
    );
    expect(initFailureAfter(outcome)).toEqual([ui.verbatim(["stubs.jsonc: unknown slot review", "skills.jsonc: duplicate name work", "Written so far:", "/a"], "what did not compile")]);
  });

  test("a write failure says to delete the folder it started, then run init again", () => {
    const outcome: Extract<InitOutcome, { ok: false; refused: false }> = {
      ok: false,
      refused: false,
      code: "write-failed",
      detail: "disk full",
      wrote: ["/z/mattstack/packs/acme/.claude-plugin/plugin.json"],
      remedy: { commands: ["rt skills init"], folder: "/z/mattstack/packs/acme" },
    };
    expect(renderPlain([ui.failure(initFailure(outcome))])).toBe(
      "disk full\n  next: Delete the pack folder it started, then run rt skills init\n  Pack folder: /z/mattstack/packs/acme\n",
    );
    expect(initFailureAfter(outcome)).toEqual([ui.verbatim(outcome.wrote, "written so far")]);
  });

  test("with no remedy, the next step is the general one", () => {
    expect(renderPlain([ui.failure(initFailure({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: [] }))])).toBe(
      "The new pack did not compile\n  next: Fix it, then run rt skills compile and rt skills check\n",
    );
  });
});

test("a compile failure is one title and its next, then every error under a caption", () => {
  const o: Extract<InitOutcome, { ok: false; refused: false }> = { ok: false, refused: false, code: "compile-failed", detail: "skills/a: missing title\nskills/b: bad slot", wrote: [], remedy: { commands: ["rt skills compile --pack-dir /p"] } };
  const f = initFailure(o);
  expect(f.title).toBe("The new pack did not compile");
  expect(f.details).toBeUndefined();
  const io = captureOut();
  io.reset();
  ui.__test__.setHuman(() => false);
  try {
    ui.fail(f, ...initFailureAfter(o));
    const err = io.stderr();
    const at = (s: string) => err.indexOf(s);
    expect(at("The new pack did not compile")).toBe(0);
    expect(at("next: Run rt skills compile --pack-dir /p")).toBeGreaterThan(0);
    expect(at("what did not compile")).toBeGreaterThan(at("next: Run rt skills compile --pack-dir /p"));
    expect(at("skills/a: missing title")).toBeGreaterThan(at("what did not compile"));
    expect(at("skills/b: bad slot")).toBeGreaterThan(at("skills/a: missing title"));
  } finally {
    io.restore();
  }
});

test("a noncompile failure prints every written path after its remedy and ordinary details", () => {
  const outcome: Extract<InitOutcome, { ok: false; refused: false }> = {
    ok: false,
    refused: false,
    code: "write-failed",
    detail: "The pack could not be written\ndisk full\nno space left",
    why: "This disk has no space left",
    wrote: Array.from({ length: 8 }, (_, i) => `/z/packs/acme/skills/file-${i}.md`),
    remedy: { commands: ["rt skills init"], folder: "/z/packs/acme" },
  };
  const failure = initFailure(outcome);
  const io = captureOut();
  io.reset();
  ui.__test__.setHuman(() => false);
  try {
    ui.fail(failure, ...initFailureAfter(outcome));
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(
      "The pack could not be written\n  why: This disk has no space left\n  next: Delete the pack folder it started, then run rt skills init\n  disk full\n  no space left\n  Pack folder: /z/packs/acme\nwritten so far:\n" + outcome.wrote.map((path) => `  ${path}\n`).join(""),
    );
  } finally {
    io.restore();
  }
  expect(failure).toEqual({
    title: "The pack could not be written",
    why: "This disk has no space left",
    next: ["Delete the pack folder it started, then run ", ui.cmd("rt skills init")],
    details: "disk full\nno space left\nPack folder: /z/packs/acme",
  });
  expect(initFailureAfter(outcome)).toEqual([ui.verbatim(outcome.wrote, "written so far")]);
});

test("a noncompile failure with no written paths has no trailing block", () => {
  const outcome: Extract<InitOutcome, { ok: false; refused: false }> = { ok: false, refused: false, code: "write-failed", detail: "disk full", wrote: [] };
  expect(initFailureAfter(outcome)).toEqual([]);
  expect(renderPlain([ui.failure(initFailure(outcome)), ...initFailureAfter(outcome)])).toBe(
    "disk full\n  next: Fix it, then run rt skills compile and rt skills check\n",
  );
});

test("a refusal has no trailing written-path block", () => {
  const outcome: Extract<InitOutcome, { ok: false; refused: true }> = { ok: false, refused: true, code: "no-remote", detail: "This repo has no git remote", next: "git remote add origin <url>" };
  expect(initFailureAfter(outcome)).toEqual([]);
  expect(renderPlain([ui.failure(initFailure(outcome)), ...initFailureAfter(outcome)])).toBe(
    "This repo has no git remote\n  next: git remote add origin <url>\n",
  );
});

test("a refusal keeps its reason in the failure and refusal blocks", () => {
  const o = { ok: false as const, refused: true as const, code: "zone-mismatch" as const, detail: "The widgets team is on another host", why: "This repo is on gitlab.example.com." };
  expect(initFailure(o)).toEqual({ title: o.detail, why: o.why });
  expect(renderPlain(initRefusalBlocks(o))).toBe(`[refused] ${o.detail}\n  why: ${o.why}\n`);
});

describe("repoListFailure", () => {
  test("a move the daemon did not answer keeps the daemon's why and the command that checks on it", () => {
    const err = repoListFailure("/r/api", {
      error: "The rt daemon is running but did not answer",
      why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
      next: "rt daemon status",
    });
    expect(err.code).toBe("locate-failed");
    expect(err.message).toBe("rt could not add this repo to its list");
    expect(err.log).toBe("/r/api: The rt daemon is running but did not answer");
    expect(err.why).toBe("rt will not move the repo itself while the daemon holds its records: the two would race.");
    expect(err.next).toBe("rt daemon status");
  });

  test("a refusal with no guidance uses the daemon error as why", () => {
    const err = repoListFailure("/r/api", { error: "git worktree repair failed: exit 1" });
    expect(err.message).toBe("rt could not add this repo to its list");
    expect(err.why).toBe("git worktree repair failed: exit 1");
    expect(err.log).toBe("/r/api: git worktree repair failed: exit 1");
    expect(err.next).toBeUndefined();
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
    activeTeam: () => null,
    currentOrg: () => "acme",
    mayWrite: () => null,
    declareClaim: () => {},
    engineDescription: () => "engine description",
    claude: async () => ({ code: 0, stdout: "", stderr: "" }),
    registerRepo: async () => "repo-slug",
    materialize: async () => ({ ok: true, detail: "materialized" }),
    compile: async () => ({ ok: true, errors: [] }),
    check: async () => ({ drift: false }),
    sharePack: async () => ({ pushed: true, remote: "https://gitlab.example.com/acme/org.git" }),
    rememberShare: () => {},
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
    expect(io.errLines()).toEqual(["This repo has no git remote", "  next: git remote add origin <url>"]);
    expect(io.stderr()).not.toContain("rt skills init:");
    expect(io.stderr()).not.toContain("[refused]");
    expect(process.exitCode).toBe(2);
  });

  test("claude-missing prints the same needs-you note as sync, exit 2", async () => {
    await skillsInit([], {}, stubDeps({ claude: null, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    expect(io.errLines()[0]).toBe("[needs you] Claude Code is not installed  rt installs and syncs packs through it");
    expect(io.stderr()).toBe(renderPlain(syncCommand.claudeMissingBlocks()));
    expect(io.stdout()).toBe("");
    expect(process.exitCode).toBe(2);
  });

  test("a policy refusal is a refused note on stderr, exit 2", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: `{ "board.gitlabHost": "gitlab.com", "board.projects": ["acme/api"] }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/settings.team.jsonc`]: `{}`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme/pack/skills.jsonc`]: "{}",
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/packs/acme/skills/work/SKILL.md`]: "compiled",
    });
    await skillsInit([], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    expect(io.stdout()).toBe("");
    expect(io.errLines()[0]).toStartWith("[refused] This team already has a pack");
    expect(io.stderr()).not.toContain("[failed]");
    expect(process.exitCode).toBe(2);
  });

  for (const json of [false, true]) test(`--zone naming the Mac's other org refuses ${json ? "as JSON" : "for a person"} and names the org it uses`, async () => {
    const HOME = "/h";
    const org = (slug: string) => ({
      [`${HOME}/.mattstack/teams/${slug}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "${slug}" }`,
      [`${HOME}/.mattstack/teams/${slug}/mattstack/org/settings.org.jsonc`]: `{ "board.gitlabHost": "gitlab.com" }`,
      [`${HOME}/.mattstack/teams/${slug}/mattstack/teams/widgets/settings.team.jsonc`]: `{}`,
    });
    const fs = memFs({ ...org("acme"), ...org("beta") });
    await skillsInit(["--zone", "beta", "--team", "widgets", ...(json ? ["--json"] : [])], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    if (json) {
      const printed = JSON.parse(io.lines()[0]!);
      expect(printed.error).toEqual({ code: "other-org", message: "The beta org is not the one this Mac uses. rt works with one org per Mac, and this Mac uses acme", refused: true });
    } else {
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[refused] The beta org is not the one this Mac uses\n  why: rt works with one org per Mac, and this Mac uses acme\n");
    }
    expect(process.exitCode).toBe(2);
  });

  test("--json: a refusal's why rides in the message before the command", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: `{ "board.gitlabHost": "gitlab.com" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/settings.team.jsonc`]: `{}`,
    });
    await skillsInit(["--team", "widgets", "--json"], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }) }));
    expect(JSON.parse(io.lines()[0]!).error.message).toBe("There is no team called widgets. Only an org admin can add a team. Run rt team add widgets --owner <username>");
  });

  test("a team with no forge host is a needs-you note on stderr with the fixing command as next, exit 2", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: `{}`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/settings.team.jsonc`]: `{}`,
    });
    await skillsInit([], {}, stubDeps({ fs, home: HOME, gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }) }));
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(
      "[needs you] The acme team has no forge host set, so rt cannot tell which host this repo is on\n" +
        `  next: rt settings set board.gitlabHost '"gitlab.example.com"' --scope team --team acme\n`,
    );
    expect(io.stderr()).not.toContain("[failed]");
    expect(process.exitCode).toBe(2);
  });

  test("--json: a refusal with a remedy carries the command in the message", async () => {
    const deps = stubDeps({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
      engineDescription: () => null,
    });
    await skillsInit(["--json"], {}, deps);
    const printed = JSON.parse(io.lines()[0]!);
    expect(printed.error.code).toBe("mattstack-missing");
    expect(printed.error.refused).toBe(true);
    expect(printed.error.message).toBe("The mattstack plugin is not installed, so rt cannot read the work engine. Run rt setup pack");
    expect(Object.keys(printed.error).sort()).toEqual(["code", "message", "refused"]);
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

  test("--json: success carries the share outcome beside the existing keys", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: `{ "board.gitlabHost": "gitlab.com", "board.projects": [] }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/settings.team.jsonc`]: `{}`,
      [`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`]: `{ "name": "acme-market", "owner": { "name": "acme" }, "plugins": [] }`,
    });
    await skillsInit(["--json"], {}, stubDeps({
      fs,
      home: HOME,
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
      engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null),
      registerRepo: async () => "gitlab.com/acme/api",
      materialize: async () => {
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/packs/acme/skills.jsonc`, "{}");
        return { ok: true, detail: "merged" };
      },
      sharePack: async () => ({ pushed: false, reason: "rt could not push the team repo", next: "rt team publish" }),
    }));
    const printed = JSON.parse(io.lines()[0]!);
    expect(printed.ok).toBe(true);
    expect(printed.tryNext).toBe("/acme:work <ticket>");
    expect(printed.published).toEqual({ pushed: false, reason: "rt could not push the team repo", next: "rt team publish" });
    expect(process.exitCode).toBe(0);
  });

  test("--json: a post-write compile failure envelope carries the wrote list", async () => {
    const HOME = "/h";
    const fs = memFs({
      [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/org/settings.org.jsonc`]: `{ "board.gitlabHost": "gitlab.com", "board.projects": [] }`,
      [`${HOME}/.mattstack/teams/acme/mattstack/teams/acme/settings.team.jsonc`]: `{}`,
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
