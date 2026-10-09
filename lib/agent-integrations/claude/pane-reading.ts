/**
 * What a herdr pane running Claude Code shows about its background work.
 * Native screen knowledge stays here, with the Claude integration; generic
 * supervision asks the integration rather than parsing a footer itself.
 */

// Claude Code draws its status footer below the composer's bottom rule, so
// only that region is read: a transcript line quoting "1 shell" never counts.
// The agents panel exists only while a subagent is still running.
const RULE_LINE = /^\s*─{10,}\s*$/;
const FOOTER_TASK_COUNT = /\b[1-9]\d* (?:shells?|monitors?)\b/;
const AGENTS_PANEL_MAIN = /^\s*⏺ main\s*$/;

const LIVE_TIMER = /(?:\s+\d+[hms])+$/;

/** The background shell, monitor or subagent the footer names, or null when it names none. */
export function backgroundTask(screen: string): string | null {
  const lines = screen.split("\n");
  let rule = -1;
  for (let i = 0; i < lines.length; i++) if (RULE_LINE.test(lines[i]!)) rule = i;
  if (rule < 0) return null;
  const footer = lines.slice(rule + 1);
  for (const line of footer) {
    const segment = line.split(" · ").find((part) => FOOTER_TASK_COUNT.test(part));
    if (segment !== undefined) return segment.trim();
  }
  const main = footer.findIndex((line) => AGENTS_PANEL_MAIN.test(line));
  if (main < 0) return null;
  const row = footer.slice(main + 1).find((line) => line.trim().length > 0);
  if (row === undefined) return null;
  return `subagent ${row.split(" · ")[0]!.replace(/^\s*◯\s*/, "").replace(/\s+/g, " ").trim().replace(LIVE_TIMER, "")}`;
}
