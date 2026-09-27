import { describe, expect, test } from "bun:test";
import { TREE } from "../../command-tree-def.ts";
import { listAgentSafe } from "../../command-tree-resolve.ts";
import { mcpTools } from "../../mcp/tools.ts";
import { deriveRules, KEPT_ON_BASH } from "../mcp-lint.ts";

// mattstack-skills packs with "strictLint": true are checked against this
// rule set, so a change here can newly fail their strict lint.
const RULES_SHA256 = "c2b7b4647139692ed38432b3ea2efaa2e9dc678fa7422f55ae3dfedb2ffc618b";

function rulesHash(): string {
  const leaves = listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd }));
  const rules = deriveRules(mcpTools(), leaves);
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify([
    rules.map((r) => [r.id, r.pattern.source, r.pattern.flags, r.tool]),
    KEPT_ON_BASH.map((r) => `${r.source}/${r.flags}`),
  ]));
  return h.digest("hex");
}

function refreshSteps(hash: string): string {
  return [
    'The strict mcp lint rule set changed, so packs with "strictLint": true (mattstack) may now fail `rt skills check --strict` and `rt skills sync`.',
    "1. Run `bun cli.ts skills check --pack-dir <mattstack-skills> --strict` from this checkout.",
    "2. Land allow markers or fixes for every new strict hit in mattstack-skills before this change merges.",
    `3. Set RULES_SHA256 in lib/skills/__tests__/mcp-lint-rules-hash.test.ts to ${hash}.`,
  ].join("\n");
}

describe("mcp lint rule set", () => {
  test("is deterministic", () => {
    expect(rulesHash()).toBe(rulesHash());
  });
  test("matches the pinned hash", () => {
    const hash = rulesHash();
    if (hash !== RULES_SHA256) throw new Error(refreshSteps(hash));
  });
});
