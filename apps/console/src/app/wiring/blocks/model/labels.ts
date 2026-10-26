/** `1 step`, `2 steps`: a count with its noun, singular only at one. */
export function countOf(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** An exit label up to its first colon: `no: redo with their note` reads `no`. */
export function cutLabel(label: string): string {
  return label.split(':', 1)[0]!.trim();
}

/** The most of an exit label a graph line carries; past it the label ends
    in an ellipsis and shows whole on hover. */
export const EXIT_CHARS = 24;

export function exitLabel(label: string): string {
  return label.length > EXIT_CHARS
    ? `${label.slice(0, EXIT_CHARS - 1).trimEnd()}…`
    : label;
}

/** A graph-only label drops a trailing parenthetical that only names the
    skill in view: `Checks pass (ship)?` reads `Checks pass?` on ship. */
export function shortLabel(label: string, skill: string | undefined): string {
  if (!skill) return label;
  const named = new RegExp(
    `\\s*\\(${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)(\\??)$`
  );
  return label.replace(named, '$1');
}
