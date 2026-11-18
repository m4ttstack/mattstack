import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { buildCloneHealth, makePingHealth, pullState, staleSkillsOf, type CloneGitFacts, type CloneStatusSlice } from "../clone-health.ts";

const STATUS: CloneStatusSlice = {
  lastPullAt: Date.parse("2026-11-18T10:00:00Z"),
  lastPullError: null,
  lastPullSkipped: null,
  conflicted: null,
  layoutHold: null,
  pullOnly: true,
  firstSeenDirty: {},
};

const GIT: CloneGitFacts = {
  branch: "mattstack",
  head: "1a69435685c5",
  upstream: "1a69435685c5",
  behind: 0,
  ahead: 0,
  dirty: [],
};

describe("pullState", () => {
  test("a clean pull is ok", () => {
    expect(pullState(STATUS)).toBe("ok");
  });

  test("a fetch git could not authenticate", () => {
    expect(pullState({ ...STATUS, lastPullError: "fatal: Authentication failed for 'https://gitlab.com/acme/org.git/'" })).toBe("fetch-auth");
    expect(pullState({ ...STATUS, lastPullError: "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled" })).toBe("fetch-auth");
  });

  test("a fetch that could not reach the forge", () => {
    expect(pullState({ ...STATUS, lastPullError: "fatal: unable to access 'https://gitlab.com/acme/org.git/': Could not resolve host: gitlab.com" })).toBe("fetch-network");
  });

  test("a pull skipped because local changes would be overwritten", () => {
    expect(
      pullState({
        ...STATUS,
        lastPullSkipped: "error: Your local changes to the following files would be overwritten by merge:\n\tmattstack/teams/web/plugin/skills/work/SKILL.md",
      }),
    ).toBe("local-changes");
  });

  test("a held layout and a stopped rebase", () => {
    expect(pullState({ ...STATUS, layoutHold: { kind: "above" } as never, lastPullSkipped: "held" })).toBe("layout-hold");
    expect(pullState({ ...STATUS, conflicted: { at: 1, detail: "rebase stopped" }, lastPullSkipped: "rebase stopped" })).toBe("conflict");
  });

  test("a clone never pulled is unknown", () => {
    expect(pullState({ ...STATUS, lastPullAt: 0 })).toBe("unknown");
  });
});

describe("buildCloneHealth", () => {
  test("carries the git facts, the pull state and when the dirt began", () => {
    const health = buildCloneHealth(
      {
        ...STATUS,
        lastPullSkipped: "error: Your local changes to the following files would be overwritten by merge:",
        firstSeenDirty: { "mattstack/teams/web/plugin/skills/work/SKILL.md": Date.parse("2026-11-17T09:00:00Z"), "mattstack/teams/web/plugin/pack/skills.jsonc": Date.parse("2026-11-17T08:00:00Z") },
      },
      {
        ...GIT,
        behind: 4,
        dirty: [
          { path: "mattstack/teams/web/plugin/skills/work/SKILL.md", status: "M" },
          { path: "mattstack/teams/web/plugin/pack/skills.jsonc", status: "M" },
        ],
      },
      "mattstack",
    );
    expect(health).toEqual({
      branch: "mattstack",
      dataBranch: "mattstack",
      head: "1a69435685c5",
      upstream: "1a69435685c5",
      behind: 4,
      ahead: 0,
      lastPullAt: "2026-11-18T10:00:00.000Z",
      pull: "local-changes",
      canPublish: false,
      dirtyCount: 2,
      dirty: [
        { path: "mattstack/teams/web/plugin/skills/work/SKILL.md", status: "M" },
        { path: "mattstack/teams/web/plugin/pack/skills.jsonc", status: "M" },
      ],
      dirtySince: "2026-11-17T08:00:00.000Z",
      conflicted: false,
      layoutHold: false,
    });
  });

  test("caps the dirty list but keeps the true count", () => {
    const dirty = Array.from({ length: 60 }, (_, i) => ({ path: `mattstack/f${i}.md`, status: "??" }));
    const health = buildCloneHealth(STATUS, { ...GIT, dirty }, "mattstack");
    expect(health.dirty).toHaveLength(40);
    expect(health.dirtyCount).toBe(60);
  });
});

describe("staleSkillsOf", () => {
  test("names each stale skill and attachment with its causes", () => {
    expect(
      staleSkillsOf({
        verbs: [
          { name: "work", status: "stale", staleBecause: ["source"] },
          { name: "review", status: "in-sync" },
        ],
        attachments: [{ name: "gate-protocol", status: "stale", staleBecause: ["version", "text"] }],
      }),
    ).toEqual([
      { skill: "work", causes: ["source"] },
      { skill: "gate-protocol", causes: ["version", "text"] },
    ]);
  });

  test("anything that is not a check report reads as none", () => {
    expect(staleSkillsOf(null)).toEqual([]);
  });
});

describe("makePingHealth", () => {
  const DIR = "/h/.mattstack/orgs/acme";
  const exec = (argv: string[]) => {
    const git = argv[0] === "git" ? argv.slice(3).join(" ") : null;
    if (git === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "mattstack\n", stderr: "" };
    if (git === "rev-parse --short=12 HEAD") return { code: 0, stdout: "aaaaaaaaaaaa\n", stderr: "" };
    if (git === "rev-parse --short=12 @{u}") return { code: 0, stdout: "bbbbbbbbbbbb\n", stderr: "" };
    if (git === "rev-list --left-right --count @{u}...HEAD") return { code: 0, stdout: "3\t0\n", stderr: "" };
    if (git === "status --porcelain=v1 --untracked-files=all") return { code: 0, stdout: " M mattstack/teams/web/plugin/skills/work/SKILL.md\n?? mattstack/teams/web/plugin/notes.md\n", stderr: "" };
    if (argv.includes("check")) return { code: 1, stdout: JSON.stringify({ verbs: [{ name: "work", status: "stale", staleBecause: ["source"] }], attachments: [] }), stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };

  test("reads a clone from the snapshot status and git, and stale skills from rt's check even when it exits nonzero", async () => {
    const p = fakeProbes({ home: "/h", files: {}, exec });
    const health = makePingHealth({
      probes: p,
      rtArgv: ["rt"],
      status: () => [
        {
          slug: "acme",
          repoDir: DIR,
          lastPullAt: Date.parse("2026-11-18T10:00:00Z"),
          lastPullError: null,
          lastPullSkipped: "error: Your local changes to the following files would be overwritten by merge:",
          conflicted: null,
          layoutHold: null,
          pullOnly: true,
          firstSeenDirty: {},
        },
      ],
    });
    const clone = await health.cloneHealth("acme");
    expect(clone?.behind).toBe(3);
    expect(clone?.pull).toBe("local-changes");
    expect(clone?.dirty).toEqual([
      { path: "mattstack/teams/web/plugin/skills/work/SKILL.md", status: "M" },
      { path: "mattstack/teams/web/plugin/notes.md", status: "??" },
    ]);
    expect(await health.cloneHealth("other")).toBeNull();
    expect(await health.staleSkills("acme-pack")).toEqual([{ skill: "work", causes: ["source"] }]);
  });
});
