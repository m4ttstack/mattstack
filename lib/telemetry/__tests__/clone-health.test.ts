import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { buildCloneHealth, makePingHealth, pullState, staleCountOf, type CloneGitFacts, type CloneStatusSlice } from "../clone-health.ts";

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
  test("carries counts, the pull state and when the dirt began, and no name", () => {
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
          "mattstack/teams/web/plugin/skills/work/SKILL.md",
          "mattstack/teams/web/plugin/pack/skills.jsonc",
        ],
      },
      "mattstack",
    );
    expect(health).toEqual({
      branch: null,
      dataBranch: null,
      head: null,
      upstream: null,
      onDataBranch: true,
      behind: 4,
      ahead: 0,
      lastPullAt: "2026-11-18T10:00:00.000Z",
      pull: "local-changes",
      canPublish: false,
      dirtyCount: 2,
      dirty: [],
      dirtySince: "2026-11-17T08:00:00.000Z",
      conflicted: false,
      layoutHold: false,
    });
  });

  test("says whether the copy is on its data branch, or that rt does not know", () => {
    const on = (branch: string | null, dataBranch: string | null) => buildCloneHealth(STATUS, { ...GIT, branch }, dataBranch).onDataBranch;
    expect(on("mattstack", "mattstack")).toBe(true);
    expect(on("trial", "mattstack")).toBe(false);
    expect(on(null, "mattstack")).toBe(false);
    expect(on("mattstack", null)).toBeNull();
  });

  test("keeps the true count however many files are dirty", () => {
    const health = buildCloneHealth(STATUS, { ...GIT, dirty: Array.from({ length: 60 }, (_, i) => `SECRET-${i}.md`) }, "mattstack");
    expect(health.dirtyCount).toBe(60);
    expect(JSON.stringify(health)).not.toContain("SECRET");
  });
});

describe("staleCountOf", () => {
  test("counts each stale or never-compiled skill and attachment", () => {
    expect(
      staleCountOf({
        verbs: [
          { name: "work", status: "stale", staleBecause: ["source"] },
          { name: "review", status: "in-sync" },
          { name: "ship", status: "never-compiled" },
        ],
        attachments: [{ name: "gate-protocol", status: "stale", staleBecause: ["version", "text"] }],
      }),
    ).toBe(3);
  });

  test("anything that is not a check report counts none", () => {
    expect(staleCountOf(null)).toBe(0);
  });
});

describe("makePingHealth", () => {
  const DIR = "/h/.mattstack/orgs/acme";
  const exec = (argv: string[]) => {
    const git = argv[0] === "git" ? argv.slice(3).join(" ") : null;
    if (git === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "mattstack\n", stderr: "" };
    if (git === "rev-list --left-right --count @{u}...HEAD") return { code: 0, stdout: "3\t0\n", stderr: "" };
    if (git === "status --porcelain=v1 --untracked-files=all -z")
      return {
        code: 0,
        stdout: " M mattstack/teams/web/plugin/skills/work/SKILL.md\0?? mattstack/teams/web/plugin/odd\tname.md\0R  mattstack/new.md\0mattstack/old.md\0",
        stderr: "",
      };
    if (argv.includes("check")) return { code: 1, stdout: JSON.stringify({ verbs: [{ name: "work", status: "stale", staleBecause: ["source"] }], attachments: [] }), stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };

  test("reads a clone from the snapshot status and git, and the stale count from rt's check even when it exits nonzero", async () => {
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
    expect(clone).toMatchObject({ dirtyCount: 3, dirty: [], branch: null, head: null, upstream: null });
    expect(await health.cloneHealth("other")).toBeNull();
    expect(await health.staleCount("acme-pack")).toBe(1);
  });

  test("a git status that fails reads as no report, not a clean copy", async () => {
    const failing = (argv: string[]) => (argv.includes("status") ? { code: 128, stdout: "", stderr: "fatal: not a git repository" } : exec(argv));
    const health = makePingHealth({
      probes: fakeProbes({ home: "/h", files: {}, exec: failing }),
      rtArgv: ["rt"],
      status: () => [
        { slug: "acme", repoDir: DIR, lastPullAt: 1, lastPullError: null, lastPullSkipped: null, conflicted: null, layoutHold: null, pullOnly: true, firstSeenDirty: {} },
      ],
    });
    await expect(health.cloneHealth("acme")).rejects.toThrow();
  });
});
