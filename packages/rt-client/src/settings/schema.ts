/**
 * Runtime schema checks for composite settings, over the JSON Schema the
 * registry attaches from the lock. The full schema describes the value a
 * reader receives; a deep-merge layer is checked against the derived layer
 * schema (object properties optional, array items whole) so a store that
 * sets one field is not refused. The same validator runs in the browser.
 */

import { Validator, type OutputUnit } from "@cfworker/json-schema";
import type { SettingDef } from "./registry-machinery.ts";

export type JsonSchema = Record<string, unknown>;

/** A JSON Schema node is a plain object; excludes arrays and the `true`/`false` boolean subschemas. */
export const isSchema = (v: unknown): v is JsonSchema => v !== null && typeof v === "object" && !Array.isArray(v);

export interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

export function hasSchema(def: SettingDef): def is SettingDef & { schema: JsonSchema } {
  return def.schema !== undefined;
}

/** Drops `required` at every object level except inside `items`/`prefixItems`. */
export function layerJsonSchema(json: JsonSchema): JsonSchema {
  return relax(json, false) as JsonSchema;
}

function relax(node: unknown, insideArray: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => relax(n, insideArray));
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "required" && !insideArray) continue;
    if (k === "items" || k === "prefixItems") out[k] = relax(v, true);
    else if (k === "properties" || k === "$defs" || k === "definitions") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, relax(pv, insideArray)]));
    } else out[k] = relax(v, insideArray);
  }
  return out;
}

/** A `oneOf` whose branches each require a distinct `const` on one property
    (zod's discriminatedUnion) is checked as if/then on that tag: plain
    `oneOf` reports every failing branch, so a codeowners tab would read
    "expected authors" and never name its missing section. */
function discriminated(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(discriminated);
  if (!isSchema(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = discriminated(v);
  const branches = out.oneOf;
  if (!Array.isArray(branches)) return out;
  const tag = tagOf(branches);
  if (!tag) return out;
  const values = branches.map((b) => ((b as Record<string, Record<string, Record<string, unknown>>>).properties![tag]!).const);
  const { oneOf: _drop, ...rest } = out;
  return {
    ...rest,
    type: "object",
    required: [tag],
    properties: { [tag]: { enum: values } },
    allOf: branches.map((b, i) => ({ if: { properties: { [tag]: { const: values[i] } }, required: [tag] }, then: b })),
  };
}

function tagOf(branches: unknown[]): string | null {
  const first = isSchema(branches[0]) ? branches[0].properties : undefined;
  if (!isSchema(first)) return null;
  for (const name of Object.keys(first)) {
    const tags = branches.map((b) => {
      if (!isSchema(b) || !isSchema(b.properties) || !Array.isArray(b.required) || !b.required.includes(name)) return undefined;
      const prop = b.properties[name];
      return isSchema(prop) && "const" in prop ? prop.const : undefined;
    });
    if (tags.every((t) => t !== undefined) && new Set(tags).size === tags.length) return name;
  }
  return null;
}

const validators = new WeakMap<JsonSchema, Validator>();

function validatorFor(json: JsonSchema): Validator {
  let v = validators.get(json);
  if (!v) {
    v = new Validator(discriminated(json) as never, "2020-12", false);
    validators.set(json, v);
  }
  return v;
}

/** Browser and server share this: a JSON Schema check with rt's issue shape. */
export function validateJson(json: JsonSchema, value: unknown): SchemaIssue[] {
  const out = validatorFor(json).validate(value);
  return [...(out.valid ? [] : toIssues(out.errors)), ...uniqueByIssues(json, value)];
}

/** `uniqueBy` is rt's one schema keyword beyond JSON Schema (zod `.meta()`
    carries it into the lock): no two items of that array may share the named
    property's value. JSON Schema cannot say "unique by a field", so both
    validators check it after the standard pass. */
function uniqueByIssues(schema: JsonSchema, value: unknown, path: (string | number)[] = []): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  if (Array.isArray(value)) {
    const field = schema.uniqueBy;
    if (typeof field === "string") {
      const seen = new Set<unknown>();
      value.forEach((item, i) => {
        if (item === null || typeof item !== "object") return;
        const v = (item as Record<string, unknown>)[field];
        if (v === undefined) return;
        if (seen.has(v)) out.push({ path: [...path, i, field], message: `duplicate ${field} "${String(v)}"` });
        seen.add(v);
      });
    }
    const items = schema.items;
    if (isSchema(items)) value.forEach((item, i) => out.push(...uniqueByIssues(items, item, [...path, i])));
  } else if (value !== null && typeof value === "object") {
    const props = schema.properties;
    const extra = schema.additionalProperties;
    for (const [k, v] of Object.entries(value)) {
      const own = isSchema(props) ? (props as Record<string, unknown>)[k] : undefined;
      const sub = isSchema(own) ? own : isSchema(extra) ? extra : null;
      if (sub) out.push(...uniqueByIssues(sub, v, [...path, k]));
    }
  }
  return out;
}


const SUMMARY_KEYWORDS = new Set(["properties", "items", "additionalProperties", "prefixItems", "allOf", "anyOf", "oneOf", "propertyNames", "if", "then", "else"]);

/** cfworker reports outer-first with a summary unit per container; only the deepest units are issues. */
function toIssues(units: OutputUnit[]): SchemaIssue[] {
  const leaves = units.filter(
    (u) => !SUMMARY_KEYWORDS.has(u.keyword) && !units.some((o) => o !== u && o.instanceLocation.startsWith(`${u.instanceLocation}/`)),
  );
  return leaves.map((u) => {
    const path = pointerToPath(u.instanceLocation);
    if (u.keyword === "required") {
      const name = /required property "([^"]+)"/.exec(u.error)?.[1];
      return { path: name ? [...path, name] : path, message: `required property "${name ?? "?"}" is missing` };
    }
    if (u.keyword === "type") {
      const m = /type "([^"]+)" is invalid\. Expected "([^"]+)"/.exec(u.error);
      return { path, message: m ? `expected ${m[2]}, got ${m[1]}` : u.error };
    }
    // An `additionalProperties: false` extra surfaces as a unit whose keyword is the
    // literal "false" (the boolean subschema), located at the extra property itself.
    if (u.keyword === "false") {
      return { path, message: `unexpected property "${String(path.at(-1) ?? "")}"` };
    }
    if (u.keyword === "minimum" || u.keyword === "maximum" || u.keyword === "exclusiveMinimum" || u.keyword === "exclusiveMaximum") {
      const bound = /(-?\d+(?:\.\d+)?)\.?$/.exec(u.error)?.[1] ?? "?";
      const op = u.keyword === "minimum" ? ">=" : u.keyword === "maximum" ? "<=" : u.keyword === "exclusiveMinimum" ? ">" : "<";
      return { path, message: `must be ${op} ${bound}` };
    }
    if (u.keyword === "enum") {
      // cfworker: `Instance does not match any of ["a","b"].`
      const raw = /(\[.*\])/.exec(u.error)?.[1];
      let list = "";
      try { list = raw ? (JSON.parse(raw) as unknown[]).map(String).join(", ") : ""; } catch { list = raw ?? ""; }
      return { path, message: `expected one of ${list}` };
    }
    if (u.keyword === "const") {
      // cfworker: `Instance does not match "human".`
      const want = /does not match (.+?)\.?$/.exec(u.error)?.[1]?.replace(/^"|"$/g, "") ?? "";
      return { path, message: `expected "${want}"` };
    }
    return { path, message: u.error };
  });
}

// cfworker builds instanceLocation with encodeURI over the escaped pointer, so
// each segment is URI-decoded before the ~1/~0 unescape.
function pointerToPath(pointer: string): (string | number)[] {
  return pointer
    .replace(/^#\/?/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

export function checkSchema(def: SettingDef, value: unknown, opts: { layer: boolean }): SchemaIssue[] {
  if (!hasSchema(def)) return [];
  const json = opts.layer && def.merge === "deep" && def.type === "object" ? (def.layerSchema ?? layerJsonSchema(def.schema)) : def.schema;
  return validateJson(json, value);
}

export function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

export function firstIssueText(issues: SchemaIssue[]): string {
  const first = issues[0];
  return first ? `${formatIssuePath(first.path)}: ${first.message}` : "";
}
