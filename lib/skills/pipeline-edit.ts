import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from "jsonc-parser";
import { PROVENANCE_LINE } from "./manifest-merge.ts";

const FORMAT = { insertSpaces: true, tabSize: 2 };

function remove(text: string, path: (string | number)[]): string {
  return applyEdits(text, modify(text, path, undefined, { formattingOptions: FORMAT }));
}

function isEmptyObject(text: string, path: (string | number)[]): boolean {
  const node = parseTree(text);
  const at = node && findNodeAtLocation(node, path);
  return at?.type === "object" && (at.children?.length ?? 0) === 0;
}

export function removePipelineOverride(
  text: string,
  pipeline: string,
  engineRef: string,
  slot: string,
): string {
  const base = ["pipelines", pipeline];
  const slotPath = [...base, "bindings", engineRef, slot];
  const root = parseTree(text);
  if (!root || !findNodeAtLocation(root, slotPath)) return text;

  let out = remove(text, slotPath);
  for (const path of [
    [...base, "bindings", engineRef],
    [...base, "bindings"],
    base,
    ["pipelines"],
  ]) {
    if (!isEmptyObject(out, path)) break;
    out = remove(out, path);
  }

  const node = parseTree(out);
  const pipelineNode = node && findNodeAtLocation(node, base);
  if (pipelineNode?.type === "object" && pipelineNode.children?.length === 1) {
    const stages = findNodeAtLocation(pipelineNode, ["stages"]);
    if (stages) {
      out = applyEdits(
        out,
        modify(out, base, getNodeValue(stages), { formattingOptions: FORMAT }),
      );
    }
  }
  return out;
}

export function dropProvenanceLine(text: string, key: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("//")) break;
    if (PROVENANCE_LINE.exec(line)?.[1] === key) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return text;
}
