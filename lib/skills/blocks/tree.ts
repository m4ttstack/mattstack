import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { BlockError, type BlockDiagnostic } from "./diagnostics.ts";
import { parseBlockFile } from "./frontmatter.ts";
import { graphOrder, parseMermaid } from "./mermaid.ts";
import type { Block, BlockTree } from "./types.ts";

const SUFFIX = ".block.md";
const INDEX = "index.block.md";
export const FENCE_RE = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/;

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

/** readdir order differs between filesystems, and diagnostics must come out the same on every one. */
function sortedEntries(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

function orphansUnder(dir: string, relDir: string, out: BlockDiagnostic[]): void {
  for (const entry of sortedEntries(dir)) {
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
  for (const entry of sortedEntries(dir)) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith("+")) {
      const block = entry.isDirectory() ? (isBlockTree(full) ? `${entry.name}/${INDEX}` : null) : entry.name.endsWith(SUFFIX) ? entry.name : null;
      if (block !== null) {
        diagnostics.push({
          file: `${relDir}/${block}`,
          line: 1,
          col: 1,
          message: `a block name cannot start with "+": parts/+<id> is where included blocks vendor their files`,
          code: "bad-value",
        });
        continue;
      }
    }
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
  const unclosed = open as { mermaid: boolean; start: number } | null;
  if (unclosed?.mermaid) {
    diagnostics.push({
      file: block.relPath,
      line: block.textStartLine + unclosed.start,
      col: 1,
      message: "this mermaid fence never closes, so everything after it would be lost",
      code: "bad-graph",
    });
  }
}

function orderChildren(parent: Block, diagnostics: BlockDiagnostic[]): void {
  const graphIds = parent.graph ? graphOrder(parent.graph) : [];
  const rank = new Map(graphIds.map((id, i) => [id, i]));
  const byNode = new Map<string, Block>();
  const byOrder = new Map<number, Block>();
  const bound: Block[] = [];
  const rest: Block[] = [];
  for (const child of parent.children) {
    if (child.node !== null) {
      const nodeAt = child.fieldAt.node!;
      const known = rank.has(child.node);
      if (!known) {
        diagnostics.push({
          file: child.relPath,
          ...nodeAt,
          message: parent.graph
            ? `node "${child.node}" is not in the graph at ${parent.graph.file}:${parent.graph.fenceLine}`
            : `node "${child.node}" has no graph to bind to: ${parent.relPath} has no mermaid graph`,
          code: "missing-node",
        });
      }
      if (child.title === null) {
        diagnostics.push({
          file: child.relPath,
          ...nodeAt,
          message: `node "${child.node}" takes its label from the block title, and this block has no # title line`,
          code: "node-unbound",
        });
      }
      if (child.order !== null) {
        diagnostics.push({
          file: child.relPath,
          ...child.fieldAt.order!,
          message: `order has no effect on a block bound to graph node "${child.node}"; the graph sets its place`,
          code: "order-on-graph-child",
        });
      }
      const twin = byNode.get(child.node);
      if (twin) {
        diagnostics.push({
          file: child.relPath,
          ...nodeAt,
          message: `node "${child.node}" is already bound by ${twin.relPath}`,
          code: "duplicate-node",
        });
        continue;
      }
      byNode.set(child.node, child);
      if (known) bound.push(child);
    } else {
      if (child.order !== null) {
        const first = byOrder.get(child.order);
        if (first) {
          diagnostics.push({
            file: child.relPath,
            ...child.fieldAt.order!,
            message: `order ${child.order} is already taken by ${first.relPath}`,
            code: "duplicate-order",
          });
        } else byOrder.set(child.order, child);
      }
      rest.push(child);
    }
  }
  bound.sort((x, y) => rank.get(x.node!)! - rank.get(y.node!)!);
  // Array.sort is stable, so the incoming name-stem order breaks ties among blocks without order.
  rest.sort((x, y) => (x.order === null ? 1 : 0) - (y.order === null ? 1 : 0) || (x.order ?? 0) - (y.order ?? 0));
  parent.children = [...bound, ...rest];
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
    if (block) orderChildren(block, diagnostics);
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
