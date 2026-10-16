import { join } from "path";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import { orgsDir } from "../../rt-paths.ts";
import type { SecretsExecResult, SecretsExecSeam, SecretsSeams } from "../store.ts";

export function teamCloneRootFor(slug: string): string {
  return join(orgsDir(), slug);
}

/** `publicKey`, when given, is what `age-keygen -y` derives from `key`. */
export function fakeAgeKeySeamWithKey(key: string, publicKey?: string): AgeKeySeam {
  return {
    async run(cmd): Promise<AgeExecResult> {
      if (cmd[0] === "security" && cmd[1] === "find-generic-password") {
        return { code: 0, stdout: `${key}\n`, stderr: "" };
      }
      if (publicKey !== undefined && cmd[0] === "age-keygen" && cmd[1] === "-y") {
        return { code: 0, stdout: `${publicKey}\n`, stderr: "" };
      }
      throw new Error(`fakeAgeKeySeamWithKey: unexpected call ${cmd.join(" ")}`);
    },
  };
}

export function fakeAgeKeySeamAbsent(): AgeKeySeam {
  return {
    async run(): Promise<AgeExecResult> {
      return { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
    },
  };
}

type Call = { cmd: string[]; opts?: { env?: Record<string, string>; sensitive?: boolean } };

/**
 * Same round-trippable-plaintext modeling as store.test.ts's own fake, plus
 * `listDir` (team-store's domain-file discovery) and `.sops.yaml` as just
 * another entry in the same `files` map. writeTeamRecipients/readTeamRecipients
 * go through the plain fileExists/readFile/writeFile trio, no sops involved.
 */
export class FakeTeamExecSeam implements SecretsExecSeam {
  calls: Call[] = [];
  files = new Map<string, string>();
  stats = new Map<string, { mtimeMs: number; size: number }>();
  removeFileCalls: string[] = [];
  fsyncAndRenameCalls: { from: string; to: string }[] = [];
  private mtimeCounter = 0;
  private roundTrippablePlaintext = new Map<string, string>();
  private updatekeysResult: SecretsExecResult;
  private failUpdatekeysOnCall?: number;
  private updatekeysCallCount = 0;
  private decryptResult?: SecretsExecResult;

  constructor(opts: { updatekeys?: SecretsExecResult; failUpdatekeysOnCall?: number; decrypt?: SecretsExecResult } = {}) {
    this.updatekeysResult = opts.updatekeys ?? { code: 0, stdout: "", stderr: "" };
    this.failUpdatekeysOnCall = opts.failUpdatekeysOnCall;
    this.decryptResult = opts.decrypt;
  }

  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  listDir(dirPath: string): string[] {
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    const names: string[] = [];
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.push(p.slice(prefix.length));
    }
    return names;
  }

  private touch(path: string): void {
    this.mtimeCounter += 1;
    this.stats.set(path, { mtimeMs: this.mtimeCounter, size: this.files.get(path)?.length ?? 0 });
  }

  statFile(path: string): { mtimeMs: number; size: number } | null {
    return this.stats.get(path) ?? null;
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`FakeTeamExecSeam: readFile of missing path ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    this.touch(path);
  }

  ensureDir(): void {}
  chmod(): void {}

  fsyncAndRename(from: string, to: string): void {
    this.fsyncAndRenameCalls.push({ from, to });
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
      this.stats.delete(from);
      this.touch(to);
    }
    // A later plain `sops -d <to>` (readTeamSecret, or the next write's
    // read-existing-before-merge) must still resolve real plaintext after
    // the rename, so the round-trip map's key has to move with the file.
    const plaintext = this.roundTrippablePlaintext.get(from);
    if (plaintext !== undefined) {
      this.roundTrippablePlaintext.set(to, plaintext);
      this.roundTrippablePlaintext.delete(from);
    }
  }

  removeFile(path: string): void {
    this.removeFileCalls.push(path);
    this.files.delete(path);
    this.stats.delete(path);
  }

  async run(cmd: string[], runOpts?: { env?: Record<string, string>; sensitive?: boolean }): Promise<SecretsExecResult> {
    this.calls.push({ cmd, opts: runOpts });

    if (cmd[0] === "sops" && cmd[1] === "-d") {
      if (this.decryptResult) return this.decryptResult;
      const target = cmd[cmd.length - 1]!;
      const staged = this.roundTrippablePlaintext.get(target);
      return { code: 0, stdout: staged ?? "{}", stderr: "" };
    }
    if (cmd[0] === "sops" && cmd[1] === "-e") {
      const outputIdx = cmd.indexOf("--output");
      const outputPath = cmd[outputIdx + 1]!;
      const stagingInputPath = cmd[cmd.length - 1]!;
      this.files.set(outputPath, JSON.stringify({ data: "opaque", sops: {} }));
      this.touch(outputPath);
      const staged = this.files.get(stagingInputPath);
      if (staged !== undefined) this.roundTrippablePlaintext.set(outputPath, staged);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd[0] === "sops" && cmd[1] === "updatekeys") {
      this.updatekeysCallCount += 1;
      if (this.failUpdatekeysOnCall === this.updatekeysCallCount) {
        return { code: 1, stdout: "", stderr: "sops: boom" };
      }
      return this.updatekeysResult;
    }

    throw new Error(`FakeTeamExecSeam: unexpected call ${cmd.join(" ")}`);
  }
}

/** Registers `slug`'s clone root as present in the fake (every test below operates against an already-cloned team unless it's specifically testing the no-clone refusal). */
export function seamsWithKey(key = "AGE-TEAM-KEY", slug = "acme", publicKey?: string): { execSeam: FakeTeamExecSeam; seams: SecretsSeams } {
  const execSeam = new FakeTeamExecSeam();
  execSeam.files.set(teamCloneRootFor(slug), "");
  return { execSeam, seams: { ageKeySeam: fakeAgeKeySeamWithKey(key, publicKey), execSeam } };
}
