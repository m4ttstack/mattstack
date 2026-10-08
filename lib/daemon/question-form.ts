/** Claude Code's AskUserQuestion footer. The navigate hint varies with the
    question count ("↑/↓" for one, "Tab/Arrow keys" for several); the
    folder-trust and relocation dialogs say "Enter to confirm", never
    "Enter to select", so they never match. */
const FORM_FOOTER_RE = /^Enter to select · .+ · Esc to cancel$/;

export function lastScreenLine(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line !== "") return line;
  }
  return "";
}

/** True when the pane's visible screen ends in an AskUserQuestion form.
    herdr's agent status can go stale on a pane whose form has sat through
    a sleep/wake, so the screen is the evidence a form is up. */
export function hasQuestionForm(screen: string): boolean {
  return FORM_FOOTER_RE.test(lastScreenLine(screen));
}
