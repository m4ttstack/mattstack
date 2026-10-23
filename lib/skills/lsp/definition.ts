import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { logCliEvent } from "../../cli-logger.ts";
import { walk } from "../blocks/tree.ts";
import { loadInclude } from "../sources.ts";
import { blockIn, lineRange, loadFill } from "./lookup.ts";
import { lineRegions, tokenAt, tokensIn, type Position, type Range, type Token } from "./positions.ts";
import type { Workspace } from "./workspace.ts";

export type Location = { uri: string; range: Range };

const MODULE = "skills-lsp";
const TITLE_RE = /^#\s/;
const EDGE_RE = /--|-\.|==/;

export function definitionAt(ws: Workspace, file: string, pos: Position): Location[] {
  try {
    const token = tokenAt(ws.text(file), file, pos);
    if (!token) return [];
    const target = targetOf(ws, file, token);
    return target ? [{ uri: pathToFileURL(target.file).href, range: lineRange(ws.text(target.file), target.line) }] : [];
  } catch (err) {
    logCliEvent("error", MODULE, "definition failed", { file, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

type Target = { file: string; line: number };

function targetOf(ws: Workspace, file: string, token: Token): Target | null {
  switch (token.kind) {
    case "include":
      return includeTarget(ws, file, token.name);
    case "node-decl":
      return nodeTarget(ws, file, token);
    case "binding-key": {
      const held = ws.analysis().byBlockId.get(keyOf(token));
      return held ? { file: held.block.path, line: titleLine(ws.text(held.block.path)) } : null;
    }
    case "binding-prop": {
      const held = ws.analysis().byBlockId.get(token.key);
      if (!held) return null;
      const decl = tokensIn(ws.text(held.block.path), held.block.path).find((t) => t.kind === "prop-decl" && t.prop === token.prop);
      return decl ? { file: held.block.path, line: decl.range.start.line } : null;
    }
    case "binding-value": {
      if (token.value === "") return null;
      const held = ws.analysis().byBlockId.get(token.key);
      const fill = loadFill(ws, token.value, token.prop, held ? [file, held.block.path] : [file]);
      return fill ? { file: join(fill.dir, fill.file ?? "SKILL.md"), line: 0 } : null;
    }
    default:
      return null;
  }
}

const keyOf = (t: { engineRef: string; blockPath: string | null }) => (t.blockPath === null ? t.engineRef : `${t.engineRef}/${t.blockPath}`);

function includeTarget(ws: Workspace, file: string, name: string): Target | null {
  const roots = ws.rootsFor([file]);
  const mattstack = roots.byName.mattstack;
  if (!mattstack) return null;
  const tree = ws.analysis().trees.get(join(mattstack.dir, "attachments", name));
  if (tree) return { file: tree.root.path, line: titleLine(ws.text(tree.root.path)) };
  try {
    return { file: join(loadInclude(name, roots).dir, "SKILL.md"), line: 0 };
  } catch {
    return null;
  }
}

/** Frontmatter `node:` goes up to the parent's graph; a node id in a graph goes down to the child bound to it. */
function nodeTarget(ws: Workspace, file: string, token: Extract<Token, { kind: "node-decl" }>): Target | null {
  const held = blockIn(ws, file);
  if (!held) return null;
  const region = lineRegions(ws.text(file).split("\n"))[token.range.start.line];
  if (region === "mermaid") {
    const child = held.block.children.find((c) => c.node === token.node);
    return child ? { file: child.path, line: titleLine(ws.text(child.path)) } : null;
  }
  const tree = ws.analysis().byBlockId.get(held.key)!.tree;
  const parent = walk(tree).find((b) => b.children.includes(held.block));
  if (!parent) return null;
  const text = ws.text(parent.path);
  const lines = text.split("\n");
  const regions = lineRegions(lines);
  const mentions = tokensIn(text, parent.path)
    .filter((t) => t.kind === "node-decl" && t.node === token.node && regions[t.range.start.line] === "mermaid")
    .map((t) => t.range.start.line);
  const statement = mentions.find((line) => !EDGE_RE.test(lines[line]!));
  const line = statement ?? mentions[0];
  return line === undefined ? null : { file: parent.path, line };
}

function titleLine(text: string): number {
  const lines = text.split("\n");
  const regions = lineRegions(lines);
  const title = lines.findIndex((l, i) => regions[i] === "body" && TITLE_RE.test(l));
  if (title >= 0) return title;
  const body = regions.indexOf("body");
  return body < 0 ? 0 : body;
}
