import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function stripFrontmatter(
  md: string,
): { body: string; frontmatter: Record<string, unknown>; bodyStartLine: number } {
  const match = md.match(FRONTMATTER_RE);
  const fmBlock = match?.[0] ?? "";
  const rest = match ? md.slice(match[0].length) : md;
  const parsed = match ? parseYaml(match[1] ?? "") : undefined;
  const frontmatter = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const body = rest.trim();

  // Measure the head only: `body` is trimmed at both ends, so a
  // length-difference formula would count trailing blank lines as leading
  // ones and silently mis-locate every seam that points into a real file.
  const lead = rest.length - rest.trimStart().length;
  const countLines = (s: string) => (s.match(/\n/g) ?? []).length;
  const bodyStartLine = countLines(fmBlock) + countLines(rest.slice(0, lead)) + 1;

  return { body, frontmatter, bodyStartLine };
}
