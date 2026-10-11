import { existsSync, readdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
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

/** Today's shims grep hooks.json; the rewrite makes each ask rt. Returns the folders whose shims could not be rewritten. */
function replaceShims(t: Tally): Set<string> {
  const stuck = new Set<string>();
  for (const dir of repoDirs()) {
    const shimsDir = join(reposDir(), dir, "hooks");
    if (!existsSync(shimsDir)) continue;
    try {
      generateShims(join(reposDir(), dir), readdirSync(shimsDir).filter((name) => !name.startsWith(".")));
      t.shims++;
    } catch (err) {
      t.failed.push(`${dir}: ${(err as Error).message.split("\n")[0]}`);
      stuck.add(dir);
    }
  }
  return stuck;
}

/** Only remote repos have a settings section, so a path-kind or pre-identity folder has nowhere to go. */
function importHooks(t: Tally, stuck: Set<string>): void {
  for (const dir of repoDirs()) {
    const identity = parseIdentity(dir);
    if (identity?.kind !== "remote" || stuck.has(dir)) continue;
    const file = join(reposDir(), dir, "hooks.json");
    const opts = { repoIdentity: identity.id };
    if (!existsSync(file) || storeHolds(HOOKS_KEY, opts)) continue;
    let value: ReturnType<typeof legacyHooksValue>;
    try {
      value = legacyHooksValue(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      value = null;
    }
    if (value === null) {
      t.unreadable++;
      continue;
    }
    try {
      setSetting(HOOKS_KEY, value, "user", opts);
    } catch (err) {
      t.failed.push(`${identity.id}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    if (!storeHolds(HOOKS_KEY, opts)) {
      t.failed.push(`${identity.id}: the copy did not read back`);
      continue;
    }
    renameSync(file, `${file}.imported`);
    t.hooks++;
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
    importHooks(tally, replaceShims(tally));
    importWritingStyle(tally);
    return outcome(tally);
  },
};
