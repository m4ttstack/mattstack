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

function cellText(cell: Cell): string {
  return cell.map((s) => (s.role === "link" && s.url ? `${s.text} (${s.url})` : s.text)).join("");
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
  if (text) out.push(`${text}:`);
}

function render(blocks: Block[], out: string[]): void {
  for (const b of blocks) {
    switch (b.t) {
      case "line":
        out.push(`${TAG[b.status]} ${b.title}${b.hint ? `  ${b.hint}` : ""}`);
        break;
      case "callout":
        b.body.forEach((c, i) => out.push(i === 0 ? `  ${b.label}: ${cellText(c)}` : `  ${" ".repeat(b.label.length + 2)}${cellText(c)}`));
        break;
      case "kv":
        out.push(b.value ? `${b.key}: ${b.value}` : `${b.key}:`);
        if (b.source) out.push(`  ${b.source}`);
        break;
      case "table": {
        const grid: string[][] = [];
        if (b.headers) grid.push(b.headers);
        for (const row of b.rows) if ("cells" in row) grid.push(row.cells.map(cellText));
        const lines = columns(grid);
        let at = 0;
        if (b.headers) out.push(lines[at++]!);
        for (const row of b.rows) out.push("group" in row ? `${row.group}:` : lines[at++]!);
        break;
      }
      case "tree":
        out.push(cellText(b.root));
        for (const line of columns(b.children.map((child) => child.map(cellText)))) out.push(`  - ${line}`);
        break;
      case "section":
        gap(out);
        out.push(b.subtitle ? `${b.title} (${b.subtitle})` : b.title);
        render(b.blocks, out);
        break;
      case "summary":
        gap(out);
        out.push(`${TAG[b.status]} ${b.title}${b.counts?.length ? `  ${b.counts.join(", ")}` : ""}`);
        break;
      case "paragraph":
        out.push(b.text);
        break;
      case "copy":
        caption(out, b.caption);
        out.push(b.text);
        break;
      case "verbatim":
        caption(out, b.caption);
        for (const l of b.lines) out.push(`  ${l}`);
        break;
      case "changes":
        for (const c of b.changes) out.push(`${c.op} ${c.name}${c.hint ? `  ${c.hint}` : ""}`);
        break;
      case "diff":
        for (const h of b.hunks) {
          out.push(h.header);
          for (const l of h.lines) out.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}`);
        }
        break;
      case "banner":
        out.push(`${b.label} ${b.subject}${b.hint ? `  ${b.hint}` : ""}`);
        break;
      case "failure":
        out.push(`${TAG.failed} ${b.title}${b.hint ? `  ${b.hint}` : ""}`);
        if (b.why) out.push(`  why: ${b.why}`);
        if (b.next) out.push(`  next: ${cellText(b.next)}`);
        if (b.details) out.push(`  ${b.details}`);
        break;
    }
  }
}

// Text from a branch name or a child process must not repaint the terminal
// when the fallback writes it raw. Newlines and tabs are kept.
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function renderPlain(blocks: Block[]): string {
  const out: string[] = [];
  render(blocks, out);
  if (out.length === 0) return "";
  return (out.join("\n") + "\n").replace(ESCAPES, "").replace(CONTROLS, "");
}
