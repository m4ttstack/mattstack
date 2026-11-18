import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePluginRootsAsync } from "../sources.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeClaude(script: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-fake-claude-")));
  made.push(dir);
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe("resolvePluginRootsAsync", () => {
  test("lists the plugins without blocking", async () => {
    const plugin = realpathSync(mkdtempSync(join(tmpdir(), "rt-fake-plugin-")));
    made.push(plugin);
    writeFileSync(join(plugin, "x"), "");
    const bin = fakeClaude(`echo '[{"id":"widgets@acme","installPath":"${plugin}","scope":"user"}]'`);
    const roots = await resolvePluginRootsAsync({ timeoutMs: 5_000, bin });
    expect(roots.byName.widgets?.dir).toBe(plugin);
  });

  test("a claude that hangs is killed at the deadline and rejects", async () => {
    const bin = fakeClaude("sleep 30");
    const started = Date.now();
    await expect(resolvePluginRootsAsync({ timeoutMs: 200, bin })).rejects.toThrow("claude plugin list did not answer within 0 s");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
