/**
 * The one way rt commands print. Builders return data; print() decides
 * whether a person is reading, asks rt-ui to draw the blocks if so, and
 * otherwise (a pipe, --json, RT_BATCH, a missing or failed helper) writes
 * the same words plainly. No color or glyph styling lives on this side.
 */
import { renderPlain } from "./out-plain.ts";
import { encodeLine, PROTOCOL_VERSION, type Block, type CalloutLabel, type Cell, type ChangeRow, type DiffHunk, type RenderStatus, type Segment } from "./protocol.ts";
import { resolveRtUi } from "./resolve.ts";
import { logCliEvent } from "../cli-logger.ts";

export type CellInput = string | Segment | Array<string | Segment>;

export interface FailureInput {
  title: string;
  hint?: string;
  why?: string;
  next?: CellInput;
  details?: string;
}

export type Stream = "stdout" | "stderr";

function toCell(input: CellInput): Cell {
  const parts = Array.isArray(input) ? input : [input];
  return parts.map((p) => (typeof p === "string" ? { text: p } : p));
}

/** Drops undefined members so a block encodes without empty fields. */
function compact(o: Record<string, unknown>): Block {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Block;
}

// ─── segments ────────────────────────────────────────────────────────────────

export const cmd = (text: string): Segment => ({ text, role: "command" });
export const key = (text: string): Segment => ({ text, role: "key" });
export const strong = (text: string): Segment => ({ text, role: "strong" });
export const dim = (text: string): Segment => ({ text, role: "dim" });
export const faint = (text: string): Segment => ({ text, role: "faint" });
export const link = (text: string, url: string): Segment => ({ text, role: "link", url });

// ─── blocks ──────────────────────────────────────────────────────────────────

export function line(status: RenderStatus, title: string, hint?: string): Block {
  return compact({ t: "line", status, title, hint });
}

export function callout(label: CalloutLabel, ...body: CellInput[]): Block {
  return { t: "callout", label, body: body.map(toCell) };
}

export function kv(k: string, value?: string, source?: string): Block {
  return compact({ t: "kv", key: k, value, source });
}

export function table(rows: Array<CellInput[] | { group: string }>, headers?: string[]): Block {
  return compact({ t: "table", headers, rows: rows.map((r) => (Array.isArray(r) ? { cells: r.map(toCell) } : r)) });
}

export function tree(root: CellInput, children: CellInput[][]): Block {
  return { t: "tree", root: toCell(root), children: children.map((c) => c.map(toCell)) };
}

export function section(title: string, subtitle: string | undefined, ...blocks: Block[]): Block {
  return compact({ t: "section", title, subtitle, blocks });
}

export function summary(status: RenderStatus, title: string, counts?: string[]): Block {
  return compact({ t: "summary", status, title, counts });
}

export function paragraph(text: string): Block {
  return { t: "paragraph", text };
}

export function copy(text: string, caption?: string): Block {
  return compact({ t: "copy", text, caption });
}

export function verbatim(lines: string[], caption?: string): Block {
  return compact({ t: "verbatim", lines, caption });
}

export function changes(rows: ChangeRow[]): Block {
  return { t: "changes", changes: rows };
}

export function diff(hunks: DiffHunk[]): Block {
  return { t: "diff", hunks };
}

export function banner(label: string, subject: string, hint?: string): Block {
  return compact({ t: "banner", label, subject, hint });
}

export function failure(f: FailureInput): Block {
  return compact({ t: "failure", title: f.title, hint: f.hint, why: f.why, next: f.next === undefined ? undefined : toCell(f.next), details: f.details });
}

// ─── output ──────────────────────────────────────────────────────────────────

function realHuman(stream: Stream): boolean {
  const s = stream === "stdout" ? process.stdout : process.stderr;
  return Boolean(s.isTTY) && !process.env.RT_BATCH && !process.argv.includes("--json");
}

let human: (stream: Stream) => boolean = realHuman;
let humanStream: Stream = "stdout";

/**
 * For a verb whose stdout is read by another program (rt cd, rt nav): human
 * text moves to stderr for the rest of the process.
 */
export function payloadOnStdout(): void {
  humanStream = "stderr";
}

function write(stream: Stream, text: string): void {
  (stream === "stdout" ? process.stdout : process.stderr).write(text);
}

const RENDER_TIMEOUT_MS = 2000;

let helperWarned = false;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The plain fallback keeps the person's words; the log keeps the reason they
// were plain, which is otherwise invisible on an installed machine. One line
// per process: every later block set on that machine fails the same way.
function helperFailed(what: string, context: Record<string, unknown>): void {
  if (helperWarned) return;
  helperWarned = true;
  logCliEvent("warn", "rt-ui", `${what}; printed plain text instead`, context);
}

function renderStyled(blocks: Block[], stream: Stream): string | null {
  let bin: string;
  try {
    bin = resolveRtUi();
  } catch (err) {
    helperFailed("rt-ui was not found", { error: errorText(err) });
    return null;
  }
  try {
    const columns = (stream === "stdout" ? process.stdout : process.stderr).columns ?? 80;
    const args = [bin, "render", "--width", String(columns)];
    if (process.env.NO_COLOR) args.push("--no-color");
    const input = encodeLine({ t: "hello", protocol: PROTOCOL_VERSION }) + blocks.map(encodeLine).join("");
    const r = Bun.spawnSync(args, { stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe", env: { ...process.env }, timeout: RENDER_TIMEOUT_MS });
    if (r.exitCode === 0 && r.success) return r.stdout.toString();
    // A helper killed by the timeout has exitCode null and signalCode SIGTERM.
    helperFailed("rt-ui render exited non-zero", { bin, exitCode: r.exitCode, signalCode: r.signalCode, stderr: r.stderr.toString().trim().slice(-500) });
    return null;
  } catch (err) {
    helperFailed("rt-ui render did not spawn", { bin, error: errorText(err) });
    return null;
  }
}

function emit(blocks: Block[], stream: Stream): void {
  if (blocks.length === 0) return;
  const styled = human(stream) ? renderStyled(blocks, stream) : null;
  write(stream, styled ?? renderPlain(blocks));
}

/** Human-facing blocks. Blocks that must align with each other go in one call. */
export function print(...blocks: Block[]): void {
  emit(blocks, humanStream);
}

/** A failure, on stderr, with any blocks that belong under it (a stack, an excerpt) in the same write. */
export function fail(f: FailureInput, ...after: Block[]): void {
  emit([failure(f), ...after], "stderr");
}

/** Whether a person is reading `stream` right now: the gate print and fail apply. */
export function isHuman(stream: Stream = "stdout"): boolean {
  return human(stream);
}

/** A --json envelope, exactly as JSON.stringify writes it. */
export function json(value: unknown, indent?: number): void {
  process.stdout.write(JSON.stringify(value, null, indent) + "\n");
}

/** Text another program reads. Written to stdout byte for byte, never styled. */
export function payload(text: string): void {
  process.stdout.write(text);
}

export const __test__ = {
  setHuman(fn: ((stream: Stream) => boolean) | undefined): void {
    human = fn ?? realHuman;
  },
  reset(): void {
    helperWarned = false;
    human = realHuman;
    humanStream = "stdout";
  },
};
