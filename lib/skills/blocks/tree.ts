import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import { parseBlockFile } from "./frontmatter.ts";
import { parseMermaid } from "./mermaid.ts";
import type { Block, BlockTree } from "./types.ts";

const SUFFIX = ".block.md";
const INDEX = "index.block.md";
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/;

export function isBlockTree(dir: string): boolean {
  return existsSync(join(dir, INDEX));
}

export function walk(tree: BlockTree): Block[] {
  const out: Block[] = [];
  const visit = (b: Block) => {
    out.push(b);
    b.children.forEach(visit);
  };
  visit(tree.root);
  return out;
}

type Child = { stem: string; file: string; dir: string | null };

function orphansUnder(dir: string, relDir: string, out: BlockDiagnostic[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) orphansUnder(join(dir, entry.name), `${relDir}/${entry.name}`, out);
    else if (entry.isFile() && entry.name.endsWith(SUFFIX)) {
      out.push({
        file: `${relDir}/${entry.name}`,
        line: 1,
        col: 1,
        message: `this folder needs an ${INDEX} to be a block; without one its files are vendored as plain files`,
        code: "orphan-block",
      });
    }
  }
}

function childrenOf(dir: string, relDir: string, diagnostics: BlockDiagnostic[]): Child[] {
  const out: Child[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isBlockTree(full)) out.push({ stem: entry.name, file: join(full, INDEX), dir: full });
      else orphansUnder(full, `${relDir}/${entry.name}`, diagnostics);
    } else if (entry.isFile() && entry.name.endsWith(SUFFIX) && entry.name !== INDEX) {
      out.push({ stem: entry.name.slice(0, -SUFFIX.length), file: full, dir: null });
    }
  }
  return out.sort((x, y) => (x.stem < y.stem ? -1 : x.stem > y.stem ? 1 : x.dir === null ? -1 : 1));
}

function attachGraph(block: Block, diagnostics: BlockDiagnostic[]): void {
  const lines = block.text.split("\n");
  let open: { marker: string; mermaid: boolean; start: number } | null = null;
  let content: string[] = [];
  let seen = false;
  lines.forEach((line, i) => {
    const m = FENCE_RE.exec(line);
    if (open === null) {
      if (m) open = { marker: m[1]!, mermaid: m[2] === "mermaid", start: i };
      content = [];
      return;
    }
    if (m && m[1]![0] === open.marker[0] && m[1]!.length >= open.marker.length && m[2] === "") {
      if (open.mermaid) {
        const fenceLine = block.textStartLine + open.start;
        if (seen) {
          diagnostics.push({
            file: block.relPath,
            line: fenceLine,
            col: 1,
            message: "a block holds one mermaid graph; this is a second",
            code: "bad-graph",
          });
        } else {
          seen = true;
          try {
            block.graph = parseMermaid(content.join("\n"), block.relPath, fenceLine);
          } catch (err) {
            if (err instanceof BlockError) diagnostics.push(...err.diagnostics);
            else throw err;
          }
        }
      }
      open = null;
      content = [];
      return;
    }
    content.push(line);
  });
}

function loadBlock(
  file: string,
  dir: string | null,
  id: string,
  relPath: string,
  relDir: string,
  depth: number,
  diagnostics: BlockDiagnostic[],
  byId: Map<string, Block>,
): Block | null {
  const idTail = id.slice(id.lastIndexOf("/") + 1);
  let parsed;
  try {
    parsed = parseBlockFile(readFileSync(file, "utf8"), relPath, idTail);
  } catch (err) {
    if (!(err instanceof BlockError)) throw err;
    diagnostics.push(...err.diagnostics);
  }
  const block: Block | null = parsed ? { ...parsed, id, path: file, relPath, depth, graph: null, children: [] } : null;
  if (block) {
    byId.set(id, block);
    attachGraph(block, diagnostics);
  }
  if (dir !== null) {
    const seen = new Map<string, string>();
    for (const child of childrenOf(dir, relDir, diagnostics)) {
      const isDir = child.dir !== null;
      const childRel = isDir ? `${relDir}/${child.stem}/${INDEX}` : `${relDir}/${child.stem}${SUFFIX}`;
      const first = seen.get(child.stem);
      if (first !== undefined) {
        diagnostics.push({
          file: childRel,
          line: 1,
          col: 1,
          message: `block id ${id}/${child.stem} is already taken by ${first}`,
          code: "duplicate-block",
        });
        continue;
      }
      seen.set(child.stem, childRel);
      const loaded = loadBlock(
        child.file,
        child.dir,
        `${id}/${child.stem}`,
        childRel,
        isDir ? `${relDir}/${child.stem}` : relDir,
        depth + 1,
        diagnostics,
        byId,
      );
      if (loaded && block) block.children.push(loaded);
    }
    if (block && block.title === null && block.children.length > 0) {
      diagnostics.push({
        file: relPath,
        line: 1,
        col: 1,
        message: "a headless block (no # title line) cannot have children",
        code: "headless-children",
      });
    }
  }
  return block;
}

export function loadBlockTree(dir: string, opts: { idPrefix: string; relRoot: string }): BlockTree {
  const diagnostics: BlockDiagnostic[] = [];
  const byId = new Map<string, Block>();
  const root = loadBlock(
    join(dir, INDEX),
    dir,
    opts.idPrefix,
    `${opts.relRoot}/${INDEX}`,
    opts.relRoot,
    0,
    diagnostics,
    byId,
  );
  if (diagnostics.length > 0 || root === null) throw new BlockError(diagnostics);
  return { root, dir, byId };
}
