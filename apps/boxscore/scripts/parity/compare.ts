import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  boardBySlug,
  targetsOf,
  type Mismatch,
  type ParityNode,
} from './boards';

export const OUTPUT_DIR = join(homedir(), '.fast-browser', 'output', 'parity');

const BOX_TOLERANCE = 1;
const CHANNEL_TOLERANCE = 1;
const ALPHA_TOLERANCE = 0.01;
const OPACITY_TOLERANCE = 0.01;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    const full =
      hex.length === 3 || hex.length === 4
        ? [...hex].map(c => c + c).join('')
        : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return {
      r: at(0),
      g: at(2),
      b: at(4),
      a: full.length === 8 ? at(6) / 255 : 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s)?.[1];
  if (fn) {
    const [r, g, b, a] = fn
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: r!, g: g!, b: b!, a: a ?? 1 };
  }
  // Chrome serialises color-mix() and relative colours as color(srgb r g b / a) with 0..1 channels.
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(s)?.[1];
  if (srgb) {
    const [r, g, b, a] = srgb
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);
    return {
      r: Math.round(r! * 255),
      g: Math.round(g! * 255),
      b: Math.round(b! * 255),
      a: a ?? 1,
    };
  }
  return null;
}

function formatRgba({ r, g, b, a }: Rgba): string {
  const alpha = Math.round(a * 100) / 100;
  return alpha >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `rgb(r, g, b)` or `rgba(r, g, b, a)`; null for no colour or a fully transparent one. Unparseable input passes through. */
export function normColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const c = parseColor(input);
  if (!c) return input.trim();
  if (c.a === 0) return null;
  return formatRgba(c);
}

function sameColor(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a === b;
  return (
    Math.abs(pa.r - pb.r) <= CHANNEL_TOLERANCE &&
    Math.abs(pa.g - pb.g) <= CHANNEL_TOLERANCE &&
    Math.abs(pa.b - pb.b) <= CHANNEL_TOLERANCE &&
    Math.abs(pa.a - pb.a) <= ALPHA_TOLERANCE
  );
}

const num = (v: number) => String(Math.round(v * 100) / 100);
const show = (v: string | null) => v ?? 'none';

function isDynamic(key: string, dynamicText: string[]): boolean {
  const leaf = key
    .split('/')
    .pop()!
    .replace(/\[\d+\]$/, '');
  return dynamicText.includes(leaf);
}

/** Time-based copy ("Synced 4 min ago", "Stalled · 42s") keeps its words but not its numbers. */
const maskNumbers = (s: string) => s.replace(/\d+/g, '#');

/**
 * Drops design layers that paint nothing (frames with no fill or stroke),
 * then rebuilds every key from the surviving ancestors, indexing names that
 * repeat under the same surviving parent in document order. Needs the raw
 * collector output (`name`, `parent`, `tag` on every node, preorder).
 */
export function visibleOnly(nodes: ParityNode[]): ParityNode[] {
  const keep = nodes.map(
    v =>
      v.parent === -1 ||
      v.kind === 'text' ||
      normColor(v.fill) !== null ||
      normColor(v.stroke) !== null ||
      v.tag === 'svg' ||
      v.tag === 'img'
  );
  const keptParent = (i: number): number => {
    let p = nodes[i]!.parent ?? -1;
    while (p !== -1 && !keep[p]) p = nodes[p]!.parent ?? -1;
    return p;
  };
  const parentOf = new Map<number, number>();
  const counts = new Map<string, number>();
  const groupKey = (p: number, name: string) => `${p}\u0000${name}`;
  nodes.forEach((v, i) => {
    if (!keep[i] || v.parent === -1) return;
    const p = keptParent(i);
    parentOf.set(i, p);
    const k = groupKey(p, v.name ?? v.key);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  const out: ParityNode[] = [];
  nodes.forEach((v, i) => {
    if (!keep[i]) return;
    const name = v.name ?? v.key;
    if (v.parent === -1) {
      keys.set(i, name);
      out.push({ ...v, key: name });
      return;
    }
    const p = parentOf.get(i)!;
    const k = groupKey(p, name);
    const idx = seen.get(k) ?? 0;
    seen.set(k, idx + 1);
    const own = counts.get(k)! > 1 ? `${name}[${idx}]` : name;
    const parentNode = nodes[p]!;
    const prefix = parentNode.parent === -1 ? '' : keys.get(p)!;
    const key = prefix ? `${prefix}/${own}` : own;
    keys.set(i, key);
    out.push({ ...v, key });
  });
  return out;
}

export interface CompareOptions {
  dynamicText: string[];
}

export function compare(
  design: ParityNode[],
  app: ParityNode[],
  opts: CompareOptions
): Mismatch[] {
  const out: Mismatch[] = [];
  const appByKey = new Map<string, ParityNode>();
  const appCount = new Map<string, number>();
  for (const a of app) {
    appCount.set(a.key, (appCount.get(a.key) ?? 0) + 1);
    if (!appByKey.has(a.key)) appByKey.set(a.key, a);
  }
  const designKeys = new Set(design.map(d => d.key));

  for (const d of design) {
    const a = appByKey.get(d.key);
    if (!a) {
      out.push({
        key: d.key,
        field: 'missing',
        design: 'present',
        app: 'absent',
      });
      continue;
    }
    const count = appCount.get(d.key)!;
    if (count > 1) {
      out.push({
        key: d.key,
        field: 'duplicate',
        design: '1',
        app: String(count),
      });
    }
    const boxFields: ('x' | 'y' | 'w' | 'h')[] =
      d.kind === 'text' ? ['x', 'y', 'h'] : ['x', 'y', 'w', 'h'];
    for (const f of boxFields) {
      if (Math.abs(d[f] - a[f]) > BOX_TOLERANCE) {
        out.push({ key: d.key, field: f, design: num(d[f]), app: num(a[f]) });
      }
    }
    for (const f of ['fill', 'stroke', 'color'] as const) {
      const dc = normColor(d[f]);
      const ac = normColor(a[f]);
      if (!sameColor(dc, ac)) {
        out.push({ key: d.key, field: f, design: show(dc), app: show(ac) });
      }
    }
    const dop = d.opacity ?? 1;
    const aop = a.opacity ?? 1;
    if (Math.abs(dop - aop) > OPACITY_TOLERANCE) {
      out.push({
        key: d.key,
        field: 'opacity',
        design: num(dop),
        app: num(aop),
      });
    }
    const dt = d.text ?? null;
    const at = a.text ?? null;
    const textMatches =
      dt === null || at === null
        ? dt === at
        : isDynamic(d.key, opts.dynamicText)
          ? maskNumbers(dt) === maskNumbers(at)
          : dt === at;
    if (!textMatches) {
      out.push({ key: d.key, field: 'text', design: show(dt), app: show(at) });
    }
  }

  for (const key of appByKey.keys()) {
    if (!designKeys.has(key)) {
      out.push({ key, field: 'extra', design: 'absent', app: 'present' });
    }
  }
  return out;
}

export function formatTable(title: string, mismatches: Mismatch[]): string {
  if (mismatches.length === 0) return `${title}: 0 mismatches`;
  const rows = mismatches.map(m => [m.key, m.field, m.design, m.app]);
  const head = ['key', 'field', 'design', 'app'];
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i]!.length))
  );
  const line = (r: string[]) =>
    `| ${r.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    `${title}: ${mismatches.length} mismatch${mismatches.length === 1 ? '' : 'es'}`,
    line(head),
    `|${widths.map(w => '-'.repeat(w + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

function readNodes(path: string): ParityNode[] {
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as ParityNode[];
}

function compareFiles(designPath: string, appPath: string, slug: string) {
  const board = boardBySlug(slug);
  return compare(visibleOnly(readNodes(designPath)), readNodes(appPath), {
    dynamicText: board.dynamicText,
  });
}

const USAGE = `usage:
  bun scripts/parity/compare.ts <design.json> <app.json> <slug>
  bun scripts/parity/compare.ts --board <slug> <dark|light>   (reads ${OUTPUT_DIR})`;

function main(argv: string[]): number {
  if (argv[0] === '--board' && argv.length === 3) {
    const [, slug, scheme] = argv as [string, string, string];
    let total = 0;
    for (const t of targetsOf(boardBySlug(slug))) {
      const base = join(OUTPUT_DIR, `${t.stem}.${scheme}`);
      const m = compareFiles(`${base}.design.json`, `${base}.app.json`, slug);
      total += m.length;
      console.log(formatTable(`${t.stem} ${scheme}`, m));
    }
    return total === 0 ? 0 : 1;
  }
  if (argv.length === 3 && !argv[0]!.startsWith('--')) {
    const [designPath, appPath, slug] = argv as [string, string, string];
    const m = compareFiles(designPath, appPath, slug);
    console.log(formatTable(slug, m));
    return m.length === 0 ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
}
