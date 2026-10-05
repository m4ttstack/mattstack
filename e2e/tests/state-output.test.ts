import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";

describe("state output in the shipped binary", () => {
  let home: string;
  let cleanup: () => void;
  beforeEach(() => { ({ path: home, cleanup } = createTestHome()); });
  afterEach(() => cleanup());

  test("unconfigured status is off with a remedy, and JSON is only the ruled envelope", async () => {
    const human = await rt(["state", "backup", "status"], { home });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("[off] Encrypted backup is not set up");
    expect(human.stdout).toContain("next: rt state backup init");
    expect(human.stderr).toBe("");
    const json = await rt(["state", "backup", "status", "--json"], { home });
    expect(json).toEqual({ stdout: '{"configured":false}\n', stderr: "", exitCode: 0 });
  });

  test("configured status preserves recipients and per-app JSON without notes", async () => {
    const base = join(home, ".mattstack", "user", "state-backups");
    mkdirSync(join(base, "rt"), { recursive: true });
    writeFileSync(join(base, "recipients.txt"), "# team\nage1test\n");
    writeFileSync(join(base, "rt", "2026-10-05.zst.age"), "backup");
    const json = await rt(["state", "backup", "status", "--json"], { home });
    expect(json.exitCode).toBe(0);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toEqual({ configured: true, recipients: 1, apps: [
      { app: "rt", lastBackup: "2026-10-05.zst.age", count: 1, totalBytes: 6 },
      { app: "board", lastBackup: null, count: 0, totalBytes: 0 },
      { app: "gitq", lastBackup: null, count: 0, totalBytes: 0 },
    ] });
    const human = await rt(["state", "backup", "status"], { home });
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("1 key can decrypt it");
    expect(human.stdout).toContain("every 4 hours");
    expect(human.stdout).toContain("no backups");
  });

  test("local backup and restore keep human success on stdout and their JSON envelopes clean", async () => {
    const backup = await rt(["state", "backup", "--local", "--json"], { home });
    expect(backup.exitCode).toBe(0);
    expect(backup.stderr).toBe("");
    const envelope = JSON.parse(backup.stdout);
    expect(Object.keys(envelope).sort()).toEqual(["ok", "path", "pruned"]);
    expect(envelope.ok).toBe(true);
    expect(envelope.pruned).toEqual([]);
    expect(envelope.path.startsWith(home + "/")).toBe(true);
    expect(existsSync(envelope.path)).toBe(true);
    const humanRestore = await rt(["state", "restore", envelope.path, "--force"], { home });
    expect(humanRestore.exitCode).toBe(0);
    expect(humanRestore.stdout).toContain("[ok] Restored rt's state");
    expect(humanRestore.stderr).toBe("");
    const restore = await rt(["state", "restore", envelope.path, "--force", "--json"], { home });
    expect(restore.exitCode).toBe(0);
    expect(restore.stderr).toBe("");
    expect(JSON.parse(restore.stdout)).toEqual({ ok: true, restored: join(home, ".mattstack", "rt", "state.db"), from: envelope.path });
    const humanBackup = await rt(["state", "backup", "--local"], { home });
    expect(humanBackup.exitCode).toBe(0);
    expect(humanBackup.stdout).toContain("[ok] Saved a local copy of rt's state");
    expect(humanBackup.stderr).toBe("");
  });

  test("backup and missing-copy failures exit one, keep stdout empty and show remedies", async () => {
    for (const args of [["state", "backup"], ["state", "backup", "--json"]]) {
      const result = await rt(args, { home });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.startsWith("Encrypted backup is not set up on this Mac")).toBe(true);
      expect(result.stderr).toContain("next: rt state backup init");
      expect(result.stderr).toContain("rt state backup --local");
    }
    const missing = await rt(["state", "restore", "missing.db", "--force", "--json"], { home });
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr.startsWith("There is no backup called missing.db")).toBe(true);
    expect(missing.stderr).toContain("next: rt state restore");
  });
});
