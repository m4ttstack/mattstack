/** Claude Code's AskUserQuestion footer. The navigate hint varies with the
    question count ("↑/↓" for one, "Tab/Arrow keys" for several), vim mode
    prefixes "-- INSERT -- · " and drops "Esc to cancel", and a narrow pane
    wraps the rest onto the next row, so the start of the footer is what is
    matched. The folder-trust and relocation dialogs say "Enter to confirm",
    never "Enter to select", so they never match. */
const FORM_FOOTER_START_RE = /^(?:-- [A-Z][A-Z ]* -- · )?Enter to select(?: · |$)/;

/** A pane whose Claude Code input is not docked to the bottom of the
    terminal leaves rows under the form (BOARD-57), so the footer is looked
    for among the last few non-blank rows rather than on the last one. */
const BOTTOM_REGION_ROWS = 8;

/** A row at column 0 starting a transcript entry: the form was answered or
    dismissed and the session went on. The agents panel's "  ⏺ main" row is
    indented, so it does not count. */
const TRANSCRIPT_ENTRY_RE = /^⏺/;

export function lastScreenLine(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line !== "") return line;
  }
  return "";
}

/** True when the bottom of the pane's visible screen holds an
    AskUserQuestion form footer with no transcript entry after it. herdr's
    agent status can go stale on a pane whose form has sat through a
    sleep/wake, so the screen is the evidence a form is up. */
export function hasQuestionForm(screen: string): boolean {
  const rows = screen.split("\n").filter((row) => row.trim() !== "");
  const region = rows.slice(-BOTTOM_REGION_ROWS);
  for (let i = region.length - 1; i >= 0; i--) {
    const row = region[i]!;
    if (TRANSCRIPT_ENTRY_RE.test(row)) return false;
    if (FORM_FOOTER_START_RE.test(row.trim())) return true;
  }
  return false;
}
