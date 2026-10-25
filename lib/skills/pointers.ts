import { posix } from "path";
import { FRONTMATTER_RE } from "./frontmatter-re.ts";

export type Target = string | { skill: string; path: string };
export type UnitTable = Record<string, string>;
export type PointerMap = { id: string; dir: string; covers: string[]; keys: Record<string, Target> };

export const ID_RE = /^(?:[a-z0-9][a-z0-9-]*@\d+(?:\.\d+)*:[a-z0-9][a-z0-9-]*|skills:[a-z0-9][a-z0-9:-]*)$/;

const PATH_CHARS = "[^\\s`'\"\\\\)\\]>,;#?*:]*";
/** The braced form, or the unbraced one when no other name character follows it. */
const TOKEN_FORM = "\\$(?:\\{CLAUDE_SKILL_DIR\\}|CLAUDE_SKILL_DIR(?![A-Za-z0-9_]))";
const TOKEN_RE = new RegExp(`${TOKEN_FORM}(/${PATH_CHARS})?`, "g");
const RELATIVE_RE = new RegExp(`(?<![^\\s\`'"(\\[<])\\.\\.?/${PATH_CHARS}`, "g");
const SENTENCE_END_RE = /\.+$/;
/** A written `@key` ends where keyBody ends the path it came from; a word, `@` or path character before it makes it part of something else. */
export const KEY_TOKEN_RE = new RegExp(`(?<![\\w@./-])@[a-z0-9][a-z0-9-]*/${PATH_CHARS}`, "g");
// Every internal-unit token climbs `../../` out of the skill folder, so any `skills/<x>` reads it the same.
const ANY_SKILL_DIR = "skills/~";

export function unitId(plugin: string, version: string, unit: string): string {
  return `${plugin}@${version}:${unit}`;
}

export function skillsId(name: string): string {
  return `skills:${name}`;
}

export function openingLine(id: string): string {
  return `Pointers here are \`@keys\`. Resolve them once per run: if you already hold a \`skills_resolve\` map that covers \`${id}\`, use it; otherwise call \`skills_resolve {id: "${id}"}\` and use the path it returns for each key. If it fails, stop and say so; never look for the file another way.`;
}

function splitFrontmatter(text: string): [string, string] {
  const head = text.match(FRONTMATTER_RE)?.[0] ?? "";
  return [head, text.slice(head.length)];
}

function pluginRelative(base: string, path: string): string | null {
  const joined = posix.normalize(posix.join(base, path));
  return joined === ".." || joined.startsWith("../") ? null : joined;
}

function unitOf(path: string, units: UnitTable): { unit: string; rest: string } | null {
  let best: { unit: string; rest: string; depth: number } | null = null;
  for (const [unit, folder] of Object.entries(units)) {
    if (!path.startsWith(`${folder}/`) || path.length === folder.length + 1) continue;
    if (best && best.depth >= folder.length) continue;
    best = { unit, rest: path.slice(folder.length + 1), depth: folder.length };
  }
  return best && { unit: best.unit, rest: best.rest };
}

/**
 * Where a file is keyed from. `written` says whether the build writes a
 * plugin-relative file: `./gradlew` in prose names the reader's repo, not the
 * skill, so a relative path is a pointer only when its target is written.
 */
export type KeySite = { dir: string; fileRel: string; units: UnitTable; written: (target: string) => boolean };

export function keyBody(text: string, at: KeySite): { text: string; targets: Record<string, Target> } {
  const targets: Record<string, Target> = {};
  const tokenBase = at.dir.startsWith("skills/") ? at.dir : ANY_SKILL_DIR;
  const fileBase = posix.dirname(`${at.dir}/${at.fileRel}`);

  const toKey = (written: string, base: string, path: string, onlyWritten: boolean): string => {
    const trail = path.match(SENTENCE_END_RE)?.[0] ?? "";
    const core = path.slice(0, path.length - trail.length);
    const resolved = pluginRelative(base, core);
    const hit = resolved && unitOf(resolved, at.units);
    if (!hit || (onlyWritten && !at.written(resolved))) return written;
    targets[`${hit.unit}/${hit.rest}`] = resolved;
    return `@${hit.unit}/${hit.rest}${trail}`;
  };

  const [head, body] = splitFrontmatter(text);
  const keyed = body
    .replace(TOKEN_RE, (written, path?: string) => (path ? toKey(written, tokenBase, `.${path}`, false) : written))
    .replace(RELATIVE_RE, (written) => toKey(written, fileBase, written, true));
  return { text: head + keyed, targets };
}

/** A file name with an extension, as the last path segment. */
const FILE_NAME_RE = /(?:^|\/)[^/.][^/]*\.[A-Za-z0-9]+$/;

/** `@review/core` is an npm name when a `review` unit exists, so a key also needs the map to hold it or a file name to end it. */
export function isKey(token: string, units: UnitTable, keys: Record<string, Target> = {}): boolean {
  const match = token.match(/^@([a-z0-9][a-z0-9-]*)\/(.+)$/);
  if (!match || !Object.hasOwn(units, match[1]!)) return false;
  return Object.hasOwn(keys, token.slice(1)) || FILE_NAME_RE.test(match[2]!);
}

export function spellFrom(dir: string, target: string): string {
  if (target.startsWith(`${dir}/`)) return target.slice(dir.length + 1);
  return "../".repeat(dir.split("/").length) + target;
}

function sameTarget(a: Target, b: Target): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.skill === b.skill && a.path === b.path;
}

export function closeMap(own: PointerMap, reached: PointerMap[]): PointerMap {
  const keys: Record<string, Target> = { ...own.keys };
  const covers = [...new Set([own.id, ...own.covers])];
  for (const map of reached) {
    for (const id of [map.id, ...map.covers]) if (!covers.includes(id)) covers.push(id);
    for (const [key, target] of Object.entries(map.keys)) {
      const held = keys[key];
      if (held !== undefined && !sameTarget(held, target)) {
        throw new Error(`pointer key @${key} has two targets: ${JSON.stringify(held)} and ${JSON.stringify(target)}`);
      }
      keys[key] = target;
    }
  }
  return { id: own.id, dir: own.dir, covers, keys };
}

/** `token` is the form as written, braced or not. */
export function leftoverTokens(text: string): { line: number; col: number; token: string }[] {
  const [head] = splitFrontmatter(text);
  const found: { line: number; col: number; token: string }[] = [];
  for (const m of text.slice(head.length).matchAll(new RegExp(TOKEN_FORM, "g"))) {
    const before = text.slice(0, head.length + m.index);
    found.push({ line: before.split("\n").length, col: before.length - before.lastIndexOf("\n"), token: m[0] });
  }
  return found;
}
