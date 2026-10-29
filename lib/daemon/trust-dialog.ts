/**
 * Claude Code's pre-claude folder-trust modal, read off a pane screen.
 *
 * The old layout ships two variants sharing one header and opposite
 * defaults: the plain first-run dialog starts on "Yes, proceed", and the
 * elevated one a repo's pre-approved tool permissions raise starts on
 * "No, exit". Claude Code 2.1.283's workspace layout has no such header; it
 * is anchored on its own full-width rule and footer instead, and it names
 * the folder it asks about directly in its body. A bare Enter can accept
 * the wrong option on any of these, so the key sequence is always computed
 * from the cursor's position rather than assumed.
 *
 * A dialog whose cursor or accept option cannot be located comes back
 * `undrivable` instead of falling back to Enter: pressing Enter blind is
 * exactly the move that exits the session on the elevated variant, and a
 * surfaced stuck pane costs a keypress where a wrong guess costs the worker.
 */

export type TrustPrompt =
  | { kind: "accept"; variant: "plain" | "elevated" | "workspace"; keys: Array<"up" | "down" | "enter">; path?: string }
  | { kind: "undrivable" };

const HEADER_RE = /do you trust the files in this folder/i;
// Leading box-drawing runs and the trailing border are stripped so a boxed
// option line parses the same as a bare one.
const OPTION_RE = /^[\s│|┃╎┆]*(?<cursor>[❯>])?\s*(?<index>\d+)\.\s+(?<label>.*?)\s*[│|┃╎┆]?\s*$/;
const ACCEPT_RE = /^yes\b/i;
// The elevated variant's own body text, and the only honest way to name it:
// the cursor's distance says which keys to press, never which dialog this is.
const ELEVATED_RE = /pre-approve\w*\s+\d*\s*tool permissions/i;

interface Option { cursor: boolean; label: string }

function readOptions(screen: string): Option[] {
  const out: Option[] = [];
  for (const line of screen.split("\n")) {
    const m = OPTION_RE.exec(line);
    if (!m?.groups) continue;
    out.push({ cursor: m.groups.cursor !== undefined, label: m.groups.label ?? "" });
  }
  return out;
}

/**
 * The trust modal on `screen` and how to accept it, or null when the screen
 * is not showing one. The old layout is anchored on the header its two
 * variants share; the 2.1.283 workspace layout has no header and is
 * anchored on its own rule and footer instead. Either way, a brief or a
 * transcript that merely mentions trust never matches.
 */
export function readTrustPrompt(screen: string): TrustPrompt | null {
  const workspace = readWorkspacePrompt(screen.split("\n"));
  if (workspace !== null) return workspace;
  if (!HEADER_RE.test(screen)) return null;
  const options = readOptions(screen);
  return walkToAccept(options, (keys) => ({ kind: "accept", variant: ELEVATED_RE.test(screen) ? "elevated" : "plain", keys }));
}

function walkToAccept<T>(options: Option[], make: (keys: Array<"up" | "down" | "enter">) => T, acceptRe: RegExp = ACCEPT_RE): T | { kind: "undrivable" } {
  const selected = options.findIndex((o) => o.cursor);
  const accept = options.findIndex((o) => acceptRe.test(o.label));
  if (selected < 0 || accept < 0) return { kind: "undrivable" };
  const distance = accept - selected;
  const step = distance < 0 ? "up" : "down";
  return make([...Array(Math.abs(distance)).fill(step), "enter"]);
}

// Claude Code 2.1.283's layout. Every anchor sits at its own column and the
// whole dialog must end the screen: the pane's shell echo of claude's command
// line sits right above it and can quote any of this wording.
const WS_FOOTER_RE = /^ Enter to confirm · Esc to cancel\s*$/;
const WS_HEADER_RE = /^ Accessing workspace:\s*$/;
const WS_QUESTION_RE = /^ Quick safety check:/;
const WS_OPTION_RE = /^ (?<cursor>❯| ) (?<label>\S.*?)\s*$/;
const WS_ACCEPT_RE = /^Yes, I trust this folder/;
const WS_WINDOW_CAP = 24;

// Terminal cells, not code points or UTF-16 units: an emoji in the echoed
// brief above the dialog is two cells wide despite being one code point, and
// a decomposed accent (a base letter plus a combining mark, as macOS
// filenames produce) is one cell wide despite being two code points.
// Counting code points would make a row with a decomposed accent read wider
// than the rule that actually bounds it.
const width = (s: string): number => Bun.stringWidth(s);

function readWorkspacePrompt(lines: string[]): TrustPrompt | null {
  let end = lines.length - 1;
  while (end >= 0 && (lines[end] as string).trim() === "") end--;
  if (end < 0 || !WS_FOOTER_RE.test(lines[end] as string)) return null;
  let last = end - 1;
  while (last >= 0 && (lines[last] as string).trim() === "") last--;
  if (last < 0 || !WS_OPTION_RE.test(lines[last] as string)) return null;
  let first = last;
  while (first > 0 && WS_OPTION_RE.test(lines[first - 1] as string)) first--;
  const options: Option[] = lines.slice(first, last + 1).map((l) => {
    const m = WS_OPTION_RE.exec(l);
    return { cursor: m?.groups?.cursor === "❯", label: m?.groups?.label ?? "" };
  });
  // Once the live accept option is on screen, this is a real dialog and
  // every later failure below is the top scrolling off or the rule failing
  // to parse, never "no dialog here": a footer shared with some other
  // layout (a model picker) that never shows this label stays null instead.
  const live = options.some((o) => WS_ACCEPT_RE.test(o.label));
  const fail = (): TrustPrompt | null => (live ? { kind: "undrivable" } : null);

  let top = -1;
  for (let i = first - 1; i >= Math.max(0, first - WS_WINDOW_CAP); i--) {
    if (RULE_RE.test(lines[i] as string)) { top = i; break; }
  }
  if (top < 0) return fail();
  const rule = (lines[top] as string).trimEnd();
  const ruleWidth = width(rule);
  // The real rule spans the pane; a command can paint one, but never wider
  // than the text around it.
  if (lines.some((l) => width(l.trimEnd()) > ruleWidth)) return fail();
  const body = lines.slice(top + 1, first).filter((l) => l.trim() !== "");
  if (!WS_HEADER_RE.test(body[0] ?? "")) return fail();
  const pathRow = body[1] ?? "";
  // A path wider than the pane wraps onto the next row; the question must
  // follow the path row directly, or the path is not whole on it.
  if (!pathRow.startsWith(" /") || !WS_QUESTION_RE.test(body[2] ?? "")) return { kind: "undrivable" };
  const path = pathRow.slice(1).trimEnd();
  return walkToAccept(options, (keys) => ({ kind: "accept", variant: "workspace", path, keys }), WS_ACCEPT_RE);
}
