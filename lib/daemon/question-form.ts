/** Claude Code's AskUserQuestion footer. The navigate hint varies with the
    question count ("↑/↓" for one, "Tab/Arrow keys" for several), vim mode
    prefixes "-- INSERT -- · " and drops "Esc to cancel", and a narrow pane
    wraps the rest onto the next row, so the start of the footer is what is
    matched. The folder-trust and relocation dialogs say "Enter to confirm",
    never "Enter to select", so they never match. */
const FORM_FOOTER_START_RE = /^(?:-- [A-Z][A-Z ]* -- · )?Enter to select(?: · |\s*$)/;

/** A pane whose Claude Code input is not docked to the bottom of the
    terminal leaves rows under the form (BOARD-57): the status line, the
    mode line and one agents-panel row per running agent or shell. The
    footer is looked for among the bottom rows, up to the first stopper. */
const BOTTOM_REGION_ROWS = 30;

/** Rows at column 0 that end the search: a transcript entry ("⏺") means the
    form was answered or dismissed and the session went on, and a prompt
    input ("❯") means no form is up. The agents panel's "  ⏺ main" row is
    indented and the form's own "❯ 1." cursor row sits above its footer, so
    neither stops a real form. */
const STOPPER_RE = /^[⏺❯]/;

export function lastScreenLine(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line !== "") return line;
  }
  return "";
}

/** True when the bottom of the pane's visible screen holds an
    AskUserQuestion form footer at column 0 with no stopper row after it. herdr's
    agent status can go stale on a pane whose form has sat through a
    sleep/wake, so the screen is the evidence a form is up. */
export function hasQuestionForm(screen: string): boolean {
  const rows = screen.split("\n").filter((row) => row.trim() !== "");
  const region = rows.slice(-BOTTOM_REGION_ROWS);
  for (let i = region.length - 1; i >= 0; i--) {
    const row = region[i]!;
    if (STOPPER_RE.test(row)) return false;
    // Column 0 only: an indented row is transcript text quoting the footer.
    if (FORM_FOOTER_START_RE.test(row)) return true;
  }
  return false;
}
