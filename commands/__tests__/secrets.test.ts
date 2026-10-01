/**
 * Command-layer coverage for the --team surface on `rt secrets
 * set/list/rotate`: argv parsing (`--team <slug>` skipped from positionals
 * regardless of where it sits), routing to the team vs. personal store, and
 * both `rotate --team` forms (with a domain/key vs. rotate-all).
 * `store.test.ts`'s own "rt secrets list (command layer)" test already
 * covers the personal-store path and the value-never-leaks canary; this
 * file is the team-routing complement.
 */
import { describe, test, expect, spyOn } from "bun:test";
import { secretsSet, secretsList, secretsRotate } from "../secrets.ts";
import { secretsFilePath, type SecretsExecResult, type SecretsExecSeam, type SecretsSeams } from "../../lib/secrets/store.ts";
import { teamSecretsFile, writeTeamRecipients, writeTeamSecret, readTeamSecret } from "../../lib/secrets/team-store.ts";
import type { AgeExecResult, AgeKeySeam } from "../../lib/home/age-key.ts";
import { teamsDir } from "../../lib/rt-paths.ts";
import { join } from "path";
import { capturePlain } from "./helpers/json-line.ts";

function fakeAgeKeySeamWithKey(key: string): AgeKeySeam {
  return {
    async run(cmd): Promise<AgeExecResult> {
      if (cmd[0] === "security" && cmd[1] === "find-generic-password") {
        return { code: 0, stdout: `${key}\n`, stderr: "" };
      }
      throw new Error(`fakeAgeKeySeamWithKey: unexpected call ${cmd.join(" ")}`);
    },
  };
}

type Call = { cmd: string[]; opts?: { env?: Record<string, string>; sensitive?: boolean } };

/** Covers both the personal (`user/secrets/<domain>.json`) and team (`teams/<slug>/...`) layouts — same fake shape as store.test.ts/team-store.test.ts's own fakes. */
class FakeExecSeam implements SecretsExecSeam {
  calls: Call[] = [];
  files = new Map<string, string>();
  stats = new Map<string, { mtimeMs: number; size: number }>();
  private mtimeCounter = 0;
  private roundTrippablePlaintext = new Map<string, string>();

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
    if (content === undefined) throw new Error(`FakeExecSeam: readFile of missing path ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    this.touch(path);
  }

  ensureDir(): void {}
  chmod(): void {}

  fsyncAndRename(from: string, to: string): void {
    const content = this.files.get(from);
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
      this.stats.delete(from);
      this.touch(to);
    }
    const plaintext = this.roundTrippablePlaintext.get(from);
    if (plaintext !== undefined) {
      this.roundTrippablePlaintext.set(to, plaintext);
      this.roundTrippablePlaintext.delete(from);
    }
  }

  removeFile(path: string): void {
    this.files.delete(path);
    this.stats.delete(path);
  }

  async run(cmd: string[], runOpts?: { env?: Record<string, string>; sensitive?: boolean }): Promise<SecretsExecResult> {
    this.calls.push({ cmd, opts: runOpts });

    if (cmd[0] === "sops" && cmd[1] === "-d") {
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
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(`FakeExecSeam: unexpected call ${cmd.join(" ")}`);
  }
}

/** Team-ready seams: clone root registered, one recipient already in .sops.yaml. */
function teamSeams(slug = "acme"): { execSeam: FakeExecSeam; seams: SecretsSeams } {
  const execSeam = new FakeExecSeam();
  execSeam.files.set(join(teamsDir(), slug), "");
  const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam };
  writeTeamRecipients(slug, ["age1aaa"], seams);
  return { execSeam, seams };
}

/** Seeds one team secret through the real store (not a direct fs write) so every invariant (recipients present, round-trip readback) is exercised the same way a real `rt secrets set --team` call would. */
async function writeTeamSecretForTest(seams: SecretsSeams, domain: string, key: string, value: string): Promise<void> {
  await writeTeamSecret("acme", domain, key, value, seams);
}

/** Swaps process.stdin for one synthetic chunk for the duration of `fn`, then restores it — drives the --stdin value-collection path without a real pipe. */
async function withFakeStdin<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const fake = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(`${value}\n`);
    },
  };
  const original = process.stdin;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "stdin", { value: original, configurable: true });
  }
}

async function withCapturedOut<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const cap = capturePlain();
  try {
    const result = await fn();
    return { result, stdout: cap.stdout(), stderr: cap.stderr() };
  } finally {
    cap.restore();
  }
}

describe("--team argv parsing (positional() skips the flag AND its value, any position)", () => {
  test("--team <slug> before the domain positional still resolves the domain correctly", async () => {
    const { seams } = teamSeams();
    await writeTeamSecretForTest(seams, "board", "apiKey", "shh");

    const { stdout } = await withCapturedOut(() => secretsList(["--team", "acme", "board"], {}, seams));

    expect(stdout).toContain("apiKey");
  });

  test("--team <slug> after the domain positional resolves identically", async () => {
    const { seams } = teamSeams();
    await writeTeamSecretForTest(seams, "board", "apiKey", "shh");

    const { stdout } = await withCapturedOut(() => secretsList(["board", "--team", "acme"], {}, seams));

    expect(stdout).toContain("apiKey");
  });
});

describe("secretsSet --team", () => {
  test("set prints a done line naming the key, never the value", async () => {
    const { seams } = teamSeams();
    const { stdout } = await withCapturedOut(() => withFakeStdin("shh\n", () => secretsSet(["--team", "acme", "board", "apiKey", "--stdin"], {}, seams)));
    expect(stdout).toBe("[ok] Saved the secret  acme/board.apiKey\n");
    expect(stdout).not.toContain("shh");
  });

  test("writes to the team store, never the personal one", async () => {
    const { execSeam, seams } = teamSeams();

    await withCapturedOut(() => withFakeStdin("shh", () => secretsSet(["board", "apiKey", "--team", "acme", "--stdin"], {}, seams)));

    expect(await readTeamSecret("acme", "board", "apiKey", seams)).toBe("shh");
    expect(execSeam.fileExists(secretsFilePath("board"))).toBe(false);
    expect(execSeam.fileExists(teamSecretsFile("acme", "board"))).toBe(true);
  });

  test("without --team, writes to the personal store instead", async () => {
    const execSeam = new FakeExecSeam();
    const seams: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam };

    await withCapturedOut(() => withFakeStdin("shh", () => secretsSet(["board", "apiKey", "--stdin"], {}, seams)));

    expect(execSeam.fileExists(secretsFilePath("board"))).toBe(true);
    expect(execSeam.fileExists(teamSecretsFile("acme", "board"))).toBe(false);
  });
});

describe("secretsList usage", () => {
  test("off a TTY with no domain list fails with usage on stderr and exit 1", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    const batch = process.env.RT_BATCH;
    process.env.RT_BATCH = "1";
    try {
      const { stderr, stdout } = await withCapturedOut(() => secretsList([], {}, teamSeams().seams).catch((e) => e));
      expect(stdout).toBe("");
      expect(stderr).toBe("[failed] Which domain?\n  next: rt secrets list <domain>\n");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      if (batch === undefined) delete process.env.RT_BATCH;
      else process.env.RT_BATCH = batch;
    }
  });
});

describe("secretsRotate --team <domain> <key> (the with-key form)", () => {
  test("rotates that one value in the team store", async () => {
    const { seams } = teamSeams();
    await writeTeamSecretForTest(seams, "board", "apiKey", "old-value");

    await withCapturedOut(() => withFakeStdin("new-value", () => secretsRotate(["board", "apiKey", "--team", "acme", "--stdin"], {}, seams)));

    expect(await readTeamSecret("acme", "board", "apiKey", seams)).toBe("new-value");
  });
});

describe("secretsRotate --team <slug> (the rotate-all form, no domain/key)", () => {
  test("re-encrypts every existing team domain file and reports it", async () => {
    const { execSeam, seams } = teamSeams();
    await writeTeamSecretForTest(seams, "board", "slackClientSecret", "a");
    await writeTeamSecretForTest(seams, "rt", "switchboardAdminToken", "b");
    execSeam.calls.length = 0;

    const { stdout } = await withCapturedOut(() => secretsRotate(["--team", "acme"], {}, seams));

    const updatekeysCalls = execSeam.calls.filter((c) => c.cmd[1] === "updatekeys");
    expect(updatekeysCalls.length).toBe(2);
    const output = stdout;
    expect(output).toContain("[ok] Re-encrypted 2 files for team");
    expect(output).toContain(teamSecretsFile("acme", "board"));
    expect(output).toContain(teamSecretsFile("acme", "rt"));
    expect(output).toMatch(/decrypted before/); // the removed-member residue note
  });

  test("no domain files yet -> a clean 'nothing to re-encrypt' message, not an error", async () => {
    const { seams } = teamSeams();

    const { stdout } = await withCapturedOut(() => secretsRotate(["--team", "acme"], {}, seams));

    expect(stdout).toContain("[skipped] No secret files to re-encrypt for team");
  });
});
