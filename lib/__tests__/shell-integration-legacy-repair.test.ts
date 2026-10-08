import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { END_MARKER, installShellIntegration, MARKER, repairLegacyBlock } from "../shell-integration.ts";
import { rtHealthRows } from "../setup/validators/rt-health.ts";
import { fakeProbes } from "../setup/__tests__/fakes.ts";

const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

// What ensureHistoryHook appended before rt state moved under ~/.mattstack.
const OLD_HISTORY_HOOK = [
  "# rt — shell history hook",
  "# Replay rt run commands in shell history so up-arrow recalls the actual",
  '# command (e.g. "npm run test") instead of "rt run".',
  "_rt_history_hook() {",
  "  if [[ -f ~/.rt/last-run-command ]]; then",
  "    local cmd=$(<~/.rt/last-run-command)",
  '    if [[ -n "$cmd" ]]; then',
  '      if [[ -n "$ZSH_VERSION" ]]; then',
  '        print -s "$cmd"',
  "      else",
  '        history -s "$cmd"',
  "      fi",
  "    fi",
  "    rm -f ~/.rt/last-run-command",
  "  fi",
  "}",
  'if [[ -n "$ZSH_VERSION" ]]; then',
  "  precmd_functions+=(_rt_history_hook)",
  "else",
  '  PROMPT_COMMAND="_rt_history_hook;${PROMPT_COMMAND}"',
  "fi",
  "",
].join("\n");

const OLD_WRAPPER = [
  "",
  "# rt — shell wrapper (enables rt cd to change directory)",
  "rt() {",
  '  if [ "$1" = "cd" ]; then',
  "    local dir",
  '    dir="$(command rt cd "${@:2}")" && [ -n "$dir" ] && builtin cd "$dir"',
  "  else",
  '    command rt "$@"',
  "  fi",
  "}",
  "",
].join("\n");

const TOP = "# placeholder top\nexport TOP_VAR=1\n";
const MEMBER_LINES = "export MEMBER_VAR=placeholder\n# member comment\nexport EXAMPLE_API_KEY=placeholder-key\n";

/** The shape a real member's rc had: rt's marker and PATH line, the member's own lines, rt cd's wrapper, the history hook, and no end marker. */
const MEMBER_RC = `${TOP}\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}${OLD_WRAPPER}${OLD_HISTORY_HOOK}`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("shell-integration — repairing an old rt block with no end marker", () => {
  const origHome = process.env.HOME;
  const origShell = process.env.SHELL;
  let home: string;
  let rcPath: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-shell-legacy-")));
    process.env.HOME = home;
    process.env.SHELL = "/bin/zsh";
    rcPath = join(home, ".zshrc");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    process.env.SHELL = origShell;
    rmSync(home, { recursive: true, force: true });
  });

  function backups(): string[] {
    return readdirSync(home).filter((name) => name.startsWith(".zshrc.rt-backup-"));
  }

  test("a member's rc keeps their lines and the wrapper byte for byte, loses rt's old lines, and gains the current block once", () => {
    writeFileSync(rcPath, MEMBER_RC);

    const result = installShellIntegration({ repair: true });

    expect(result.written).toBe(true);
    expect(result.error).toBeUndefined();
    const content = readFileSync(rcPath, "utf8");
    expect(content.startsWith(`${TOP}${MEMBER_LINES}${OLD_WRAPPER}`)).toBe(true);
    expect(content).not.toContain("~/.rt/last-run-command");
    expect(count(content, MARKER)).toBe(1);
    expect(count(content, END_MARKER)).toBe(1);
    expect(count(content, "# rt — shell history hook")).toBe(1);
    expect(count(content, PATH_LINE)).toBe(1);
    expect(content).toContain("alias rtcd='rt-cd'");
    expect(content.endsWith(`${END_MARKER}\n`)).toBe(true);
  });

  test("the rc file is backed up, unchanged, before it is rewritten", () => {
    writeFileSync(rcPath, MEMBER_RC);

    const result = installShellIntegration({ repair: true });

    const found = backups();
    expect(found).toHaveLength(1);
    expect(readFileSync(join(home, found[0]!), "utf8")).toBe(MEMBER_RC);
    expect(result.backupPath).toBe(join(home, found[0]!));
  });

  test("an rc holding only rt's own old lines repairs to exactly what a fresh install writes", () => {
    writeFileSync(rcPath, `\n${MARKER}\n${PATH_LINE}\nrt-cd() { local dir=$(rt cd 2>/dev/null); [ -n "$dir" ] && cd "$dir"; }\n${OLD_HISTORY_HOOK}`);
    installShellIntegration({ repair: true });
    const repaired = readFileSync(rcPath, "utf8");

    rmSync(rcPath);
    installShellIntegration({ repair: true });
    const fresh = readFileSync(rcPath, "utf8");

    expect(repaired).toBe(fresh);
  });

  test("a second run after a repair changes nothing and writes no second backup", () => {
    writeFileSync(rcPath, MEMBER_RC);
    installShellIntegration({ repair: true });
    const afterFirst = readFileSync(rcPath, "utf8");

    const second = installShellIntegration({ repair: true });

    expect(second).toMatchObject({ alreadyInstalled: true, written: false });
    expect(readFileSync(rcPath, "utf8")).toBe(afterFirst);
    expect(backups()).toHaveLength(1);
  });

  test("a history hook rt does not recognise leaves the file alone and keeps the manual instruction", () => {
    const edited = OLD_HISTORY_HOOK.replace("print -s", "print -sr");
    const rc = `\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}${edited}`;
    writeFileSync(rcPath, rc);

    const result = installShellIntegration({ repair: true });

    expect(result.written).toBe(false);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.error).toContain("by hand");
    expect(readFileSync(rcPath, "utf8")).toBe(rc);
    expect(backups()).toHaveLength(0);
  });

  test("two rt markers are ambiguous, so nothing is touched", () => {
    const rc = `\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}\n${MARKER}\n${PATH_LINE}\n`;
    writeFileSync(rcPath, rc);

    const result = installShellIntegration({ repair: true });

    expect(result.written).toBe(false);
    expect(readFileSync(rcPath, "utf8")).toBe(rc);
    expect(backups()).toHaveLength(0);
  });
});

describe("shell-integration — repair shapes and safety", () => {
  const origHome = process.env.HOME;
  const origShell = process.env.SHELL;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-shell-legacy-shapes-")));
    process.env.HOME = home;
    process.env.SHELL = "/bin/zsh";
  });

  afterEach(() => {
    process.env.HOME = origHome;
    process.env.SHELL = origShell;
    chmodSync(home, 0o755);
    rmSync(home, { recursive: true, force: true });
  });

  function backups(prefix = ".zshrc.rt-backup-"): string[] {
    return readdirSync(home).filter((name) => name.startsWith(prefix));
  }

  test("without repair (the launch-time update run) an old block is left alone and reported, with no backup", () => {
    const rcPath = join(home, ".zshrc");
    writeFileSync(rcPath, MEMBER_RC);

    const result = installShellIntegration();

    expect(result.written).toBe(false);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.error).toContain("needs updating");
    expect(readFileSync(rcPath, "utf8")).toBe(MEMBER_RC);
    expect(backups()).toHaveLength(0);
  });

  test("a bash rc repairs the same way", () => {
    process.env.SHELL = "/bin/bash";
    const rcPath = join(home, ".bash_profile");
    writeFileSync(rcPath, MEMBER_RC);

    const result = installShellIntegration({ repair: true });

    expect(result.written).toBe(true);
    expect(readFileSync(rcPath, "utf8").startsWith(`${TOP}${MEMBER_LINES}${OLD_WRAPPER}`)).toBe(true);
    expect(backups(".bash_profile.rt-backup-")).toHaveLength(1);
  });

  test("a symlinked rc keeps its link; the file it points at is repaired", () => {
    mkdirSync(join(home, "dotfiles"));
    const target = join(home, "dotfiles", "zshrc");
    writeFileSync(target, MEMBER_RC);
    const rcPath = join(home, ".zshrc");
    symlinkSync(target, rcPath);

    const result = installShellIntegration({ repair: true });

    expect(result.written).toBe(true);
    expect(lstatSync(rcPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain(END_MARKER);
    expect(readdirSync(join(home, "dotfiles"))).toEqual(["zshrc"]);
  });

  test("a failed write still names the backup, so the member can find the previous file", () => {
    mkdirSync(join(home, "dotfiles"));
    const target = join(home, "dotfiles", "zshrc");
    writeFileSync(target, MEMBER_RC);
    const rcPath = join(home, ".zshrc");
    symlinkSync(target, rcPath);
    chmodSync(join(home, "dotfiles"), 0o555);

    try {
      const result = installShellIntegration({ repair: true });
      expect(result.written).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.backupPath).toBe(join(home, backups()[0]!));
      expect(readFileSync(target, "utf8")).toBe(MEMBER_RC);
    } finally {
      chmodSync(join(home, "dotfiles"), 0o755);
    }
  });

  test("the repaired file reads ready on the Shell integration row", async () => {
    const rcPath = join(home, ".zshrc");
    writeFileSync(rcPath, MEMBER_RC);
    installShellIntegration({ repair: true });

    const p = fakeProbes({ home, env: { SHELL: "/bin/zsh" }, files: { [rcPath]: readFileSync(rcPath, "utf8") } });
    const shellRow = (await rtHealthRows(p, { ci: false })).find((r) => r.id === "tool.shell")!;

    expect(shellRow.status).toBe("ready");
  });
});

describe("repairLegacyBlock (pure)", () => {
  test("a CRLF marker line is not rt's marker, so it refuses", () => {
    expect(repairLegacyBlock(`\r\n${MARKER}\r\n${PATH_LINE}\r\n${MEMBER_LINES}`)).toBeNull();
  });

  test("a marker with a trailing space is not rt's marker, so it refuses", () => {
    expect(repairLegacyBlock(`\n${MARKER} \n${PATH_LINE}\n${MEMBER_LINES}`)).toBeNull();
  });

  test("an indented PATH line under the marker is the member's, so it stays", () => {
    expect(repairLegacyBlock(`\n${MARKER}\n  ${PATH_LINE}\n${MEMBER_LINES}`)).toBe(`  ${PATH_LINE}\n${MEMBER_LINES}`);
  });

  test("a member's own copy of the PATH line stays, under the block or later", () => {
    expect(repairLegacyBlock(`\n${MARKER}\n${PATH_LINE}\n${PATH_LINE}\n${MEMBER_LINES}`)).toBe(`${PATH_LINE}\n${MEMBER_LINES}`);
    expect(repairLegacyBlock(`\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}${PATH_LINE}\n`)).toBe(`${MEMBER_LINES}${PATH_LINE}\n`);
  });

  test("an rt-cd line away from the block's lead is left alone", () => {
    const rtCd = 'rt-cd() { local dir=$(rt cd 2>/dev/null); [ -n "$dir" ] && cd "$dir"; }';
    expect(repairLegacyBlock(`\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}${rtCd}\n`)).toBe(`${MEMBER_LINES}${rtCd}\n`);
  });

  test("member content after the history hook stays", () => {
    expect(repairLegacyBlock(`${MEMBER_RC}export AFTER_VAR=1\n`)).toBe(`${TOP}${MEMBER_LINES}${OLD_WRAPPER}export AFTER_VAR=1\n`);
  });

  test("returns the content without rt's old lines", () => {
    expect(repairLegacyBlock(MEMBER_RC)).toBe(`${TOP}${MEMBER_LINES}${OLD_WRAPPER}`);
  });

  test("returns null for a shape it cannot bound", () => {
    expect(repairLegacyBlock(`${MARKER}\n${OLD_HISTORY_HOOK.replace("rm -f", "rm -rf")}`)).toBeNull();
  });
});
