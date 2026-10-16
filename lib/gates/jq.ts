export class JqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JqError";
  }
}

const encoder = new TextEncoder();

export function utf8Bytes(s: string): number {
  return encoder.encode(s).length;
}

export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function cpSlice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join("");
}

export function tojson(v: unknown): string {
  return JSON.stringify(v).replace(/\x7f/g, "\\u007f");
}

export function tostring(v: unknown): string {
  return typeof v === "string" ? v : tojson(v);
}

export function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

export function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const SPACE = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

export function isSpace(ch: string): boolean {
  return SPACE.test(ch);
}

export function hasNonSpace(s: string): boolean {
  for (const ch of s) if (!isSpace(ch)) return true;
  return false;
}

export type JqType = "null" | "boolean" | "number" | "string" | "array" | "object";

export function jqType(v: unknown): JqType {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "boolean" || t === "number" || t === "string") return t;
  return "object";
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return jqType(v) === "object";
}

function rank(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (v === false) return 1;
  if (v === true) return 2;
  return ["number", "string", "array", "object"].indexOf(jqType(v)) + 3;
}

function compareCodepoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return (x.done ? 0 : 1) - (y.done ? 0 : 1);
    const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
}

export function jqCompare(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (jqType(a)) {
    case "number":
      return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    case "string":
      return compareCodepoints(a as string, b as string);
    case "array": {
      const xs = a as unknown[];
      const ys = b as unknown[];
      for (let i = 0; i < xs.length && i < ys.length; i++) {
        const c = jqCompare(xs[i], ys[i]);
        if (c !== 0) return c;
      }
      return xs.length < ys.length ? -1 : xs.length > ys.length ? 1 : 0;
    }
    case "object": {
      const ka = jqKeys(a);
      const kb = jqKeys(b);
      const c = jqCompare(ka, kb);
      if (c !== 0) return c;
      for (const k of ka) {
        const d = jqCompare((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
        if (d !== 0) return d;
      }
      return 0;
    }
    default:
      return 0;
  }
}

export function jqEqual(a: unknown, b: unknown): boolean {
  return jqCompare(a, b) === 0;
}

export function jqKeys(v: unknown): string[] {
  return Object.keys(v as object).sort(compareCodepoints);
}

/** Stable, like jq's sort. */
export function jqSort<T>(xs: T[]): T[] {
  return [...xs].sort(jqCompare);
}

export function jqGroupBy<T>(xs: T[], key: (x: T) => unknown): T[][] {
  const sorted = [...xs].sort((a, b) => jqCompare(key(a), key(b)));
  const groups: T[][] = [];
  for (const x of sorted) {
    const last = groups[groups.length - 1];
    if (last && jqEqual(key(last[0] as T), key(x))) last.push(x);
    else groups.push([x]);
  }
  return groups;
}

export function jqHas(v: unknown, k: string): boolean {
  if (v === null || v === undefined) return false;
  if (!isObject(v)) throw new JqError(`Cannot check whether ${jqType(v)} has a string key`);
  return Object.hasOwn(v, k);
}

export function jqGet(v: unknown, k: string): unknown {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) throw new JqError(`Cannot index ${jqType(v)} with "${k}"`);
  return Object.hasOwn(v, k) ? v[k] : null;
}

/** jq's `.[]?`: array elements or object values, nothing for anything else. */
export function jqValuesOpt(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObject(v)) return Object.values(v);
  return [];
}

export function truthy(v: unknown): boolean {
  return v !== false && v !== null && v !== undefined;
}

export function ok(f: () => unknown): boolean {
  try {
    return truthy(f());
  } catch (e) {
    if (e instanceof JqError) return false;
    throw e;
  }
}
