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

  test("an empty screen is not a form", () => {
    expect(hasQuestionForm("")).toBe(false);
  });
});
