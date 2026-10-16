import { describe, expect, test } from "bun:test";

import { checkStackMembership, createStackGuardRunners } from "../stack-guard.ts";
import { fakeProbes, ok, type ExecScript } from "../setup/__tests__/fakes.ts";

const GITHUB = "git@github.com:acme/widgets.git";
const GITLAB = "https://gitlab.acme.internal/acme/widgets.git";

interface Row { iid: number; source: string; target: string }

/** 100 ordinary MRs into main, then the stacked one as row 101. */
function busyRepo(): Row[] {
  const rows: Row[] = Array.from({ length: 100 }, (_, i) => ({ iid: i + 1, source: `feat-${i + 1}`, target: "main" }));
  rows.push({ iid: 101, source: "feat-child", target: "feat-parent" });
  return rows;
}

function flag(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** Answers the way gh and glab do: filters first, then cuts the page at the requested size (each CLI's default is 30). */
function forge(remote: string, rows: Row[]): ExecScript {
  return (argv) => {
    if (argv[0] === "git" && argv[1] === "remote") return ok(remote + "\n");
    if (argv[0] === "gh") {
      const head = flag(argv, "--head");
      const base = flag(argv, "--base");
      const limit = Number(flag(argv, "--limit") ?? 30);
      const hits = rows.filter((r) => (head === undefined || r.source === head) && (base === undefined || r.target === base)).slice(0, limit);
      return ok(JSON.stringify(hits.map((r) => ({ number: r.iid, headRefName: r.source, baseRefName: r.target, url: `https://github.com/acme/widgets/pull/${r.iid}` }))));
    }
    if (argv[0] === "glab") {
      const source = flag(argv, "--source-branch");
      const target = flag(argv, "--target-branch");
      const perPage = Number(flag(argv, "--per-page") ?? 30);
      const hits = rows.filter((r) => (source === undefined || r.source === source) && (target === undefined || r.target === target)).slice(0, perPage);
      return ok(JSON.stringify(hits.map((r) => ({ iid: r.iid, source_branch: r.source, target_branch: r.target, web_url: `https://gitlab.acme.internal/acme/widgets/-/merge_requests/${r.iid}` }))));
    }
    return ok('{"stacks":[]}');
  };
}

describe("the forge stack check in a repo with more than 100 open merge requests", () => {
  for (const [name, remote] of [["GitHub", GITHUB], ["GitLab", GITLAB]] as const) {
    test(`${name}: refuses the stacked branch that sits at row 101`, async () => {
      const p = fakeProbes({ exec: forge(remote, busyRepo()) });
      const verdict = await checkStackMembership({ cwd: "/wt", branch: "feat-child", defaultBranch: "main", runners: createStackGuardRunners(p) });
      expect(verdict.verdict).toBe("refuse");
      if (verdict.verdict !== "refuse") return;
      expect(verdict.refusal.mrs?.map((mr) => mr.iid)).toEqual([101]);
    });

    test(`${name}: refuses the parent whose dependent sits at row 101`, async () => {
      const p = fakeProbes({ exec: forge(remote, busyRepo()) });
      const verdict = await checkStackMembership({ cwd: "/wt", branch: "feat-parent", defaultBranch: "main", runners: createStackGuardRunners(p) });
      expect(verdict.verdict).toBe("refuse");
    });

    test(`${name}: a listing cut off at its page size is unverified, never clear`, async () => {
      const crowded: Row[] = Array.from({ length: 150 }, (_, i) => ({ iid: i + 1, source: "feat", target: "main" }));
      const p = fakeProbes({ exec: forge(remote, crowded) });
      const verdict = await checkStackMembership({ cwd: "/wt", branch: "feat", defaultBranch: "main", runners: createStackGuardRunners(p) });
      expect(verdict.verdict).toBe("unverified");
      if (verdict.verdict !== "unverified") return;
      expect(verdict.refusal.hint).toContain("may be incomplete");
    });

    test(`${name}: an ordinary branch in the busy repo is still clear`, async () => {
      const p = fakeProbes({ exec: forge(remote, busyRepo()) });
      const verdict = await checkStackMembership({ cwd: "/wt", branch: "feat-7", defaultBranch: "main", runners: createStackGuardRunners(p) });
      expect(verdict.verdict).toBe("clear");
    });
  }

  test("GitHub asks for the branch's own PRs and its dependents by name, never the whole list", async () => {
    const p = fakeProbes({ exec: forge(GITHUB, busyRepo()) });
    await createStackGuardRunners(p).forgeOpenMrs("/wt", "feat-child");
    const gh = p.calls.exec.filter((a) => a[0] === "gh");
    expect(gh).toEqual([
      ["gh", "pr", "list", "--state", "open", "--head=feat-child", "--limit", "100", "--json", "number,headRefName,baseRefName,url"],
      ["gh", "pr", "list", "--state", "open", "--base=feat-child", "--limit", "100", "--json", "number,headRefName,baseRefName,url"],
    ]);
  });

  test("GitLab asks for the branch's own MRs and its dependents by name, never the whole list", async () => {
    const p = fakeProbes({ exec: forge(GITLAB, busyRepo()) });
    await createStackGuardRunners(p).forgeOpenMrs("/wt", "feat-child");
    const glab = p.calls.exec.filter((a) => a[0] === "glab");
    expect(glab).toEqual([
      ["glab", "mr", "list", "--source-branch=feat-child", "--output", "json", "--per-page", "100"],
      ["glab", "mr", "list", "--target-branch=feat-child", "--output", "json", "--per-page", "100"],
    ]);
  });
});
