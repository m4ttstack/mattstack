import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { codexConfigPath, codexFolderTrust, gitTrustRoot } from "../codex/trust.ts";

let dir: string;
let config: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-codex-trust-")));
  config = join(dir, "config.toml");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The shape Codex 0.160 wrote for a folder it trusts (live-01 evidence). */
const trusted = (path: string) => `[projects."${path}"]\ntrust_level = "trusted"\n`;
const REFUSED = { ok: false, error: { code: "refused" } };
const quiet = () => {};

const GIT_ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
}

/** A real repository with one commit, so worktrees can be added to it. */
function repo(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q");
  git(path, "commit", "-q", "--allow-empty", "-m", "init");
  return path;
}

describe("where the active Codex profile records trust", () => {
  test("the ambient profile is the home folder's .codex", () => {
    expect(codexConfigPath("default", { HOME: "/home/remy" })).toBe("/home/remy/.codex/config.toml");
  });

  test("a profile that is a Codex home holds its own config", () => {
    expect(codexConfigPath("/srv/codex-home", { HOME: "/home/remy" })).toBe("/srv/codex-home/config.toml");
  });

  test("a bare profile name locates no config", () => {
    expect(codexConfigPath("work", { HOME: "/home/remy" })).toBeUndefined();
  });
});

describe("whether Codex already trusts a folder", () => {
  test("a trusted entry for the exact folder is trust", () => {
    writeFileSync(config, `model = "o3"\n\n${trusted("/work/a")}\n[tui]\nscreen_reader_detection_done = true\n`);
    expect(codexFolderTrust(config, "/work/a")).toEqual({ ok: true, data: undefined });
  });

  test("no entry for the folder is a refusal, and the message says to trust it in Codex first", () => {
    writeFileSync(config, trusted("/work/b"));
    const outcome = codexFolderTrust(config, "/work/a");
    expect(outcome).toMatchObject(REFUSED);
    expect(outcome.ok || outcome.error.message).toContain("/work/a");
    expect(outcome.ok || outcome.error.message).toContain("trust it");
  });

  test("an untrusted entry, a trust level of another type, or an entry that is not a table is not trust", () => {
    for (const body of [
      `[projects."/work/a"]\ntrust_level = "untrusted"\n`,
      `[projects."/work/a"]\ntrust_level = true\n`,
      `[projects."/work/a"]\n`,
      `projects = { "/work/a" = "trusted" }\n`,
      `projects = ["/work/a"]\n`,
    ]) {
      writeFileSync(config, body);
      expect(codexFolderTrust(config, "/work/a")).toMatchObject(REFUSED);
    }
  });

  test("a trusted folder whose name only starts the same does not count", () => {
    writeFileSync(config, trusted("/work/a"));
    expect(codexFolderTrust(config, "/work/ab")).toMatchObject(REFUSED);
  });

  test("the inline-table spelling of the same entry is trust", () => {
    writeFileSync(config, `projects = { "/work/a" = { trust_level = "trusted" } }\n`);
    expect(codexFolderTrust(config, "/work/a").ok).toBe(true);
  });

  test("a folder reached through a link counts when Codex trusts its real path", () => {
    const realDir = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(realDir);
    symlinkSync(realDir, link);
    writeFileSync(config, trusted(realDir));
    expect(codexFolderTrust(config, link).ok).toBe(true);
  });

  test("any spelling of the folder that Codex marks untrusted refuses", () => {
    const realDir = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(realDir);
    symlinkSync(realDir, link);
    writeFileSync(config, `${trusted(realDir)}\n[projects."${link}"]\ntrust_level = "untrusted"\n`);
    expect(codexFolderTrust(config, link)).toMatchObject(REFUSED);
  });

  test("a profile with no config has trusted nothing", () => {
    const outcome = codexFolderTrust(config, "/work/a");
    expect(outcome).toMatchObject(REFUSED);
    expect(outcome.ok || outcome.error.message).toContain("trust it");
  });

  test("a config rt cannot parse refuses in plain words and logs the parser's own text", () => {
    writeFileSync(config, `[projects."/work/a"\ntrust_level = "trusted"\n`);
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    const broken = codexFolderTrust(config, "/work/a", (message, context) => logged.push({ message, context }));
    expect(broken).toMatchObject(REFUSED);
    const message = broken.ok ? "" : broken.error.message;
    expect(message).toContain("/work/a");
    expect(message).toContain("Fix or remove that entry in Codex's settings, then try again.");
    expect(message).not.toContain("TOML");
    expect(logged).toHaveLength(1);
    expect(String(logged[0]!.context.err)).toContain("TOML");
    expect(logged[0]!.context.path).toBe(config);
  });

  test("a config rt cannot open refuses and logs why", () => {
    mkdirSync(config);
    const logged: unknown[] = [];
    const outcome = codexFolderTrust(config, "/work/a", (_message, context) => logged.push(context));
    expect(outcome).toMatchObject(REFUSED);
    expect(outcome.ok || outcome.error.message).toContain("try again");
    expect(logged).toHaveLength(1);
  });

  test("a profile whose config cannot be located refuses", () => {
    expect(codexFolderTrust(undefined, "/work/a")).toMatchObject(REFUSED);
  });

  test("reading trust never changes the config", () => {
    const body = `${trusted("/work/b")}# keep me\n`;
    writeFileSync(config, body);
    const before = statSync(config).mtimeMs;
    codexFolderTrust(config, "/work/a", quiet);
    codexFolderTrust(config, "/work/b", quiet);
    expect(readFileSync(config, "utf8")).toBe(body);
    expect(statSync(config).mtimeMs).toBe(before);
  });
});

describe("trust Codex inherits through git (live-02)", () => {
  test("a folder inside a trusted repository's top-level folder is trusted", () => {
    const root = repo(join(dir, "acme"));
    const deep = join(root, "src", "deep");
    mkdirSync(deep, { recursive: true });
    writeFileSync(config, trusted(root));
    expect(gitTrustRoot(deep)).toBe(root);
    expect(codexFolderTrust(config, deep).ok).toBe(true);
    expect(codexFolderTrust(config, root).ok).toBe(true);
  });

  test("a linked worktree outside the repository's folder inherits from the main repository", () => {
    const root = repo(join(dir, "acme"));
    const worktree = join(dir, "elsewhere", "wt");
    git(root, "worktree", "add", "-q", worktree);
    mkdirSync(join(worktree, "sub"));
    writeFileSync(config, trusted(root));
    expect(gitTrustRoot(worktree)).toBe(root);
    expect(codexFolderTrust(config, worktree).ok).toBe(true);
    expect(codexFolderTrust(config, join(worktree, "sub")).ok).toBe(true);
  });

  test("a linked worktree whose main repository is not trusted is refused, unless the folder itself is", () => {
    const root = repo(join(dir, "acme"));
    const worktree = join(dir, "wt");
    git(root, "worktree", "add", "-q", worktree);
    mkdirSync(join(worktree, "sub"));
    writeFileSync(config, trusted(worktree));
    expect(codexFolderTrust(config, worktree).ok).toBe(true);
    expect(codexFolderTrust(config, join(worktree, "sub"))).toMatchObject(REFUSED);
  });

  test("a plain subfolder of a trusted folder outside git is refused", () => {
    const plain = join(dir, "plain");
    mkdirSync(join(plain, "sub"), { recursive: true });
    writeFileSync(config, trusted(plain));
    expect(gitTrustRoot(join(plain, "sub"))).toBeUndefined();
    expect(codexFolderTrust(config, join(plain, "sub"))).toMatchObject(REFUSED);
  });

  test("the folder's own untrusted entry wins over a trusted repository", () => {
    const root = repo(join(dir, "acme"));
    mkdirSync(join(root, "sub"));
    writeFileSync(config, `${trusted(root)}\n[projects."${join(root, "sub")}"]\ntrust_level = "untrusted"\n`);
    expect(codexFolderTrust(config, join(root, "sub"))).toMatchObject(REFUSED);
  });

  test("a folder in an untrusted repository is refused", () => {
    const root = repo(join(dir, "acme"));
    mkdirSync(join(root, "sub"));
    writeFileSync(config, trusted(join(dir, "other")));
    expect(codexFolderTrust(config, join(root, "sub"))).toMatchObject(REFUSED);
  });

  test("a repository nested in a trusted one answers for itself", () => {
    const outer = repo(join(dir, "outer"));
    const inner = repo(join(outer, "vendor", "inner"));
    writeFileSync(config, trusted(outer));
    expect(gitTrustRoot(join(inner))).toBe(inner);
    expect(codexFolderTrust(config, inner)).toMatchObject(REFUSED);
  });

  test("shapes it cannot follow are refused: a submodule pointer, a malformed pointer, a worktree with a stray commondir", () => {
    const root = repo(join(dir, "acme"));
    writeFileSync(config, trusted(root));

    const submodule = join(root, "mod");
    mkdirSync(join(root, ".git", "modules", "mod"), { recursive: true });
    mkdirSync(submodule);
    writeFileSync(join(submodule, ".git"), "gitdir: ../.git/modules/mod\n");
    expect(gitTrustRoot(submodule)).toBeUndefined();
    expect(codexFolderTrust(config, submodule)).toMatchObject(REFUSED);

    const malformed = join(root, "odd");
    mkdirSync(malformed);
    writeFileSync(join(malformed, ".git"), "not a pointer\n");
    expect(gitTrustRoot(malformed)).toBeUndefined();

    const worktree = join(dir, "wt");
    git(root, "worktree", "add", "-q", worktree);
    writeFileSync(join(root, ".git", "worktrees", "wt", "commondir"), "../../../somewhere-else\n");
    expect(gitTrustRoot(worktree)).toBeUndefined();
    expect(codexFolderTrust(config, worktree)).toMatchObject(REFUSED);
  });
});
