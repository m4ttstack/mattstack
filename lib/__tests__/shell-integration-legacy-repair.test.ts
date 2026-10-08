import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { END_MARKER, installShellIntegration, MARKER, repairLegacyBlock } from "../shell-integration.ts";

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
    home = mkdtempSync(join(tmpdir(), "rt-shell-legacy-"));
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

    const result = installShellIntegration();

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

    const result = installShellIntegration();

    const found = backups();
    expect(found).toHaveLength(1);
    expect(readFileSync(join(home, found[0]!), "utf8")).toBe(MEMBER_RC);
    expect(result.backupPath).toBe(join(home, found[0]!));
  });

  test("an rc holding only rt's own old lines repairs to exactly what a fresh install writes", () => {
    writeFileSync(rcPath, `\n${MARKER}\n${PATH_LINE}\nrt-cd() { local dir=$(rt cd 2>/dev/null); [ -n "$dir" ] && cd "$dir"; }\n${OLD_HISTORY_HOOK}`);
    installShellIntegration();
    const repaired = readFileSync(rcPath, "utf8");

    rmSync(rcPath);
    installShellIntegration();
    const fresh = readFileSync(rcPath, "utf8");

    expect(repaired).toBe(fresh);
  });

  test("a second run after a repair changes nothing and writes no second backup", () => {
    writeFileSync(rcPath, MEMBER_RC);
    installShellIntegration();
    const afterFirst = readFileSync(rcPath, "utf8");

    const second = installShellIntegration();

    expect(second).toMatchObject({ alreadyInstalled: true, written: false });
    expect(readFileSync(rcPath, "utf8")).toBe(afterFirst);
    expect(backups()).toHaveLength(1);
  });

  test("a history hook rt does not recognise leaves the file alone and keeps the manual instruction", () => {
    const edited = OLD_HISTORY_HOOK.replace("print -s", "print -sr");
    const rc = `\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}${edited}`;
    writeFileSync(rcPath, rc);

    const result = installShellIntegration();

    expect(result.written).toBe(false);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.error).toContain("by hand");
    expect(readFileSync(rcPath, "utf8")).toBe(rc);
    expect(backups()).toHaveLength(0);
  });

  test("two rt markers are ambiguous, so nothing is touched", () => {
    const rc = `\n${MARKER}\n${PATH_LINE}\n${MEMBER_LINES}\n${MARKER}\n${PATH_LINE}\n`;
    writeFileSync(rcPath, rc);

    const result = installShellIntegration();

    expect(result.written).toBe(false);
    expect(readFileSync(rcPath, "utf8")).toBe(rc);
    expect(backups()).toHaveLength(0);
  });
});

describe("repairLegacyBlock (pure)", () => {
  test("returns the content without rt's old lines", () => {
    expect(repairLegacyBlock(MEMBER_RC)).toBe(`${TOP}${MEMBER_LINES}${OLD_WRAPPER}`);
  });

  test("returns null for a shape it cannot bound", () => {
    expect(repairLegacyBlock(`${MARKER}\n${OLD_HISTORY_HOOK.replace("rm -f", "rm -rf")}`)).toBeNull();
  });
});
