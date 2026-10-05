// commands/__tests__/state-backup-status.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";

describe("state backup status", () => {
  let home: string;
  let origHome: string | undefined;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    origHome = process.env.HOME;
    home = realpathSync(mkdtempSync(join(tmpdir(), "ss-test-")));
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
    io = captureOut();
  });

  afterEach(() => {
    restoreHome(origHome);
    rmSync(home, { recursive: true, force: true });
    io.restore();
  });

  it("reports not configured when recipients.txt is missing", async () => {
    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = io.stdout();
    expect(output).toBe("[off] Encrypted backup is not set up\n  next: rt state backup init\n");
    expect(io.stderr()).toBe("");
  });

  it("reports configured with recipient count", async () => {
    writeFileSync(
      join(home, ".mattstack", "user", "state-backups", "recipients.txt"),
      "age1key1\nage1key2\n",
    );

    const { stateBackupStatus } = await import("../state-backup-status");
    await stateBackupStatus([], {});

    const output = io.stdout();
    expect(output.startsWith("[ok] Encrypted backup is set up  2 keys can decrypt it\n")).toBe(true);
    expect(output).toContain("backups: every 4 hours");
  });
});
