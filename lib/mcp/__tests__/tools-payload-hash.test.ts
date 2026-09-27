import { describe, expect, test } from "bun:test";
import { mcpToolsPayload } from "../../../commands/mcp.ts";

// mattstack-skills' attachments/mcp-tools/reference.md is generated from this
// payload and checked in CI against a pinned rt sha, so a change here must be
// carried there by hand.
const PAYLOAD_SHA256 = "13d3eeb5c13556d75ba517154ee9be9f6b3edfd8fd3e9705e6c7662eab9e7d5c";

function payloadHash(): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(mcpToolsPayload()));
  return h.digest("hex");
}

function refreshSteps(hash: string): string {
  return [
    "The rt mcp tools --json payload changed, so mattstack-skills' reference.md is stale.",
    "1. Merge this rt change.",
    "2. From an rt checkout at the merge commit, in mattstack-skills:",
    "   bun <rt>/cli.ts mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md",
    "3. Move the rt ref: in mattstack-skills' .github/workflows/purity.yml to that merge commit.",
    `4. Set PAYLOAD_SHA256 in lib/mcp/__tests__/tools-payload-hash.test.ts to ${hash}`,
  ].join("\n");
}

describe("mcp tools payload", () => {
  test("is deterministic", () => {
    expect(payloadHash()).toBe(payloadHash());
  });
  test("matches the hash mattstack-skills' reference.md was generated from", () => {
    const hash = payloadHash();
    if (hash !== PAYLOAD_SHA256) throw new Error(refreshSteps(hash));
  });
});
