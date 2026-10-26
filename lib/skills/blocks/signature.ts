import { loadBlockTree, walk } from "./tree.ts";

export type PropShape = { merge: "add" | "replace"; required: boolean; contract: string | null };

export type Signature = Record<string /* "<engine>/<block>" */, Record<string /* prop */, PropShape>>;

export type BreakingChange = { key: string /* "<engine>/<block>.<prop>" */; what: "removed" | "newly-required" | "merge-flipped" | "contract-changed" };

export function propKey(blockId: string, prop: string): string {
  return `${blockId}.${prop}`;
}

function engineOf(blockId: string): string {
  const slash = blockId.indexOf("/");
  return slash === -1 ? blockId : blockId.slice(0, slash);
}

export function signatureOf(engineDirs: { engine: string; dir: string }[]): Signature {
  const out: Signature = {};
  for (const { engine, dir } of engineDirs) {
    const tree = loadBlockTree(dir, { idPrefix: engine, relRoot: engine });
    for (const block of walk(tree)) {
      const props: Record<string, PropShape> = {};
      for (const p of block.props) props[p.name] = { merge: p.merge, required: p.default === null, contract: p.contract };
      out[block.id] = props;
    }
  }
  return out;
}

/** An engine that was not a block tree before has no bindings to break; its conversion has its own migration guard. */
export function breakingChanges(before: Signature, after: Signature): BreakingChange[] {
  const out: BreakingChange[] = [];
  const enginesBefore = new Set(Object.keys(before).map(engineOf));
  for (const block of Object.keys(before).sort()) {
    const next = after[block] ?? {};
    for (const prop of Object.keys(before[block]!).sort()) {
      const was = before[block]![prop]!;
      const now = next[prop];
      const key = propKey(block, prop);
      if (!now) out.push({ key, what: "removed" });
      else if (now.required && !was.required) out.push({ key, what: "newly-required" });
      else if (now.merge !== was.merge) out.push({ key, what: "merge-flipped" });
      else if (now.contract !== was.contract) out.push({ key, what: "contract-changed" });
    }
  }
  for (const block of Object.keys(after).sort()) {
    if (!enginesBefore.has(engineOf(block))) continue;
    const was = before[block] ?? {};
    for (const prop of Object.keys(after[block]!).sort()) {
      if (!was[prop] && after[block]![prop]!.required) out.push({ key: propKey(block, prop), what: "newly-required" });
    }
  }
  return out;
}

const WAIVER_RE = /^props-change:[ \t]*(\S+?):[ \t]*(\S.*?)\s*$/gm;

const WHAT: Record<BreakingChange["what"], string> = {
  removed: "was removed",
  "newly-required": "is newly required",
  "merge-flipped": "changed its merge",
  "contract-changed": "changed its contract",
};

export function checkPropsSignature(input: { changes: BreakingChange[]; prBody: string }): string[] {
  const waived = new Set<string>();
  for (const m of input.prBody.matchAll(WAIVER_RE)) waived.add(m[1]!);
  return input.changes
    .filter((c) => !waived.has(c.key))
    .map((c) => `Prop ${c.key} ${WHAT[c.what]} (${c.what}) since the last release, which breaks a team pack that binds it. Keep the prop as it was, or add a line "props-change: ${c.key}: <reason>" to the PR body. Edit the PR body, then push a commit (re-running the job reads the old body).`);
}
