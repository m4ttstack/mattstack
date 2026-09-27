import { describe, expect, test } from "bun:test";
import { TREE } from "../../command-tree-def.ts";
import { listAgentSafe } from "../../command-tree-resolve.ts";
import { mcpTools } from "../../mcp/tools.ts";
import { deriveRules, lintSkillText } from "../mcp-lint.ts";

const rules = deriveRules(mcpTools(), listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd })));

describe("new CI verbs are flagged on Bash", () => {
  const cases: Array<[string, string]> = [
    ["rt ci lease claim https://h/g/p/-/merge_requests/1", "ci_lease_claim"],
    ["rt ci lease heartbeat https://h/g/p/-/merge_requests/1", "ci_lease_heartbeat"],
    ["rt ci lease release https://h/g/p/-/merge_requests/1", "ci_lease_release"],
    ["rt ci lease show https://h/g/p/-/merge_requests/1", "ci_lease_read"],
    ["rt ci watch https://h/g/p/-/merge_requests/1 --sha abc1234", "ci_watch"],
  ];
  for (const [line, tool] of cases) {
    test(line, () => {
      const hits = lintSkillText(`\`\`\`bash\n${line}\n\`\`\`\n`, "SKILL.md", rules);
      expect(hits.map((h) => h.tool)).toContain(tool);
    });
  }

  // The trailing (?![\w-]) in commandPattern is what stops "ci_watch" from
  // matching inside a longer word like "watching".
  test("rt ci watching (a longer word) does not hit ci_watch", () => {
    const hits = lintSkillText("```bash\nrt ci watching the build\n```\n", "SKILL.md", rules);
    expect(hits.map((h) => h.tool)).not.toContain("ci_watch");
  });
});

describe("the attendant flow needs no Bash rt call", () => {
  test("claim, watch, heartbeat and release are all MCP tools", () => {
    const names = new Set(mcpTools().map((t) => t.name));
    for (const n of ["ci_lease_claim", "ci_watch", "ci_lease_heartbeat", "ci_lease_release", "ci_lease_read", "mr_pipeline"]) expect(names.has(n)).toBe(true);
  });
  test("a flow written only with tool calls produces no lint hits", () => {
    const flow = [
      "ci_lease_claim {mrUrl}",
      "mr_pipeline {repoName, iid} (the prior pipeline id)",
      "git_push {tree}",
      "ci_watch {repoName, iid, sha, priorPipelineId}",
      "ci_lease_heartbeat {mrUrl}",
      "ci_lease_release {mrUrl}",
    ].map((l) => `\`${l}\``).join("\n");
    expect(lintSkillText(flow, "SKILL.md", rules)).toEqual([]);
  });
});
