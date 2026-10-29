import { describe, expect, test } from "bun:test";
import { readTrustPrompt } from "../trust-dialog.ts";
import { CAPTURED_ACCOUNT_2, CAPTURED_NARROW, CAPTURED_WIDE, FIXTURE_PATH, workspaceScreen } from "./trust-workspace-fixtures.ts";

/** The plain first-run dialog: the cursor starts on "Yes, proceed". */
const PLAIN = [
  "╭──────────────────────────────────────────────╮",
  "│ Do you trust the files in this folder?       │",
  "│                                              │",
  "│ /Users/matt/Documents/GitHub/glance          │",
  "│                                              │",
  "│ Claude Code may read files in this folder.   │",
  "│                                              │",
  "│ ❯ 1. Yes, proceed                            │",
  "│   2. No, exit                                │",
  "╰──────────────────────────────────────────────╯",
].join("\n");

/** The elevated variant: the cursor defaults to "No, exit". */
const ELEVATED = [
  "╭──────────────────────────────────────────────────────────────╮",
  "│ Do you trust the files in this folder?                       │",
  "│                                                              │",
  "│ /Users/matt/Documents/GitHub/apps                            │",
  "│                                                              │",
  "│ This folder pre-approves 12 tool permissions in              │",
  "│ .claude/settings.local.json. Only proceed if you trust the   │",
  "│ authors of those settings.                                   │",
  "│                                                              │",
  "│   1. Yes, proceed                                            │",
  "│ ❯ 2. No, exit                                                │",
  "╰──────────────────────────────────────────────────────────────╯",
].join("\n");

describe("readTrustPrompt", () => {
  test("a screen with no trust dialog is not a prompt", () => {
    expect(readTrustPrompt("$ claude\nworking on the brief...\n")).toBeNull();
  });

  test("a brief that merely mentions trust is not a prompt", () => {
    expect(readTrustPrompt("reading the brief: trust the fixture owner\n")).toBeNull();
  });

  test("the plain dialog accepts with a bare enter", () => {
    expect(readTrustPrompt(PLAIN)).toEqual({ kind: "accept", variant: "plain", keys: ["enter"] });
  });

  test("the elevated dialog walks up to Yes before entering", () => {
    expect(readTrustPrompt(ELEVATED)).toEqual({ kind: "accept", variant: "elevated", keys: ["up", "enter"] });
  });

  test("the variant names the dialog's own text, not the cursor's distance", () => {
    const preApprovedButCursorOnYes = [
      "Do you trust the files in this folder?",
      "This folder pre-approves 12 tool permissions in .claude/settings.local.json.",
      "❯ 1. Yes, proceed",
      "  2. No, exit",
    ].join("\n");
    expect(readTrustPrompt(preApprovedButCursorOnYes)).toEqual({ kind: "accept", variant: "elevated", keys: ["enter"] });
  });

  test("a cursor below the accept option walks up once per option", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "  1. Yes, proceed",
      "  2. Ask me later",
      "❯ 3. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "accept", variant: "plain", keys: ["up", "up", "enter"] });
  });

  test("a cursor above the accept option walks down", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "❯ 1. No, exit",
      "  2. Yes, proceed",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "accept", variant: "plain", keys: ["down", "enter"] });
  });

  test("a trust dialog whose cursor cannot be located is undrivable, never a guessed enter", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "  1. Yes, proceed",
      "  2. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "undrivable" });
  });

  test("a trust dialog with no accept option is undrivable", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "❯ 1. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "undrivable" });
  });

  test("the header is recognized even when the options have scrolled off", () => {
    expect(readTrustPrompt("│ Do you trust the files in this folder?  │\n")).toEqual({ kind: "undrivable" });
  });
});

describe("readTrustPrompt: the 2.1.283 workspace dialog", () => {
  test("the captured dialog parses to its path, walking down off No", () => {
    expect(readTrustPrompt(CAPTURED_WIDE)).toEqual({ kind: "accept", variant: "workspace", path: FIXTURE_PATH, keys: ["down", "enter"] });
  });

  // CAPTURED_NARROW carries a decoy row with a decomposed accent (one cell,
  // two code points): a width measured in code points would read that row as
  // wider than the rule and misparse the whole dialog as undrivable.
  test("the narrow capture, under the shell's echo, parses the same", () => {
    expect(readTrustPrompt(CAPTURED_NARROW)).toEqual({ kind: "accept", variant: "workspace", path: FIXTURE_PATH, keys: ["down", "enter"] });
  });

  test("a cursor already on Yes is a bare enter", () => {
    expect(readTrustPrompt(workspaceScreen({ cursor: "yes" }))).toEqual({ kind: "accept", variant: "workspace", path: FIXTURE_PATH, keys: ["enter"] });
  });

  test("quoted wording without the live footer at the bottom is no dialog", () => {
    const quoted = `${CAPTURED_WIDE}\n$ echo done\ndone\n$ `;
    expect(readTrustPrompt(quoted)).toBeNull();
  });

  test("a painted rule narrower than the screen's text is undrivable, never no dialog: the live options are present", () => {
    const lines = CAPTURED_WIDE.split("\n");
    lines[0] = "─".repeat(40);
    expect(readTrustPrompt(lines.join("\n"))).toEqual({ kind: "undrivable" });
  });

  test("the wide capture with its first row (the rule) removed is undrivable", () => {
    const lines = CAPTURED_WIDE.split("\n").slice(1);
    expect(readTrustPrompt(lines.join("\n"))).toEqual({ kind: "undrivable" });
  });

  test("the wide capture with its first three rows removed is undrivable", () => {
    const lines = CAPTURED_WIDE.split("\n").slice(3);
    expect(readTrustPrompt(lines.join("\n"))).toEqual({ kind: "undrivable" });
  });

  test("a 175-character row inserted above the rule is undrivable", () => {
    const lines = CAPTURED_WIDE.split("\n");
    lines.unshift("x".repeat(175));
    expect(readTrustPrompt(lines.join("\n"))).toEqual({ kind: "undrivable" });
  });

  test("a footer under some other layout is no dialog", () => {
    const menu = ["─".repeat(60), " Select model", "", " ❯ Opus", "   Sonnet", "", " Enter to confirm · Esc to cancel"].join("\n");
    expect(readTrustPrompt(menu)).toBeNull();
  });

  test("a wrapped path is undrivable, never rejoined", () => {
    const lines = CAPTURED_WIDE.split("\n");
    const i = lines.indexOf(` ${FIXTURE_PATH}`);
    lines.splice(i, 1, " /Users/matt/.mattstack/teams/acme/.worktrees/t38fix-", " devservers");
    expect(readTrustPrompt(lines.join("\n"))).toEqual({ kind: "undrivable" });
  });

  test("options with no cursor are undrivable", () => {
    const screen = CAPTURED_WIDE.replace(" ❯ No, exit", "   No, exit");
    expect(readTrustPrompt(screen)).toEqual({ kind: "undrivable" });
  });

  test("the old layout still parses without a path", () => {
    expect(readTrustPrompt(PLAIN)).toEqual({ kind: "accept", variant: "plain", keys: ["enter"] });
  });

  // Copied from the board gate gallery's own capture of the same dialog
  // (apps/board/src/client/board/gate-gallery.fixtures.ts, Account-2).
  test("a second real capture, from an Account-2 pane, parses to its own path", () => {
    expect(readTrustPrompt(CAPTURED_ACCOUNT_2)).toEqual({ kind: "accept", variant: "workspace", path: "/Users/pat/.mattstack/teams/acme", keys: ["down", "enter"] });
  });
});
