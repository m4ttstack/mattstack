/**
 * formatBranchSegments builds the picker's branch label as segments with
 * tones and hex values. MR status reads as words, the same words
 * `rt worktree list` prints.
 */

import { describe, expect, test } from "bun:test";
import { formatBranchSegments, type EnrichedBranch, type MRInfo } from "../enrich.ts";
import type { LinearTicket } from "../linear.ts";

function mkTicket(overrides: Partial<LinearTicket> = {}): LinearTicket {
  return {
    id: "t1",
    identifier: "ACME-1234",
    title: "Claim chat sidebar",
    description: null,
    url: "https://linear.app/x/issue/ACME-1234",
    stateName: "In Progress",
    stateColor: null,
    branchName: null,
    ...overrides,
  };
}

function mkMr(overrides: Partial<MRInfo> = {}): MRInfo {
  return {
    provider: "gitlab",
    iid: 1,
    title: "MR title",
    webUrl: null,
    state: "opened",
    isDraft: false,
    author: { id: "u1", name: "a", avatarUrl: null } as any,
    assignees: [],
    createdAt: null,
    sourceBranch: "feature",
    targetBranch: "main",
    behindTarget: null,
    diff: null,
    pipeline: null,
    reviews: [] as any,
    sha: "abc123",
    ...overrides,
  } as MRInfo;
}

function mkBranch(overrides: Partial<EnrichedBranch> = {}): EnrichedBranch {
  return {
    path: "/repo/wt",
    dirName: "wt",
    branch: "feature-x",
    linearId: null,
    ticket: null,
    mr: null,
    ...overrides,
  };
}

describe("formatBranchSegments", () => {
  test("ticket branch: worktree name leads as column, status tag follows, then title", () => {
    const eb = mkBranch({
      dirName: "neville",
      linearId: "ACME-1234",
      ticket: mkTicket({ stateName: "Done", stateColor: "#4CB782" }),
    });
    const { left } = formatBranchSegments(eb);

    expect(left).toEqual([
      { text: "neville", bold: true, column: true },
      { text: "  [Done]         ", hex: "#4CB782" },
      { text: " " },
      { text: "Claim chat sidebar", tone: "dim" },
    ]);
  });

  test("ticket branch with no stateColor falls back to the dim tone", () => {
    const eb = mkBranch({
      linearId: "ACME-1234",
      ticket: mkTicket({ stateName: "Backlog", stateColor: null }),
    });
    const { left } = formatBranchSegments(eb);
    expect(left[1]).toEqual({ text: "  [Backlog]      ", tone: "dim" });
  });

  test("non-ticket branch with no MR/ticket/linearId is [Local Only], dimmer", () => {
    const eb = mkBranch({ dirName: "gitq-1", branch: "on-deck/bill" });
    const { left, right } = formatBranchSegments(eb);

    expect(left).toEqual([
      { text: "gitq-1", bold: true, column: true },
      { text: "  ", tone: "faint" },
      { text: "on-deck/bill", tone: "dim" },
    ]);
    expect(right).toEqual([{ text: "[Local Only]", tone: "dimmer" }]);
  });

  test("a bare worktree with no branch renders dirName only", () => {
    const eb = mkBranch({ dirName: "gitq-1", branch: "" });
    const { left } = formatBranchSegments(eb);
    expect(left).toEqual([{ text: "gitq-1", bold: true, column: true }]);
  });

  test("default branch with no MR/ticket/linearId is [main branch], dimmer", () => {
    const eb = mkBranch({ dirName: "harbor", branch: "main" });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([{ text: "[main branch]", tone: "dimmer" }]);
  });

  test("default branch: worktree name leads as column, branch follows dim", () => {
    const eb = mkBranch({ dirName: "repo-tools", branch: "main" });
    const { left } = formatBranchSegments(eb);
    expect(left).toEqual([
      { text: "repo-tools", bold: true, column: true },
      { text: "  ", tone: "faint" },
      { text: "main", tone: "dim" },
    ]);
  });

  test("default branch WITH an MR never shows the [main branch] tag", () => {
    const eb = mkBranch({
      dirName: "harbor",
      branch: "master",
      mr: mkMr({ state: "closed", pipeline: { status: "success" } as any }),
    });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([{ text: "!1 closed", tone: "dim" }]);
  });

  test("an open MR reads as words: marker, iid, state, then its checks", () => {
    const cases: Array<[string, string, string]> = [
      ["success", "checks passed", "mint"],
      ["success_with_warnings", "checks passed with warnings", "peach"],
      ["failed", "checks failed", "coral"],
      ["running", "checks running", "cyan"],
      ["pending", "checks waiting", "faint"],
      ["created", "checks waiting", "faint"],
      ["canceled", "checks canceled", "faint"],
    ];
    for (const [status, words, tone] of cases) {
      const eb = mkBranch({ mr: mkMr({ iid: 4, state: "opened", pipeline: { status } as any }) });
      const { right } = formatBranchSegments(eb);
      expect(right).toEqual([{ text: "!4 open", tone: "dim" }, { text: "  " }, { text: words, tone }]);
    }
  });

  test("a merged or closed MR drops its checks, which can no longer change", () => {
    for (const state of ["merged", "closed"] as const) {
      const eb = mkBranch({ mr: mkMr({ iid: 8, state, pipeline: { status: "running" } as any }) });
      const { right } = formatBranchSegments(eb);
      expect(right).toEqual([{ text: `!8 ${state}`, tone: "dim" }]);
    }
  });

  test("a GitHub MR takes the # marker", () => {
    const eb = mkBranch({ mr: mkMr({ provider: "github", iid: 8, state: "merged" } as any) });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([{ text: "#8 merged", tone: "dim" }]);
  });

  test("non-ticket branch with an MR shows the MR title in place of the branch", () => {
    const eb = mkBranch({ dirName: "happy-oyster", branch: "launcher-at-prompt", mr: mkMr({ title: "Launcher shows at an empty prompt", state: "merged" }) });
    const { left, match } = formatBranchSegments(eb);
    expect(left).toEqual([
      { text: "happy-oyster", bold: true, column: true },
      { text: "  ", tone: "faint" },
      { text: "Launcher shows at an empty prompt", tone: "dim" },
    ]);
    expect(match).toContain("launcher-at-prompt");
    expect(match).toContain("Launcher shows at an empty prompt");
  });

  test("default branch keeps its branch name even with an MR", () => {
    const eb = mkBranch({ dirName: "harbor", branch: "main", mr: mkMr({ title: "Release", state: "opened" }) });
    const { left } = formatBranchSegments(eb);
    expect(left[2]).toEqual({ text: "main", tone: "dim" });
  });

  test("placeholder tags can be turned off for screens where they mislead", () => {
    expect(formatBranchSegments(mkBranch({ branch: "feature-x" }), { placeholderTags: false }).right).toEqual([]);
    expect(formatBranchSegments(mkBranch({ branch: "main" }), { placeholderTags: false }).right).toEqual([]);
  });

  test("non-ticket branch with only a linearId (no MR) shows it dimmer, right-pinned", () => {
    const eb = mkBranch({ dirName: "hedwig", branch: "acme-token-pipeline", linearId: "ACME-1234" });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([{ text: "ACME-1234", tone: "dimmer" }]);
  });

  test("an MR AND a linearId (no ticket) both appear", () => {
    const eb = mkBranch({
      dirName: "hedwig",
      branch: "acme-token-pipeline",
      linearId: "ACME-1234",
      mr: mkMr({ state: "opened", pipeline: { status: "running" } as any }),
    });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([
      { text: "!1 open", tone: "dim" },
      { text: "  " },
      { text: "checks running", tone: "cyan" },
      { text: "  " },
      { text: "ACME-1234", tone: "dimmer" },
    ]);
  });

  test("ticket branch appends its linearId after the MR, dimmer", () => {
    const eb = mkBranch({
      dirName: "fleur",
      linearId: "ACME-1841",
      ticket: mkTicket({ stateName: "Code Review" }),
      mr: mkMr({ state: "opened", pipeline: { status: "success" } as any }),
    });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([
      { text: "!1 open", tone: "dim" },
      { text: "  " },
      { text: "checks passed", tone: "mint" },
      { text: "  " },
      { text: "ACME-1841", tone: "dimmer" },
    ]);
  });

  test("ticket branch with no MR still shows its linearId, dimmer", () => {
    const eb = mkBranch({
      dirName: "seamus",
      linearId: "ACME-1710",
      ticket: mkTicket({ stateName: "In Progress" }),
    });
    const { right } = formatBranchSegments(eb);
    expect(right).toEqual([{ text: "ACME-1710", tone: "dimmer" }]);
  });

  test("long ticket title is passed unclipped (Go picker handles overflow)", () => {
    const longTitle =
      "`selectedMeshType` acts as a permanent cache and never re-syncs when vehicle classification changes";
    const eb = mkBranch({
      dirName: "fleur",
      linearId: "ACME-1841",
      ticket: mkTicket({ title: longTitle, stateName: "Code Review" }),
    });
    const { left } = formatBranchSegments(eb);

    const titleSeg = left.find(s => s.text === longTitle);
    expect(titleSeg).toBeDefined();
    expect(titleSeg!.tone).toBe("dim");
    expect(left[1]).toEqual({ text: "  [Code Review]  ", tone: "dim" });
  });

  test("ticket-row match text carries branch, full title, and linearId for filtering", () => {
    const longTitle = "a".repeat(80);
    const eb = mkBranch({
      dirName: "fleur",
      branch: "acme-1841-selected-mesh-type",
      linearId: "ACME-1841",
      ticket: mkTicket({ title: longTitle, stateName: "Code Review" }),
    });
    const { match } = formatBranchSegments(eb);
    expect(match).toContain("fleur");
    expect(match).toContain("acme-1841-selected-mesh-type");
    expect(match).toContain(longTitle);
    expect(match).toContain("ACME-1841");
    expect(match).toContain("[Code Review]");
  });

  test("non-ticket-row match text carries dirName, branch, and linearId", () => {
    const eb = mkBranch({ dirName: "hedwig", branch: "acme-token-pipeline", linearId: "ACME-1234" });
    const { match } = formatBranchSegments(eb);
    expect(match).toContain("hedwig");
    expect(match).toContain("acme-token-pipeline");
    expect(match).toContain("ACME-1234");
  });
});
