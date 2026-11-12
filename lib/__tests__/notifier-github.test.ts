import { describe, expect, test } from "bun:test";
import { __test__, createNotifier } from "../notifier.ts";

const SELF = { gitlab: null, github: 77 };

function uniqueBranch(): string {
  return `gh-branch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function entry(authorId: string, over: Record<string, any> = {}): any {
  const { blockers, reviews, readiness, pipeline, ...rest } = over;
  return {
    ticket: null,
    linearId: "",
    fetchedAt: 0,
    mr: {
      author: { id: authorId },
      state: "opened",
      pipeline: { status: "running", ...pipeline },
      blockers: { awaitingApprovals: true, hasConflicts: false, needsRebase: false, ...blockers },
      reviews: { isApproved: false, approvedBy: [], ...reviews },
      readiness: { state: "blocked", reasons: [], ...readiness },
      status: "opened",
      webUrl: "https://github.com/o/r/pull/1",
      ...rest,
    },
  };
}

function harness() {
  const titles: string[] = [];
  const notifier = createNotifier({
    broadcast: (_type, data: any) => titles.push(data?.title),
  });
  return { titles, notifier };
}

const gh = (over?: Record<string, any>) => entry("github:user:77", over);

describe("notifier on GitHub PRs", () => {
  const cases: Array<[string, string, Record<string, any>]> = [
    ["merged", "MR Merged 🎉", { state: "merged", status: "merged" }],
    ["closed", "MR Closed", { state: "closed", status: "closed" }],
    ["CI failed", "Pipeline Failed", { pipeline: { status: "failed" } }],
    ["CI passed", "Pipeline Passed ✓", { pipeline: { status: "success" } }],
    [
      "approved",
      "MR Approved 👍",
      { reviews: { isApproved: true, approvedBy: [{ id: "github:user:5" }] } },
    ],
    ["conflicts", "Merge Conflicts", { blockers: { hasConflicts: true } }],
    ["needs rebase", "Needs Rebase", { blockers: { needsRebase: true } }],
    [
      "ready",
      "Ready to Merge ✓",
      { readiness: { state: "ready" }, blockers: { awaitingApprovals: false } },
    ],
  ];

  for (const [name, title, over] of cases) {
    test(`a GitHub PR fires ${name}`, () => {
      const { titles, notifier } = harness();
      const branch = uniqueBranch();
      notifier.checkAndNotify({ [branch]: gh() }, undefined, SELF);
      notifier.checkAndNotify({ [branch]: gh(over) }, undefined, SELF);
      expect(titles).toContain(title);
    });
  }

  test("a GitHub PR is not matched against the GitLab id", () => {
    for (const self of [77, { gitlab: 77, github: null }]) {
      const { titles, notifier } = harness();
      const branch = uniqueBranch();
      notifier.checkAndNotify({ [branch]: gh() }, undefined, self);
      notifier.checkAndNotify({ [branch]: gh({ pipeline: { status: "failed" } }) }, undefined, self);
      expect(titles).toEqual([]);
    }
  });

  test("a Mac with both forges gets both", () => {
    const { titles, notifier } = harness();
    const a = uniqueBranch();
    const b = uniqueBranch();
    const pair = (status: string) => ({
      [a]: entry("gitlab:user:7", { pipeline: { status } }),
      [b]: gh({ pipeline: { status } }),
    });
    const self = { gitlab: 7, github: 77 };
    notifier.checkAndNotify(pair("running"), undefined, self);
    notifier.checkAndNotify(pair("failed"), undefined, self);
    expect(titles.filter((t) => t === "Pipeline Failed")).toHaveLength(2);
  });

  test("self-approval on a GitHub PR is suppressed", () => {
    const { titles, notifier } = harness();
    const branch = uniqueBranch();
    notifier.checkAndNotify({ [branch]: gh() }, undefined, SELF);
    notifier.checkAndNotify(
      { [branch]: gh({ reviews: { isApproved: true, approvedBy: [{ id: "github:user:77" }] } }) },
      undefined,
      SELF,
    );
    expect(titles).not.toContain("MR Approved 👍");
  });

  test("isSelfAuthored keeps the bare-number GitLab meaning", () => {
    expect(__test__.isSelfAuthored(entry("gitlab:123"), 123)).toBe(true);
    expect(__test__.isSelfAuthored(entry("github:user:123"), 123)).toBe(false);
  });
});
