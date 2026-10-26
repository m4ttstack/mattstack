import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative } from "path";

const MERMAID = /^\s*```mermaid\s*$/m;
const PART_PATH = /<!-- part: [^>]*?\bpath=(attachments\/\S+)/g;

function walk(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, into);
    else into.push(path);
  }
  return into;
}

/** The topmost folder under attachments/ holding an index.block.md above `file`, as "attachments/<...>/". */
function blockRoot(file: string, indexDirs: Set<string>): string {
  let root = dirname(file);
  for (let dir = root; dir !== "."; dir = dirname(dir)) if (indexDirs.has(dir)) root = dir;
  return `${root}/`;
}

/** Block roots whose tree carries a mermaid graph; `files` maps attachments-relative paths to their text. */
export function graphRoots(files: Record<string, string>): string[] {
  const rels = Object.keys(files).filter((rel) => rel.endsWith(".block.md"));
  const indexDirs = new Set(rels.filter((rel) => rel.endsWith("/index.block.md") || rel === "index.block.md").map(dirname));
  const roots = new Set<string>();
  for (const rel of rels) if (MERMAID.test(files[rel]!)) roots.add(blockRoot(rel, indexDirs));
  return [...roots].map((root) => `attachments/${root}`).sort();
}

/** Roots with no compiled part naming a file inside them. */
export function uncompiledRoots(roots: string[], compiledTexts: string[]): string[] {
  const seen = compiledTexts.flatMap((text) => [...text.matchAll(PART_PATH)].map((m) => m[1]!));
  return roots.filter((root) => !seen.some((path) => path.startsWith(root)));
}

if (import.meta.main) {
  const [attachmentsDir, packDir] = process.argv.slice(2);
  if (!attachmentsDir || !packDir) {
    console.error("usage: block-graphs-compiled.ts <source attachments dir> <compiled pack dir>");
    process.exit(2);
  }
  const files: Record<string, string> = {};
  for (const path of walk(attachmentsDir)) if (path.endsWith(".block.md")) files[relative(attachmentsDir, path)] = readFileSync(path, "utf8");
  const compiled = walk(packDir).filter((path) => path.endsWith("/SKILL.md")).map((path) => readFileSync(path, "utf8"));
  const roots = graphRoots(files);
  const missing = uncompiledRoots(roots, compiled);
  for (const root of missing) console.error(`${root} carries a mermaid graph but no compiled SKILL.md was built from it; add its engine to tests/graph-roster.jsonc.`);
  console.log(`${roots.length - missing.length}/${roots.length} graph-bearing engines compiled`);
  process.exit(missing.length ? 1 : 0);
}
