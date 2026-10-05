import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { __test__ as bundleLayoutTest } from "../../lib/bundle-layout.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as ui from "../../lib/ui/out.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";

describe("state backup init", () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    bundleLayoutTest.resetBundleLayoutMemo();
    home = mkdtempSync(join(tmpdir(), "si-test-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "user", "state-backups"), { recursive: true });
  });

  afterEach(() => {
    restoreHome(origHome);
    rmSync(home, { recursive: true, force: true });
    bundleLayoutTest.resetBundleLayoutMemo();
    ui.__test__.setHuman(undefined);
  });

  it("exits with error, naming all three and both remedies, when none resolves", async () => {
    // An empty bundle (no deps.lock) under this test's own HOME, pinned as the
    // app path: otherwise the resolver reads whatever mattstack.app the machine
    // running the suite happens to have installed.
    const emptyBundle = join(home, "Applications", "mattstack.app");
    mkdirSync(emptyBundle, { recursive: true });
    setSetting("mattstack.appPath", emptyBundle, "machine");

    const origPath = process.env.PATH;
    process.env.PATH = "";
    const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const io = captureOut({ console: true });
    ui.__test__.setHuman(() => false);

    try {
      const { stateBackupInit } = await import("../state-backup-init.ts");
      await expect(stateBackupInit([], {})).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = io.stderr();
      expect(output).toContain("rt cannot find age, zstd, git-lfs");
      expect(output).toContain("mattstack.app");
      expect(output).toContain("brew install age zstd git-lfs");
    } finally {
      process.env.PATH = origPath;
      exitSpy.mockRestore();
      io.restore();
    }
  });

  for (const childOutput of ["lfs: hooks are locked", "lfs: hooks are locked\nsecond child line"]) {
    it(`init stops at the failed LFS stage and captions ${childOutput.split("\n").length} child lines`, async () => {
      const tools = await import("../../lib/state/backup-tools.ts");
      const ageKey = await import("../../lib/home/age-key.ts");
      const found = spyOn(tools, "findBackupTool").mockReturnValue("/usr/bin/true");
      const spawn = spyOn(Bun, "spawnSync").mockReturnValue({ exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from(childOutput) } as never);
      const keychain = spyOn(ageKey, "ensureAgeKey").mockImplementation(async () => { throw new Error("the keychain must not be touched"); });
      mkdirSync(join(home, ".mattstack", "user", ".git"));
      const io = captureOut({ console: true });
      ui.__test__.setHuman(() => false);
      const exit = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });
      try {
        const { stateBackupInit } = await import("../state-backup-init.ts");
        await expect(stateBackupInit([], {})).rejects.toThrow("exit 1");
        expect(io.stdout()).toContain("[ok] age, zstd and git-lfs are here");
        expect(io.stdout()).toContain("[failed] Git LFS did not install");
        expect(io.stderr()).toContain("Git LFS did not install in your home repo");
        expect(io.stdout()).toContain("[failed] Git LFS did not install in your home repo  lfs: hooks are locked\n");
        expect(io.stderr()).toBe(`Git LFS did not install in your home repo\nwhat failed:\n${childOutput.split("\n").map(line => `  ${line}`).join("\n")}\n`);
        expect(exit).toHaveBeenCalledWith(1);
        expect(keychain).not.toHaveBeenCalled();
      } finally { exit.mockRestore(); keychain.mockRestore(); spawn.mockRestore(); found.mockRestore(); io.restore(); }
    });

  }

  for (const scenario of ["success", "no sources", "LFS unconfirmed", "LFS check failed", "backup errors", "verification errors"] as const) {
    it(`runs safe fake stages: ${scenario}`, async () => {
      const tools = await import("../../lib/state/backup-tools.ts");
      const age = await import("../../lib/home/age-key.ts");
      const lfs = await import("../../lib/state/backup-lfs.ts");
      const backup = await import("../../lib/state/backup-orchestrator.ts");
      const pipeline = await import("../../lib/state/backup-pipeline.ts");
      const events: string[] = [];
      const found = spyOn(tools, "findBackupTool").mockReturnValue("/usr/bin/true");
      const spawn = spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
        events.push(args[0] === "git" ? "check" : "install");
        return { exitCode: args[0] === "git" && scenario === "LFS check failed" ? 1 : 0, stdout: Buffer.from(scenario === "LFS unconfirmed" ? "filter: unspecified" : "filter: lfs"), stderr: Buffer.from("") } as never;
      });
      const filters = spyOn(lfs, "writeLfsFilterConfig").mockReturnValue({ changed: [] } as never);
      const seam = spyOn(age, "createRealAgeKeySeam").mockReturnValue({ run: async () => { throw new Error("no real keychain"); } });
      const ensure = spyOn(age, "ensureAgeKey").mockImplementation(async () => { events.push("key"); return { publicKey: "age1fake" } as never; });
      const read = spyOn(age, "readAgeKey").mockImplementation(async () => { events.push("read"); return { key: "fake private key" } as never; });
      const full = spyOn(backup, "runFullBackup").mockImplementation(async () => {
        events.push("backup");
        return { backed: scenario === "no sources" ? [] : [{ app: "rt", sizeBytes: 2048, path: join(home, "copy.age") }], errors: scenario === "backup errors" ? ["snapshot failed\nfirst source details", "second source failed"] : [] } as never;
      });
      const restore = spyOn(pipeline, "restorePipelineFromStdin").mockImplementation(async () => { events.push("decrypt"); if (scenario === "verification errors") throw new Error("decrypt failed"); });
      mkdirSync(join(home, ".mattstack", "user", ".git"));
      const io = captureOut({ console: true });
      ui.__test__.setHuman(() => false);
      const exit = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });
      try {
        const { stateBackupInit } = await import("../state-backup-init.ts");
        if (scenario === "backup errors" || scenario === "verification errors") {
          await expect(stateBackupInit([], {})).rejects.toThrow("exit 1");
          expect(io.stdout()).toContain("[failed]");
          expect(io.stderr()).toContain(scenario === "backup errors" ? "The first backup did not finish" : "A backup could not be decrypted");
          expect(events).toEqual(scenario === "backup errors" ? ["install", "key", "backup"] : ["install", "key", "backup", "read", "decrypt"]);
          expect(io.stdout()).not.toContain("Encrypted backup is set up");
          if (scenario === "backup errors") {
            expect(io.stderr()).toBe("The first backup did not finish\nwhat failed:\n  snapshot failed\n  first source details\n  second source failed\n");
            expect(io.stdout()).toContain("[failed] The first backup did not finish  snapshot failed\n");
          } else {
            expect(io.stderr()).toBe("A backup could not be decrypted\nwhat failed:\n  decrypt failed\n");
          }
          expect(exit).toHaveBeenCalledWith(1);
        } else {
          await stateBackupInit([], {});
          const text = io.stdout();
          const ordered = ["age, zstd and git-lfs are here", "Git LFS is set up", "This Mac can decrypt your backups", `Backed up ${scenario === "no sources" ? 0 : 1} source(s)`, "A backup decrypts", scenario === "success" ? "Git LFS stores the encrypted files" : "Finished checking Git LFS", "Encrypted backup is set up"];
          let previous = -1;
          for (const title of ordered) { const position = text.indexOf(title); expect(position).toBeGreaterThan(previous); previous = position; }
          expect(events).toEqual(scenario === "no sources" ? ["install", "key", "backup"] : ["install", "key", "backup", "read", "decrypt", "check"]);
          if (scenario === "no sources") { expect(read).not.toHaveBeenCalled(); expect(text).toContain("nothing to check yet"); }
          if (scenario !== "success") {
            expect(text).toContain("[ok] Finished checking Git LFS  not confirmed yet\n");
            expect(text).not.toContain("Git LFS stores the encrypted files");
            expect(text).toContain("[warning] Git LFS has not taken the encrypted files yet\n  next: rt state backup status\n");
          } else {
            expect(text).toContain("[ok] Git LFS stores the encrypted files\n");
            expect(text).not.toContain("Finished checking Git LFS");
            expect(text).not.toContain("not confirmed yet");
          }
          expect(exit).not.toHaveBeenCalled();
          expect(io.stderr()).toBe("");
        }
      } finally {
        exit.mockRestore(); restore.mockRestore(); full.mockRestore(); read.mockRestore(); ensure.mockRestore(); seam.mockRestore(); filters.mockRestore(); spawn.mockRestore(); found.mockRestore(); io.restore();
      }
    });
  }

  it("isBackupConfigured returns true after recipients.txt exists", async () => {
    const { recipientsPath } = await import("../../lib/state/backup-sources.ts");
    const { isBackupConfigured } = await import("../../lib/state/backup-orchestrator.ts");

    expect(isBackupConfigured()).toBe(false);
    writeFileSync(recipientsPath(), "age1testpublickey\n");
    expect(isBackupConfigured()).toBe(true);
  });
});
