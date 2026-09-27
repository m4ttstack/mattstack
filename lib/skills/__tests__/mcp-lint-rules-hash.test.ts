import { describe, expect, test } from "bun:test";
import { TREE } from "../../command-tree-def.ts";
import { listAgentSafe } from "../../command-tree-resolve.ts";
import { mcpTools } from "../../mcp/tools.ts";
import { deriveRules } from "../mcp-lint.ts";

// mattstack-skills packs with "strictLint": true are checked against this
// rule set, so a change here can newly fail their strict lint.
const RULES_SHA256 = "9de7bde0fd0520ead49b1164704b26a4ad50397b18fbdc5520fff08fa950e5ec";

function rulesHash(): string {
  const rules = deriveRules(mcpTools(), listAgentSafe(TREE).map((l) => l.path));
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(rules.map((r) => [r.id, r.pattern.source, r.tool])));
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
