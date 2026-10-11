import { existsSync, readdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { isDeepStrictEqual } from "util";
import { generateShims } from "../../git-hooks/shims.ts";
import { mattstackHome, reposDir } from "../../rt-paths.ts";
import { parseIdentity } from "../../settings/identity.ts";
import { onlyDefault } from "../../settings/presence.ts";
import { listSettings, type ResolveOpts } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { isValidSkillId } from "../../skills/writing-style.ts";
import type { StepOutcome } from "../apply.ts";
import type { MigrationDef } from "./index.ts";

const HOOKS_KEY = "rt.hooks";
const STYLE_KEY = "skills.writingStyle";

interface Tally {
  hooks: number;
  shims: number;
  style: boolean;
  unreadable: number;
  failed: string[];
}

/** A value the resolver refused still sits in a store, and the import must never overwrite it. */
function storeHolds(key: string, opts: ResolveOpts = {}): boolean {
  const row = listSettings(opts).find((s) => s.key === key);
  return row !== undefined && (!onlyDefault(row) || (row.invalid?.length ?? 0) > 0);
}

export function legacyHooksValue(raw: unknown): { enabled: boolean; hooks: Record<string, boolean> } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { enabled, hooks } = raw as { enabled?: unknown; hooks?: unknown };
  const entries = hooks !== null && typeof hooks === "object" && !Array.isArray(hooks) ? Object.entries(hooks) : [];
  return { enabled: enabled !== false, hooks: Object.fromEntries(entries.filter((e): e is [string, boolean] => typeof e[1] === "boolean")) };
}

export function parsePreferencesStyle(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === "## writing style");
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) return null;
    const m = /^\s*writing-style:\s*`?([^`\s]+)`?\s*$/.exec(line);
    if (m) return isValidSkillId(m[1]!) ? m[1]! : null;
  }
  return null;
}

function repoDirs(): string[] {
  return existsSync(reposDir()) ? readdirSync(reposDir()) : [];
}

type HooksImport = "imported" | "held" | "unreadable" | "failed";

/**
 * A failed run already wrote the copy before its rewrite failed, so a user
 * value that matches the file exactly counts as this migration's own copy.
 */
function ownCopy(value: unknown, opts: ResolveOpts): boolean {
  const row = listSettings(opts).find((s) => s.key === HOOKS_KEY);
  if (!row || (row.invalid?.length ?? 0) > 0) return false;
  const scopes = row.provenance.map((p) => p.scope).filter((scope) => scope !== "default");
  return scopes.length === 1 && scopes[0] === "user.repo" && isDeepStrictEqual(row.value, value);
}

function importHooksFile(repo: string, file: string, t: Tally): HooksImport {
  const opts = { repoIdentity: repo };
  let value: ReturnType<typeof legacyHooksValue>;
  try {
    value = legacyHooksValue(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    value = null;
  }
  if (storeHolds(HOOKS_KEY, opts)) {
    if (value === null || !ownCopy(value, opts)) return "held";
    t.hooks++;
    return "imported";
  }
  if (value === null) {
    t.unreadable++;
    return "unreadable";
  }
  try {
    setSetting(HOOKS_KEY, value, "user", opts);
  } catch (err) {
    t.failed.push(`${repo}: ${(err as Error).message.split("\n")[0]}`);
    return "failed";
  }
  if (!storeHolds(HOOKS_KEY, opts)) {
    t.failed.push(`${repo}: the copy did not read back`);
    return "failed";
  }
  t.hooks++;
  return "imported";
}

/** Today's shims grep hooks.json; the rewrite makes each ask rt. */
function rewriteShims(dir: string, t: Tally): boolean {
  const shimsDir = join(reposDir(), dir, "hooks");
  if (!existsSync(shimsDir)) return true;
  try {
    generateShims(join(reposDir(), dir), readdirSync(shimsDir).filter((name) => !name.startsWith(".")));
  } catch (err) {
    t.failed.push(`${dir}: ${(err as Error).message.split("\n")[0]}`);
    return false;
  }
  t.shims++;
  return true;
}

/**
 * The value goes into the store before any shim asks rt for it, and
 * hooks.json moves aside only once every shim asks rt. Only remote repos have
 * a settings section, so a path-kind or pre-identity folder has nowhere to go.
 */
function migrateFolder(dir: string, t: Tally): void {
  const identity = parseIdentity(dir);
  const file = join(reposDir(), dir, "hooks.json");
  const imported = identity?.kind === "remote" && existsSync(file) ? importHooksFile(identity.id, file, t) : null;
  if (imported === "failed" || !rewriteShims(dir, t) || imported !== "imported") return;
  try {
    renameSync(file, `${file}.imported`);
  } catch (err) {
    t.failed.push(`${dir}: ${(err as Error).message.split("\n")[0]}`);
  }
}

function importWritingStyle(t: Tally): void {
  const file = join(mattstackHome(), "user", "skills", "preferences.md");
  if (!existsSync(file) || storeHolds(STYLE_KEY)) return;
  const style = parsePreferencesStyle(readFileSync(file, "utf8"));
  if (style === null) return;
  try {
    setSetting(STYLE_KEY, style, "user");
  } catch (err) {
    t.failed.push(`writing style: ${(err as Error).message.split("\n")[0]}`);
    return;
  }
  if (!storeHolds(STYLE_KEY)) {
    t.failed.push("writing style: the copy did not read back");
    return;
  }
  t.style = true;
}

function outcome(t: Tally): StepOutcome {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (t.failed.length > 0) {
    return {
      state: "failed",
      detail: `Could not copy or update ${t.failed.length} old ${plural(t.failed.length, "file", "files")}: ${t.failed[0]}`,
      remedy: "Run rt settings check, fix what it names, then Retry",
    };
  }
  const copied = [
    t.hooks > 0 ? `your hook choices for ${t.hooks} ${plural(t.hooks, "repo", "repos")}` : null,
    t.style ? "your writing style" : null,
  ].filter((part): part is string => part !== null);
  const sentences = [
    copied.length > 0 ? `Copied ${copied.join(" and ")} into your settings` : null,
    t.shims > 0 ? `Updated rt's hook scripts in ${t.shims} ${plural(t.shims, "repo", "repos")}` : null,
  ].filter((s): s is string => s !== null);
  const unread = t.unreadable > 0 ? `${t.unreadable} old ${plural(t.unreadable, "file", "files")} could not be read, so rt left ${plural(t.unreadable, "it where it is", "them where they are")}` : null;
  if (sentences.length === 0) return { state: "skipped", detail: unread ? `There were no old settings to copy. ${unread}` : "There were no old settings to copy" };
  return { state: "done", detail: [...sentences, ...(unread ? [unread] : [])].join(". ") };
}

export const importLegacySettingsMigration: MigrationDef = {
  id: "2026-10-10-import-legacy-settings",
  title: "Copy your old hook choices and writing style into your settings",
  async run() {
    const tally: Tally = { hooks: 0, shims: 0, style: false, unreadable: 0, failed: [] };
    for (const dir of repoDirs()) migrateFolder(dir, tally);
    importWritingStyle(tally);
    return outcome(tally);
  },
};
