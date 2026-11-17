import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllowedTools } from "./allowed-tools.ts";
import { HEADER_COMMENT } from "./compile.ts";
import { stripFrontmatter } from "./sources.ts";

export const LOAD_SKILL_TOOL = "mcp__mattstack__load_skill";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Claude Code fills `${CLAUDE_SKILL_DIR}` when it loads a husk, so the tool gets the folder that pins the installed pack version. */
function huskBody(id: string): string {
  return (
    `Before anything else, call \`${LOAD_SKILL_TOOL} {skill: "${id}", dir: "\${CLAUDE_SKILL_DIR}"}\`. ` +
    "What it returns is this skill's full text: follow it as the skill. " +
    "If the tool says any part was saved to a file, Read that whole file first. If the call fails, stop and say so."
  );
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The frontmatter lines with `allowed-tools` rewritten as a list that ends with the load tool, in the key's own place. */
function withLoadTool(lines: string[], rules: string[]): string[] {
  const list = ["allowed-tools:", ...[...rules.filter((r) => r !== LOAD_SKILL_TOOL), LOAD_SKILL_TOOL].map((r) => `  - ${yamlQuote(r)}`)];
  const at = lines.findIndex((l) => /^allowed-tools\s*:/.test(l));
  if (at < 0) {
    const metadata = lines.findIndex((l) => /^metadata\s*:/.test(l));
    const insertAt = metadata < 0 ? lines.length : metadata;
    return [...lines.slice(0, insertAt), ...list, ...lines.slice(insertAt)];
  }
  let end = at + 1;
  while (end < lines.length && /^(\s|-)/.test(lines[end]!)) end++;
  return [...lines.slice(0, at), ...list, ...lines.slice(end)];
}

/** A committed stand-in for a compiled skill: its frontmatter, plus one line that loads the rendered text through `load_skill`. */
export function huskFor(compiledSkillMd: string, id: string): string {
  const match = compiledSkillMd.match(FRONTMATTER_RE);
  const lines = match ? match[1]!.split(/\r?\n/) : [];
  const rules = parseAllowedTools(stripFrontmatter(compiledSkillMd).frontmatter["allowed-tools"]);
  return `---\n${withLoadTool(lines, rules).join("\n")}\n---\n\n${HEADER_COMMENT}\n\n${huskBody(id)}\n`;
}

export function isHuskText(text: string): boolean {
  const body = stripFrontmatter(text).body;
  return body.startsWith(HEADER_COMMENT) && body.slice(HEADER_COMMENT.length).trimStart().startsWith(`Before anything else, call \`${LOAD_SKILL_TOOL} `);
}

export function isHuskDir(dir: string): boolean {
  const path = join(dir, "SKILL.md");
  return existsSync(path) && isHuskText(readFileSync(path, "utf8"));
}
