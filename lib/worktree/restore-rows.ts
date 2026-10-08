/**
 * Rows for `rt worktree restore`: rt cd's worktree row with the tree name
 * leading, grouped under the date the tree was cleaned up, plus how many
 * days rt keeps it.
 */
import { formatBranchSegments, type EnrichedBranch } from "../enrich.ts";
import { dateGroupLabel } from "../date-group.ts";
import * as out from "../ui/out.ts";
import type { Block, PickRow, PickSegment } from "../ui/protocol.ts";
import type { RestorableEntry } from "./restore.ts";

const DAY_MS = 86_400_000;

export function daysLeft(keptUntil: string, now: Date): string {
  const days = Math.ceil((Date.parse(keptUntil) - now.getTime()) / DAY_MS);
  return days <= 0 ? "last day" : `${days}d left`;
}

function withDaysLeft(right: PickSegment[], e: RestorableEntry, now: Date): PickSegment[] {
  const tag: PickSegment = { text: daysLeft(e.keptUntil, now), tone: "dimmer" };
  return right.length > 0 ? [...right, { text: "  " }, tag] : [tag];
}

function cheapRow(e: RestorableEntry, now: Date): PickRow {
  const left: PickSegment[] = e.branch
    ? [{ text: e.name, bold: true, column: true }, { text: "  ", tone: "faint" }, { text: e.branch, tone: "dim" }]
    : [{ text: e.name, bold: true, column: true }];
  return { value: e.name, left, right: withDaysLeft([], e, now), match: [e.name, e.branch ?? ""].filter(Boolean).join(" "), group: dateGroupLabel(new Date(e.disposedAt), now) };
}

/** Before enrichment lands, `enriched` is undefined and every row is the cheap one. */
export function restoreRows(entries: RestorableEntry[], enriched: Map<string, EnrichedBranch> | undefined, now: Date): PickRow[] {
  return entries.map((e) => {
    const eb = enriched?.get(e.path);
    if (!eb || !e.branch) return cheapRow(e, now);
    const { left, right, match } = formatBranchSegments({ ...eb, dirName: e.name }, { placeholderTags: false });
    return { value: e.name, left, right: withDaysLeft(right, e, now), match, group: dateGroupLabel(new Date(e.disposedAt), now) };
  });
}

/** `--list`'s cells: the same title and status words as the picker row, as plain text. */
export function restoreListCells(e: RestorableEntry, eb: EnrichedBranch | undefined, now: Date): [string, string, string, string] {
  const fallback = e.branch ?? "(detached)";
  if (!eb || !e.branch) return [e.name, fallback, "", daysLeft(e.keptUntil, now)];
  const { left, right } = formatBranchSegments({ ...eb, dirName: e.name }, { placeholderTags: false });
  const title = left.at(-1)?.text ?? fallback;
  return [e.name, title, right.map((s) => s.text).join(""), daysLeft(e.keptUntil, now)];
}

/** `--list`'s table: one row per tree under its cleanup-date group. */
export function restoreListBlock(entries: RestorableEntry[], enriched: Map<string, EnrichedBranch>, now: Date): Block {
  const rows: Array<out.CellInput[] | { group: string }> = [];
  let group: string | undefined;
  for (const e of entries) {
    const label = dateGroupLabel(new Date(e.disposedAt), now);
    if (label !== group) rows.push({ group: (group = label) });
    const [name, title, status, days] = restoreListCells(e, enriched.get(e.path), now);
    rows.push([out.strong(name), out.dim(title), out.dim(status), out.dim(days)]);
  }
  return out.table(rows);
}
