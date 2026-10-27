// Ported from lib/daemon/question-form.ts (`hasQuestionForm`): the board is
// its own package and does not import rt's daemon tree. Keep the two in step;
// apps/board/src/__tests__/question-form.test.ts runs both on the same screens.

/** Claude Code's AskUserQuestion footer. The navigate hint varies with the
    question count ("↑/↓" for one, "Tab/Arrow keys" for several), vim mode
    prefixes "-- INSERT -- · " and drops "Esc to cancel", and a narrow pane
    wraps the rest onto the next row, so the start of the footer is what is
    matched. The folder-trust and relocation dialogs say "Enter to confirm",
    never "Enter to select", so they never match. */
const FORM_FOOTER_START_RE =
  /^(?:-- [A-Z][A-Z ]* -- · )?Enter to select(?: · |\s*$)/;

/** Rows under the form a pane whose input is not docked to the bottom can
    leave (status line, mode line, agents panel). */
const BOTTOM_REGION_ROWS = 30;

/** Column-0 rows that end the search: a transcript entry ("⏺") or a prompt
    input ("❯") means no form is up. */
const STOPPER_RE = /^[⏺❯]/;

/** True when the bottom of the pane's visible screen holds an
    AskUserQuestion form footer at column 0 with no stopper row after it. */
export function hasQuestionForm(screen: string): boolean {
  const rows = screen.split('\n').filter(row => row.trim() !== '');
  const region = rows.slice(-BOTTOM_REGION_ROWS);
  for (let i = region.length - 1; i >= 0; i--) {
    const row = region[i]!;
    if (STOPPER_RE.test(row)) return false;
    // Column 0 only: an indented row is transcript text quoting the footer.
    if (FORM_FOOTER_START_RE.test(row)) return true;
  }
  return false;
}
