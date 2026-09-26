import { describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

function ownPgid(): string {
  return Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(process.pid)]).stdout.toString().trim();
}

// git runs a local remote's upload-pack as its own child, so a wrapper script
// there sees exactly the env and process group the fetch child was given.
async function fetchThroughProbe(nonInteractive: boolean | undefined): Promise<{ prompt: string; pgid: string }> {
  const sb = await makeSandbox();
  try {
    await sb.write("a.txt", "one\n");
    await sb.commitAll("init");
    await sb.addBareRemote();
    await sb.git(["push", "origin", "main"]);
    const record = join(sb.dir, "..", "probe.txt");
    const probe = join(sb.dir, "..", "upload-pack-probe.sh");
    await writeFile(
      probe,
      `#!/bin/sh\necho "prompt=\${GIT_TERMINAL_PROMPT-unset}" > "${record}"\necho "pgid=$(ps -o pgid= -p $$ | tr -d ' ')" >> "${record}"\nexec git-upload-pack "$@"\n`,
    );
    await chmod(probe, 0o755);
    await sb.git(["config", "remote.origin.uploadpack", probe]);
    const client = createGitClient(sb.dir);
    await client.fetch(undefined, undefined, nonInteractive === undefined ? undefined : { nonInteractive });
    const lines = Object.fromEntries((await readFile(record, "utf8")).trim().split("\n").map((l) => l.split("=") as [string, string]));
    return { prompt: lines.prompt!, pgid: lines.pgid! };
  } finally {
    await sb.cleanup();
  }
}

describe("fetch nonInteractive", () => {
  test("disables git's terminal prompt and runs the child in its own session", async () => {
    const seen = await fetchThroughProbe(true);
    expect(seen.prompt).toBe("0");
    expect(seen.pgid).not.toBe(ownPgid());
  });

  test("the default fetch keeps the caller's process group and prompt setting", async () => {
    const seen = await fetchThroughProbe(undefined);
    expect(seen.prompt).toBe(process.env.GIT_TERMINAL_PROMPT ?? "unset");
    expect(seen.pgid).toBe(ownPgid());
  });
});
