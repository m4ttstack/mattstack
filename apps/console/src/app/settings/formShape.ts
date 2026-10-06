import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  rowKind,
  taggedUnion,
  type JsonSchema,
  type LeafType,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

export interface FieldSpec {
  type: LeafType;
  title?: string;
  description?: string;
  placeholder?: string;
  default?: unknown;
  suggestions?: string[];
}

/** A property that is one of several objects told apart by a tag (zod's
    discriminatedUnion): a picker for the tag, then the chosen branch's
    scalar fields. */
export interface UnionSpec {
  title?: string;
  description?: string;
  tag: string;
  branches: {
    value: string;
    fields: Record<string, FieldSpec>;
    required: string[];
  }[];
}

/** A list or map of objects drawn as cards or sections. `nested` names
    declared properties that are neither scalars nor tagged unions: drawn
    read-only, kept on save. `order` is every drawn property in schema
    order. */
export interface FormShape {
  kind: 'objectList' | 'objectMap';
  fields: Record<string, FieldSpec>;
  unions: Record<string, UnionSpec>;
  order: string[];
  nested: string[];
  required: string[];
  labels: [string, string];
}

type Entry = Record<string, unknown>;

function isRecord(v: unknown): v is Entry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function leafOf(s: JsonSchema): LeafType | null {
  if (typeof s.const === 'string') return { enum: [s.const] };
  if (Array.isArray(s.enum) && s.enum.every(e => typeof e === 'string'))
    return { enum: s.enum as string[] };
  if (s.type === 'string' || s.type === 'number' || s.type === 'boolean')
    return s.type;
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter(x => x !== 'null');
    if (t.length === 1) return leafOf({ ...s, type: t[0] });
  }
  return null;
}

function fieldOf(s: JsonSchema): FieldSpec | null {
  const type = leafOf(s);
  if (!type) return null;
  const f: FieldSpec = { type };
  if (typeof s.title === 'string') f.title = s.title;
  if (typeof s.description === 'string') f.description = s.description;
  if (typeof s.placeholder === 'string') f.placeholder = s.placeholder;
  if (s.default !== undefined) f.default = s.default;
  if (Array.isArray(s.examples) && s.examples.every(e => typeof e === 'string'))
    f.suggestions = s.examples as string[];
  return f;
}

function unionOf(s: JsonSchema): UnionSpec | null {
  const union = taggedUnion(s);
  if (!union) return null;
  const branches: UnionSpec['branches'] = [];
  for (const { value, schema } of union.branches) {
    const fields: Record<string, FieldSpec> = {};
    for (const [name, prop] of Object.entries(
      (schema.properties ?? {}) as Record<string, JsonSchema>
    )) {
      if (name === union.tag) continue;
      const f = fieldOf(prop);
      if (!f) return null;
      fields[name] = f;
    }
    const required = Array.isArray(schema.required)
      ? (schema.required as string[]).filter(r => r !== union.tag)
      : [];
    branches.push({ value, fields, required });
  }
  const spec: UnionSpec = { tag: union.tag, branches };
  if (typeof s.title === 'string') spec.title = s.title;
  if (typeof s.description === 'string') spec.description = s.description;
  return spec;
}

/** Cards for a list of objects, sections for a map of objects, when every
    required property is a scalar and at least one property is. Anything
    else is JSON only. */
export function formShape(schema: JsonSchema | undefined): FormShape | null {
  if (!schema) return null;
  let item: JsonSchema | undefined;
  let kind: FormShape['kind'];
  if (schema.type === 'array') {
    item = schema.items as JsonSchema | undefined;
    kind = 'objectList';
  } else if (schema.type === 'object') {
    const props = schema.properties as Record<string, unknown> | undefined;
    const add = schema.additionalProperties;
    if (props && Object.keys(props).length > 0) return null;
    if (!isRecord(add) || Object.keys(add).length === 0) return null;
    item = add as JsonSchema;
    kind = 'objectMap';
  } else return null;
  if (!item || item.type !== 'object' || !isRecord(item.properties))
    return null;
  const fields: Record<string, FieldSpec> = {};
  const unions: Record<string, UnionSpec> = {};
  const order: string[] = [];
  const nested: string[] = [];
  for (const [name, prop] of Object.entries(
    item.properties as Record<string, JsonSchema>
  )) {
    const f = fieldOf(prop);
    const u = f ? null : unionOf(prop);
    if (f) fields[name] = f;
    else if (u) unions[name] = u;
    else {
      nested.push(name);
      continue;
    }
    order.push(name);
  }
  const required = Array.isArray(item.required)
    ? (item.required as string[])
    : [];
  if (Object.keys(fields).length === 0) return null;
  if (required.some(r => !(r in fields) && !(r in unions))) return null;
  const labels = schema.labels as { key?: string; value?: string } | undefined;
  return {
    kind,
    fields,
    unions,
    order,
    nested,
    required,
    labels: [labels?.key ?? 'name', labels?.value ?? 'value'],
  };
}

export function formOf(def: SettingDefWire): FormShape | null {
  return formShape(def.layerSchema ?? def.schema);
}

/** The editor a composite row gets: a form when `formOf` can draw it,
    JSON for any other list or object. */
export function editorKind(def: SettingDefWire): RowKind {
  const kind = rowKind(def);
  if (kind !== 'objectList' && kind !== 'objectMap' && kind !== 'json')
    return kind;
  return formOf(def)?.kind ?? 'json';
}

/** A union property the form can show: absent, or an object whose tag
    names one of its branches. */
function drawsUnions(shape: FormShape, entry: Entry): boolean {
  return Object.entries(shape.unions).every(([name, u]) => {
    const v = entry[name];
    return (
      v === undefined ||
      (isRecord(v) && u.branches.some(b => b.value === v[u.tag]))
    );
  });
}

export function canDraw(shape: FormShape, value: unknown): boolean {
  const entries =
    shape.kind === 'objectList'
      ? Array.isArray(value)
        ? value
        : null
      : isRecord(value)
        ? Object.values(value)
        : null;
  return (
    entries !== null && entries.every(e => isRecord(e) && drawsUnions(shape, e))
  );
}

/** Required scalars from their schema defaults; a required switch with no
    default starts off, since a switch has no empty state. */
export function newEntry(shape: FormShape): Entry {
  const out: Entry = {};
  for (const name of shape.required) {
    const u = shape.unions[name];
    if (u) {
      out[name] = { [u.tag]: u.branches[0]!.value };
      continue;
    }
    const f = shape.fields[name]!;
    if (f.default !== undefined) out[name] = f.default;
    else if (f.type === 'boolean') out[name] = false;
  }
  return out;
}

export function visibleFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return shape.order.filter(
    k =>
      shape.required.includes(k) || entry[k] !== undefined || shown.includes(k)
  );
}

export function addableFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return Object.keys(shape.fields).filter(
    k =>
      !shape.required.includes(k) &&
      entry[k] === undefined &&
      !shown.includes(k)
  );
}

export function extraKeys(shape: FormShape, entry: Entry): string[] {
  return Object.keys(entry).filter(
    k => !(k in shape.fields) && !(k in shape.unions)
  );
}
