import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runBranchSync } from "../worktree-sync.ts";

test("the daemon's branch-sync verb answers with a JSON result, not a usage error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-sync-"));
  try {
    const r = await runBranchSync(dir);
    expect(r.kind).toBe("error");
    expect(r.refusal ?? "").not.toContain("gave no result");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
