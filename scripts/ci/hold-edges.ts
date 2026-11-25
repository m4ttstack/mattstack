import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { parseMermaid } from "../../lib/skills/blocks/mermaid.ts";
import type { BlockGraph, GraphEdge, GraphNode } from "../../lib/skills/blocks/types.ts";

// A hold asks nobody anything, so an edge into one must carry a human's answer
// at a gate. These do, or cannot ask, in a way their graph does not draw.
const INCLUDED_GATE = "an included step's own held outcome, whose graph is checked here";
const EXIT = "the shared exit; every edge labelled hold on the way in is checked itself";
const RECORDED = "reports a hold a human's answer already recorded, or a gate still open";
const REFUSED_WRITE = "the run store refused a write, so it refuses a gate's answer too";
const ALLOWED: Record<string, string> = {
  "evidence-record/annotate-or-waive-each-image-the-record-does-not-yet-cover: drawn -> redaction_held |Held at evidence-redaction|": INCLUDED_GATE,
  "evidence-record/attach-the-evidence: boards_revision_outcome -> attach_held |Held at evidence-redaction, or Record held|": INCLUDED_GATE,
  "evidence-record/attach-the-evidence: repair_outcome -> attach_held |Held at evidence-redaction|": INCLUDED_GATE,
  "evidence-record/attach-the-evidence: rerecord_outcome -> attach_held |Record held|": INCLUDED_GATE,
  "evidence-record/record-the-evidence: annotate_outcome -> record_held |Waiver held, or Redaction held|": INCLUDED_GATE,
  "forge/sync-open-mrs: all_selected -> branch_sync_sweep |yes: all four conditions hold|": "conditions that hold, not a pause",
  "gate-protocol: hold_under_run -> held_no_run |no|": "the gate is open and still asks",
  "gate-protocol: mode_answer_recorded -> run_hold_unrecorded |no: runErrors, a refusal or an error|": REFUSED_WRITE,
  "gate-protocol: run_control_answer -> run_resolve_hold |yes: next hold|": "the kit form's Pause run",
  "gate-protocol: run_resolve_result -> run_held |applied hold|": RECORDED,
  "gate-protocol: run_resolve_result -> run_hold_refusal |refused|": REFUSED_WRITE,
  "pipeline/ship/flow: after_result -> which_exit |Held at evidence-redaction: hold|": INCLUDED_GATE,
  "pipeline/ship/flow: attach_outcome -> which_exit |Attach held: hold|": INCLUDED_GATE,
  "pipeline/ship/flow: record_outcome -> which_exit |Record held at evidence-waiver or evidence-redaction: hold|": INCLUDED_GATE,
  "pipeline/ship/flow: watch_ci_result -> held_in_watch_ci |held|": INCLUDED_GATE,
  "pipeline/ship/flow: which_exit -> hand_back_caller |inherited: any exit but hold|": "every exit but a hold",
  "pipeline/ship/flow: which_exit -> run_hold |hold|": EXIT,
  "pipeline/ship/run: revise_outcome -> revision_held |held: at evidence-redaction, Record held or Attach held|": INCLUDED_GATE,
  "pipeline/stage-evidence: attach_outcome -> run_hold |Record held, or Attach held|": INCLUDED_GATE,
  "pipeline/stage-evidence: captured -> run_hold |Held at evidence-redaction|": INCLUDED_GATE,
  "pipeline/stage-evidence: record_outcome -> run_hold |Record held, or Attach held|": INCLUDED_GATE,
  "pipeline/stage-self-review: domain_review_gated -> held_domain_gate |hold|": INCLUDED_GATE,
  "pipeline/stage-ship: after_result -> run_hold |Held at evidence-redaction|": INCLUDED_GATE,
  "pipeline/stage-ship: attach_outcome -> run_hold |Attach held|": INCLUDED_GATE,
  "pipeline/stage-ship: owed_put_off -> run_hold |yes: the developer's answer holds the run until it is up|": "answered capture it later, on an environment that is not up",
  "pipeline/stage-ship: record_outcome -> run_hold |Record held at evidence-waiver or evidence-redaction|": INCLUDED_GATE,
  "pipeline/stage-watch-ci: which_exit -> run_hold |hold|": EXIT,
  "pipeline/watch-ci/flow: which_exit -> run_hold |hold|": EXIT,
  "pipeline/work/stages: armed_gate_status -> run_hold_refusal |refused|": REFUSED_WRITE,
  "pipeline/work/stages: run_hold_result -> held |held|": REFUSED_WRITE,
  "pipeline/work/stages: run_next_ended -> held |held or waiting|": RECORDED,
  "pipeline/work/stages: run_next_ended -> run_hold_refusal |refused|": REFUSED_WRITE,
  "pipeline/work/stages: run_resolve_result -> held |hold|": RECORDED,
  "pipeline/work/stages: run_resolve_result -> run_hold_refusal |refused|": REFUSED_WRITE,
  "review/receive-review/steps: reply_result -> next_github_thread |an error: hold this thread, quoting it|": "one thread, which the held threads' gate asks about",
  "review/receive-review/steps: resolve_result -> next_github_thread |an error: hold this thread, quoting it|": "one thread, which the held threads' gate asks about",
  "review/review/the-review-graph: caller_answer -> run_hold |hold|": "the caller asked, at its own gate",
};

type Finding = { key: string; line: number };

function isHold(node: GraphNode): boolean {
  const label = node.label ?? "";
  if (node.shape === "doublecircle") return /\bheld\b/i.test(label);
  return node.shape === "plaintext" && /^run_hold\b|\bkey: hold, value: held\b|\bnext: hold\b/.test(label);
}

/** A step that asks a human: a judgment box bound to a gate, never a gate tool call. */
function isGate(node: GraphNode): boolean {
  return node.shape === "box" && /^(gate|ask)_|_(gate|off_script)$/.test(node.id);
}

/** Edges into a hold, or labelled hold on the way to one, that carry no human's answer, each keyed "<block path>: <from> -> <to> |<label>|". */
export function unaskedHolds(graph: BlockGraph): Finding[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const into = (id: string) => graph.edges.filter((e) => e.to === id);
  const saysHold = (edge: GraphEdge) => /\bhold\b/i.test(edge.label ?? "");
  const answered = (edge: GraphEdge, seen: Set<string>): boolean => {
    const from = nodes.get(edge.from)!;
    if (isGate(from)) return saysHold(edge);
    const before = into(from.id);
    if (seen.has(from.id) || before.length === 0) return false;
    if (from.shape === "diamond") return saysHold(edge) && before.every((e) => e.label === null && isGate(nodes.get(e.from)!));
    return before.every((e) => answered(e, new Set([...seen, from.id])));
  };
  return graph.edges
    .filter((e) => (isHold(nodes.get(e.to)!) || saysHold(e)) && !isHold(nodes.get(e.from)!) && !answered(e, new Set()))
    .map((e) => ({ key: `${graph.file}: ${e.from} -> ${e.to}${e.label ? ` |${e.label}|` : ""}`, line: e.line }));
}

export function checkHoldEdges(graphs: BlockGraph[], allowed: Record<string, string>): string[] {
  const used = new Set<string>();
  const errors: string[] = [];
  for (const graph of graphs) {
    for (const { key, line } of unaskedHolds(graph)) {
      if (key in allowed) used.add(key);
      else errors.push(`${key} at line ${line} parks the run with nothing asked. A decision the developer must make is a gate: route the edge to one, and let its hold answer reach the hold.`);
    }
  }
  for (const key of Object.keys(allowed)) if (!used.has(key)) errors.push(`scripts/ci/hold-edges.ts allows "${key}", which no graph draws; remove it.`);
  return errors;
}

export function graphsIn(dir: string): BlockGraph[] {
  const graphs: BlockGraph[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".block.md")) continue;
    const path = join(entry.parentPath, entry.name);
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(/^```mermaid\r?\n([\s\S]*?)^```\r?$/gm)) {
      graphs.push(parseMermaid(m[1]!, relative(dir, path).replace(/(\/index)?\.block\.md$/, ""), text.slice(0, m.index).split("\n").length));
    }
  }
  return graphs;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: hold-edges.ts <source attachments dir>");
    process.exit(2);
  }
  const graphs = graphsIn(dir);
  const errors = checkHoldEdges(graphs, ALLOWED);
  for (const e of errors) console.error(e);
  console.log(`${graphs.length} graphs checked for holds that ask nothing`);
  process.exit(errors.length || graphs.length === 0 ? 1 : 0);
}
