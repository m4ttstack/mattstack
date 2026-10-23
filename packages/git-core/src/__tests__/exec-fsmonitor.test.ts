import { describe, expect, it } from "bun:test";
import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../client.ts";
import { rawGit, rawGitOk } from "../exec.ts";

// A fsmonitor HOOK (core.fsmonitor set to a path) stands in for the daemon:
// git runs it on every index read, so a marker file proves a spawn consulted
// fsmonitor. With the daemon form ("true") a test would leave a real
// `git fsmonitor--daemon` running behind it.
function armFsmonitorHook(dir: string): string {
  const marker = join(dir, "..", `fsmonitor-ran-${Date.now()}`);
  const hook = join(dir, "..", `fsmonitor-hook-${Date.now()}.sh`);
  writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\nprintf '/'\n`);
  chmodSync(hook, 0o755);
  appendFileSync(join(dir, ".git", "config"), `[core]\n\tfsmonitor = ${hook}\n`);
  return marker;
}

describe("git-core never consults the repo's fsmonitor", () => {
  it("rawGit reads the index without running the fsmonitor hook", async () => {
    const sb = await makeSandbox();
    try {
      const marker = armFsmonitorHook(sb.dir);
      await rawGit(sb.dir, ["status", "--porcelain"]);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("rawGitOk reads the index without running the fsmonitor hook", async () => {
    const sb = await makeSandbox();
    try {
      const marker = armFsmonitorHook(sb.dir);
      await rawGitOk(sb.dir, ["diff", "--quiet"]);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("the client's simple-git status skips the fsmonitor hook too", async () => {
    const sb = await makeSandbox();
    try {
      const marker = armFsmonitorHook(sb.dir);
      await createGitClient(sb.dir).snapshot();
      expect(existsSync(marker)).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });
});
