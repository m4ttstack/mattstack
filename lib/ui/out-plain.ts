/**
 * The same blocks rt-ui draws, as uncolored text: what a pipe, an agent
 * without --json, or a machine with no rt-ui gets. Statuses are words so the
 * output can be grepped.
 */
import type { Block, Cell, RenderStatus } from "./protocol.ts";

const TAG: Record<RenderStatus, string> = {
  done: "[ok]",
  failed: "[failed]",
  "needs-you": "[needs you]",
  pending: "[not yet]",
  stale: "[out of date]",
  refused: "[refused]",
  off: "[off]",
  skipped: "[skipped]",
  running: "[running]",
  warn: "[warning]",
};

// Text from a branch name or a child process must not repaint the terminal
// when the fallback writes it raw. Each field is cleaned on its own, before
// layout: an unterminated escape stripped from the joined output would eat
// the rows after it. The OSC body stops at a newline for the same reason.
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

// The bidi controls and the zero-width characters: text carrying them can
// read as something other than what it is. Built from code points so this
// file holds none of them; the ranges match Clean in ui/internal/render.
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2060],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join("")}]`, "g");

/** Single-line fields: a newline in untrusted text must not start a forged row. */
function one(s: string): string {
  return s.replace(ESCAPES, "").replace(/[\r\n\t]+/g, " ").replace(CONTROLS, "").replace(INVISIBLE, "");
}

/** Line-oriented fields: every line gets the block's prefix. Tabs are kept. */
function lines(s: string, prefix: string): string[] {
  return s.split(/\r\n|\r|\n/).map((l) => prefix + l.replace(ESCAPES, "").replace(CONTROLS, "").replace(INVISIBLE, ""));
}

function cellText(cell: Cell): string {
  return cell.map((s) => (s.role === "link" && s.url ? `${one(s.text)} (${one(s.url)})` : one(s.text))).join("");
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - Bun.stringWidth(s)));
}

/** Pads every cell but a row's last to its column width. */
function columns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, Bun.stringWidth(c))));
  return rows.map((row) => row.map((c, i) => (i === row.length - 1 ? c : pad(c, widths[i]!))).join("  "));
}

function gap(out: string[]): void {
  if (out.length > 0 && out[out.length - 1] !== "") out.push("");
}

function caption(out: string[], text: string | undefined): void {
  if (text) out.push(`${one(text)}:`);
}

function render(blocks: Block[], out: string[]): void {
  for (const b of blocks) {
    switch (b.t) {
      case "line":
        out.push(`${TAG[b.status]} ${one(b.title)}${b.hint ? `  ${one(b.hint)}` : ""}`);
        break;
      case "callout":
        b.body.forEach((c, i) => out.push(i === 0 ? `  ${one(b.label)}: ${cellText(c)}` : `  ${" ".repeat(Bun.stringWidth(one(b.label)) + 2)}${cellText(c)}`));
        break;
      case "kv":
        out.push(b.value ? `${one(b.key)}: ${one(b.value)}` : `${one(b.key)}:`);
        if (b.source) out.push(`  ${one(b.source)}`);
        break;
      case "table": {
        const grid: string[][] = [];
        if (b.headers) grid.push(b.headers.map(one));
        for (const row of b.rows) if ("cells" in row) grid.push(row.cells.map(cellText));
        const rendered = columns(grid);
        let at = 0;
        if (b.headers) out.push(rendered[at++]!);
        for (const row of b.rows) out.push("group" in row ? `${one(row.group)}:` : rendered[at++]!);
        break;
      }
      case "tree":
        out.push(cellText(b.root));
        for (const line of columns(b.children.map((child) => child.map(cellText)))) out.push(`  - ${line}`);
        break;
      case "section":
        gap(out);
        out.push(b.subtitle ? `${one(b.title)} (${one(b.subtitle)})` : one(b.title));
        render(b.blocks, out);
        break;
      case "summary":
        gap(out);
        out.push(`${TAG[b.status]} ${one(b.title)}${b.counts?.length ? `  ${b.counts.map(one).join(", ")}` : ""}`);
        break;
      case "paragraph":
        out.push(...lines(b.text, "  "));
        break;
      case "copy":
        caption(out, b.caption);
        out.push(...lines(b.text, ""));
        break;
      case "verbatim":
        caption(out, b.caption);
        for (const l of b.lines) out.push(...lines(l, "  "));
        break;
      case "changes":
        for (const c of b.changes) out.push(`${c.op} ${one(c.name)}${c.hint ? `  ${one(c.hint)}` : ""}`);
        break;
      case "diff":
        for (const h of b.hunks) {
          out.push(one(h.header));
          for (const l of h.lines) out.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${one(l.text)}`);
        }
        break;
      case "banner":
        out.push(`${one(b.label)} ${one(b.subject)}${b.hint ? `  ${one(b.hint)}` : ""}`);
        break;
      case "failure": {
        // The tray shows a person the first bytes of stderr as they are, so
        // a failure that opens the output leads with its title alone. A
        // title that opens with a bracket, leading spaces aside, keeps the
        // tag: text from an error must not pose as another status.
        const title = one(b.title);
        const bare = out.length === 0 && !title.trimStart().startsWith("[");
        out.push(`${bare ? "" : `${TAG.failed} `}${title}${b.hint ? `  ${one(b.hint)}` : ""}`);
        if (b.why) out.push(`  why: ${one(b.why)}`);
        if (b.next) out.push(`  next: ${cellText(b.next)}`);
        if (b.details) out.push(...lines(b.details, "  "));
        break;
      }
    }
  }
}

export function renderPlain(blocks: Block[]): string {
  const out: string[] = [];
  render(blocks, out);
  if (out.length === 0) return "";
  return out.join("\n") + "\n";
}
