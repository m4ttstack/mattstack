/**
 * Claude Code reads `allowed-tools` as a YAML list, or a string whose rules are
 * separated by spaces or commas. A separator inside a rule's parentheses or
 * quotes belongs to the rule: `Bash(git log, git show)` is one rule.
 */
export function splitToolRules(value: string): string[] {
  return split(value, true) ?? split(value, false)!;
}

/** Null when a quote never closes: a lone apostrophe (`don't`) is not a quote, so the caller splits again ignoring quotes. */
function split(value: string, honourQuotes: boolean): string[] | null {
  const rules: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of value) {
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (honourQuotes && depth > 0 && (ch === '"' || ch === "'")) {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      if (current.trim() !== "") rules.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote !== null) return null;
  if (current.trim() !== "") rules.push(current.trim());
  return rules;
}

export function parseAllowedTools(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  if (typeof raw === "string") return splitToolRules(raw);
  return [];
}
