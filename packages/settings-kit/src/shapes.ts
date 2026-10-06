/**
 * Composite value shapes and the pure helpers every settings UI shares.
 * Headless, with `@cfworker/json-schema` as its only runtime import, so a
 * browser bundle and the server's write gate load the same declarations.
 * `recognize` derives the editor kind from a def's JSON Schema; `SHAPES`
 * carries only the keys an owning app's own editor handles (`external`),
 * never a schema-derivable kind.
 */
import type { SettingDefWire } from "./server.ts";
import { Validator, type OutputUnit } from "@cfworker/json-schema";

export type LeafType = "string" | "number" | "boolean" | { enum: readonly string[] };

export type CompositeShape =
  | { kind: "stringList" }
  | { kind: "pairList"; fields: readonly [string, string] }
  | { kind: "stringMap"; labels: readonly [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType>; fallbacks?: Record<string, string> }
  | { kind: "external"; app: string };

export type RowKind = "scalar" | "enum" | "readonly" | CompositeShape["kind"] | "objectList" | "objectMap" | "json";

export type JsonSchema = Record<string, unknown>;

export interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

export type Recognized =
  | { kind: "stringList" }
  | { kind: "stringMap"; labels: [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType>; placeholders: Record<string, string> }
  | { kind: "objectList"; itemFields: Record<string, LeafType>; required: string[] }
  | { kind: "objectMap"; entryFields: Record<string, LeafType>; required: string[]; labels: [string, string] }
  | { kind: "json" };

function leafOf(s: JsonSchema): LeafType | null {
  if (Array.isArray(s.enum) && s.enum.every((e) => typeof e === "string")) return { enum: s.enum as string[] };
  if (s.type === "string" || s.type === "number" || s.type === "boolean") return s.type;
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter((x) => x !== "null");
    if (t.length === 1) return leafOf({ ...s, type: t[0] });
  }
  return null;
}

function flatFields(props: Record<string, JsonSchema> | undefined): Record<string, LeafType> | null {
  if (!props) return null;
  const out: Record<string, LeafType> = {};
  for (const [k, v] of Object.entries(props)) {
    const leaf = leafOf(v);
    if (!leaf) return null;
    out[k] = leaf;
  }
  return out;
}

/** Dotted leaf paths one level deep (emoji.looking), the way leaves rows render. */
function leafPaths(props: Record<string, JsonSchema>, prefix = ""): { fields: Record<string, LeafType>; placeholders: Record<string, string> } | null {
  const fields: Record<string, LeafType> = {};
  const placeholders: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const leaf = leafOf(v);
    if (leaf) {
      fields[prefix + k] = leaf;
      if (typeof v.placeholder === "string") placeholders[prefix + k] = v.placeholder;
      continue;
    }
    if (v.type === "object" && v.properties && prefix === "") {
      const nested = leafPaths(v.properties as Record<string, JsonSchema>, `${k}.`);
      if (!nested) return null;
      Object.assign(fields, nested.fields);
      Object.assign(placeholders, nested.placeholders);
      continue;
    }
    return null;
  }
  return { fields, placeholders };
}

/** The one place a def's editor kind is derived: every RowKind/summarize
    caller reads a schema through this rather than re-inspecting it. */
export function recognize(schema: JsonSchema | undefined): Recognized {
  if (!schema) return { kind: "json" };
  const labels = schema.labels as { key?: string; value?: string } | undefined;
  const labelPair: [string, string] = [labels?.key ?? "key", labels?.value ?? "value"];
  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined;
    if (items?.type === "string") return { kind: "stringList" };
    if (items?.type === "object") {
      const fields = flatFields(items.properties as Record<string, JsonSchema> | undefined);
      if (fields) return { kind: "objectList", itemFields: fields, required: (items.required as string[]) ?? [] };
    }
    return { kind: "json" };
  }
  if (schema.type === "object") {
    const add = schema.additionalProperties as JsonSchema | boolean | undefined;
    const props = schema.properties as Record<string, JsonSchema> | undefined;
    if ((!props || Object.keys(props).length === 0) && add && typeof add === "object" && Object.keys(add).length > 0) {
      if (add.type === "string") return { kind: "stringMap", labels: labelPair };
      if (add.type === "object") {
        const fields = flatFields(add.properties as Record<string, JsonSchema> | undefined);
        if (fields) return { kind: "objectMap", entryFields: fields, required: (add.required as string[]) ?? [], labels: labelPair };
      }
      return { kind: "json" };
    }
    const leaves = leafPaths(props ?? {});
    if (leaves) return { kind: "leaves", ...leaves };
  }
  return { kind: "json" };
}

// Duplicated from rt-client's settings/schema.ts rather than imported: this
// module builds into the browser bundle, which never pulls in rt-client. The
// two copies are pinned together by a parity test over shared fixtures.
/** A `oneOf` whose branches each require a distinct `const` on one property
    (zod's discriminatedUnion) is checked as if/then on that tag: plain
    `oneOf` reports every failing branch, so a codeowners tab would read
    "expected authors" and never name its missing section. */
function discriminated(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(discriminated);
  if (!isRecord(schema)) return schema;
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
    allOf: branches.map((b, i) => ({ if: { type: "object", properties: { [tag]: { const: values[i] } }, required: [tag] }, then: b })),
  };
}

/** A tagged `oneOf` (see `discriminated`): its tag property and each
    branch's tag value with that branch's schema; null for any other schema. */
export function taggedUnion(schema: unknown): { tag: string; branches: { value: string; schema: JsonSchema }[] } | null {
  if (!isRecord(schema) || !Array.isArray(schema.oneOf)) return null;
  const branches = schema.oneOf as JsonSchema[];
  const tag = tagOf(branches);
  if (!tag) return null;
  const values = branches.map((b) => (b.properties as Record<string, JsonSchema>)[tag]!.const);
  if (!values.every((v): v is string => typeof v === "string")) return null;
  return { tag, branches: branches.map((b, i) => ({ value: values[i]!, schema: b })) };
}

function tagOf(branches: unknown[]): string | null {
  const first = isRecord(branches[0]) ? branches[0].properties : undefined;
  if (!isRecord(first)) return null;
  for (const name of Object.keys(first)) {
    const tags = branches.map((b) => {
      if (!isRecord(b) || !isRecord(b.properties) || !Array.isArray(b.required) || !b.required.includes(name)) return undefined;
      const prop = b.properties[name];
      return isRecord(prop) && "const" in prop ? prop.const : undefined;
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

export function checkValue(json: JsonSchema, value: unknown): SchemaIssue[] {
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
    if (isRecord(items)) value.forEach((item, i) => out.push(...uniqueByIssues(items, item, [...path, i])));
  } else if (value !== null && typeof value === "object") {
    const props = schema.properties;
    const extra = schema.additionalProperties;
    for (const [k, v] of Object.entries(value)) {
      const own = isRecord(props) ? (props as Record<string, unknown>)[k] : undefined;
      const sub = isRecord(own) ? own : isRecord(extra) ? extra : null;
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

/** True only when the value passes the def's own schema (its layer schema
    when it has one). False, never thrown, for a def with no schema at all. */
export function matchesSchema(def: SettingDefWire, value: unknown): boolean {
  const schema = def.layerSchema ?? def.schema;
  if (!schema) return false;
  return checkValue(schema, value).length === 0;
}

/** Mirrors NOTIFICATION_TYPES in rt's lib/notifier.ts; the parity test in
    lib/__tests__/notification-shape-parity.test.ts fails when the two drift. */
export const NOTIFICATION_EVENTS = [
  "pipeline_failed", "pipeline_passed", "mr_approved", "mr_merged", "mr_closed", "mr_ready",
  "merge_conflicts", "needs_rebase", "merge_error", "new_comment", "stale_port", "runaway_process",
  "evidence_batch_ready", "evidence_failed", "chat_mention", "credential_health", "member_joined",
  "worktree_triage",
  "setup_update",
] as const;

/** board's slack-emoji.ts DEFAULT_SLACK_EMOJI; board asserts parity. */
export const DEFAULT_SLACK_EMOJI = { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" } as const;

const BOARD_EDITOR = { kind: "external", app: "board" } as const;

/** Only a key whose value board's own UI owns end to end belongs here; every
    other composite key's editor kind comes from `recognize(def.schema)`. */
export const SHAPES: Record<string, CompositeShape> = {
  "board.members": BOARD_EDITOR,
  "board.hiddenMembers": BOARD_EDITOR,
};

export const ENUMS: Record<string, readonly string[]> = {
  "agent.provider": ["claude", "codex"],
  "rt.logLevel": ["trace", "debug", "info", "warn", "error"],
  "rt.ui.background": ["auto", "dark", "light"],
  "boxscore.defaultRange": ["7d", "30d", "90d"],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesLeaf(type: LeafType, v: unknown): boolean {
  if (typeof type === "string") return typeof v === type;
  return typeof v === "string" && type.enum.includes(v);
}

/** Owning apps validate `external` values themselves; the kit cannot. */
export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  switch (shape.kind) {
    case "stringList":
      return Array.isArray(value) && value.every((x) => typeof x === "string");
    case "pairList":
      return Array.isArray(value) && value.every((x) => isRecord(x) && shape.fields.every((f) => typeof x[f] === "string"));
    case "stringMap":
      return isRecord(value) && Object.values(value).every((x) => typeof x === "string");
    case "leaves":
      return (
        isRecord(value) &&
        Object.entries(shape.fields).every(([path, type]) => {
          if (!parentsAreRecords(value, path)) return false;
          const v = getLeaf(value, path);
          return v === undefined || matchesLeaf(type, v);
        })
      );
    case "external":
      return true;
  }
}

/** getLeaf reads a non-object parent as an absent leaf; the write gate must
    not, since the owning app's loader throws on it. A missing parent is fine. */
function parentsAreRecords(obj: Record<string, unknown>, path: string): boolean {
  let cur: unknown = obj;
  for (const part of path.split(".").slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return true;
    if (!isRecord(cur)) return false;
  }
  return true;
}

export function getLeaf(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setLeaf(obj: unknown, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const base = isRecord(obj) ? { ...obj } : {};
  if (rest.length === 0) {
    if (value === undefined) delete base[head!];
    else base[head!] = value;
    return base;
  }
  base[head!] = setLeaf(base[head!], rest.join("."), value);
  return base;
}

export function parseScalar(
  type: "string" | "number",
  text: string,
): { ok: true; value: string | number } | { ok: false; error: string } {
  if (type === "string") return { ok: true, value: text };
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "enter a number" };
  const n = Number(trimmed);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "not a number" };
}

/** The next list after adding `entry`, or null when there is nothing to add. */
export function addToList(list: string[], entry: string): string[] | null {
  const trimmed = entry.trim();
  if (trimmed === "" || list.includes(trimmed)) return null;
  return [...list, trimmed];
}

export function filterDefs<T extends { key: string; description: string }>(defs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return defs;
  return defs.filter((d) => d.key.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
}

export function isSet(def: SettingDefWire): boolean {
  const scope = def.effective.scope;
  return scope != null && scope !== "default";
}

export function formatValue(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

export function rowKind(def: SettingDefWire): RowKind {
  if (SHAPES[def.key]?.kind === "external") return "external";
  if (def.secret || !def.writable) return "readonly";
  if (def.type === "object" || def.type === "array") return recognize(def.schema).kind;
  if (ENUMS[def.key]) return "enum";
  return "scalar";
}

function nouns(key: string): [singular: string, plural: string] {
  const segment = key.split(".").at(-1) ?? key;
  const plural = (segment.split(/(?=[A-Z])/).at(-1) ?? segment).toLowerCase();
  if (plural.endsWith("ixes")) return [plural.slice(0, -2), plural];
  if (plural.endsWith("s")) return [plural.slice(0, -1), plural];
  return [plural, plural];
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The one-line collapsed form of a composite row, counted by the kind
    `recognize` derives from the def's schema. That holds for an `external`
    key too; a schema no editor kind fits gets the generic `json` count. */
export function summarize(def: SettingDefWire): string {
  const v = def.effective.value;
  const r = recognize(def.schema);
  switch (r.kind) {
    case "stringList":
      return count(Array.isArray(v) ? v.length : 0, ...nouns(def.key));
    case "stringMap":
      return count(isRecord(v) ? Object.keys(v).length : 0, "entry", "entries");
    case "leaves": {
      const paths = Object.keys(r.fields);
      const source = def.merge === "deep" && def.type === "object" ? def.effective.authored : v;
      const set = paths.filter((p) => getLeaf(source, p) !== undefined).length;
      return `${set} of ${paths.length} set`;
    }
    case "objectList":
      return count(Array.isArray(v) ? v.length : 0, ...nouns(def.key));
    case "objectMap":
      return count(isRecord(v) ? Object.keys(v).length : 0, "entry", "entries");
    case "json":
      if (Array.isArray(v)) return count(v.length, ...nouns(def.key));
      if (isRecord(v)) return count(Object.keys(v).length, "field", "fields");
      return "unset";
  }
}

/** Where an edit lands: the winning layer when the key allows it there,
    else the key's first allowed scope. */
export function targetScope(def: SettingDefWire): string {
  const scope = def.effective.scope;
  return scope !== null && (def.scopes as readonly string[]).includes(scope) ? scope : def.scopes[0]!;
}
