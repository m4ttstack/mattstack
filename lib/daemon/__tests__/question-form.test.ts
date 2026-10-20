import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasQuestionForm } from "../question-form.ts";
import { CAPTURED_WIDE } from "./trust-workspace-fixtures.ts";

// Captured with `herdr pane read <pane> --source visible` from a Claude Code
// 2.1.284 pane holding an AskUserQuestion form: one multi-select question
// (`↑/↓ to navigate`) and a two-question form (`Tab/Arrow keys to navigate`).
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

describe("hasQuestionForm", () => {
  test("a captured single-question form reads as a form", () => {
    expect(hasQuestionForm(fixture("question-form-single.txt"))).toBe(true);
  });

  test("a captured multi-question form reads as a form", () => {
    expect(hasQuestionForm(fixture("question-form-multi.txt"))).toBe(true);
  });

  test("trailing blank rows below the footer still read as a form", () => {
    expect(hasQuestionForm(`${fixture("question-form-multi.txt")}\n\n   \n`)).toBe(true);
  });

  test("the folder-trust dialog is not a question form", () => {
    expect(hasQuestionForm(CAPTURED_WIDE)).toBe(false);
  });

  test("an idle prompt footer is not a form", () => {
    expect(hasQuestionForm(fixture("pane-footer-1-shell.txt"))).toBe(false);
  });

  test("a footer scrolled up by later output is not a form", () => {
    expect(hasQuestionForm(`${fixture("question-form-single.txt")}\n⏺ User answered Claude's questions:\n`)).toBe(false);
  });

  // BOARD-57: a pane whose Claude Code input is not docked to the bottom of
  // the terminal leaves rows under the form, so the footer is not the last
  // screen line.
  // Claude Code's default inline renderer draws the form right under the
  // transcript with blank rows below it; fullscreen ("tui": "fullscreen")
  // docks it to the bottom row. Both must read as a form.
  test("a form drawn by the default inline renderer reads as a form", () => {
    expect(hasQuestionForm(fixture("question-form-inline.txt"))).toBe(true);
  });

  test("a form whose input is not docked to the pane bottom reads as a form", () => {
    const below = "  ⏵⏵ auto mode on (shift+tab to cycle)\n  O 5.5 [high] | claude | board-57\n";
    expect(hasQuestionForm(`${fixture("question-form-single.txt")}\n${below}\n\n\n`)).toBe(true);
  });

  test("a footer wrapped by a narrow pane reads as a form", () => {
    const narrow = fixture("question-form-multi.txt").replace(
      /Enter to select · (.+) to navigate · Esc to cancel/,
      "Enter to select · $1 to\nnavigate · Esc to cancel",
    );
    expect(hasQuestionForm(narrow)).toBe(true);
  });

  test("the vim-mode footer with no Esc hint reads as a form", () => {
    const vim = fixture("question-form-single.txt").replace(
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
      "-- INSERT -- · Enter to select · ↑/↓ to navigate · ctrl+g to edit in Zed",
    );
    expect(hasQuestionForm(vim)).toBe(true);
  });

  test("a footer far above the bottom of the screen is not a form", () => {
    const tail = Array.from({ length: 40 }, (_, i) => `  output line ${i + 1}`).join("\n");
    expect(hasQuestionForm(`${fixture("question-form-single.txt")}\n${tail}\n`)).toBe(false);
  });

  test("transcript text quoting the footer above an idle prompt is not a form", () => {
    const quoted = "⏺ The detector now matches this footer:\n  Enter to select · ↑/↓ to navigate · Esc to cancel\n\n";
    expect(hasQuestionForm(`${quoted}${fixture("pane-footer-1-shell.txt").split("\n").slice(6).join("\n")}`)).toBe(false);
  });

  test("a form above a long agents panel reads as a form", () => {
    const agents = Array.from({ length: 10 }, (_, i) => `  ◯ general-purpose  Task ${i + 1}   12s · ↓ 1k tokens`).join("\n");
    const panel = `  ⏵⏵ auto mode on · 10 shells\n\n  ⏺ main\n${agents}\n`;
    expect(hasQuestionForm(`${fixture("question-form-single.txt")}\n${panel}`)).toBe(true);
  });

  test("an empty screen is not a form", () => {
    expect(hasQuestionForm("")).toBe(false);
  });
});
