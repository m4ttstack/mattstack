/**
 * The Claude marketplace piece of the org.folder step. Team packs install from
 * a marketplace rt generates for this Mac (`writeGeneratedMarketplace`), under
 * the org marketplace's own name, so the piece rewrites that folder first and
 * then makes every Claude config dir's registration of the name point at it.
 * A same-name `marketplace add` re-points the name and keeps every installed
 * plugin (verified against claude 2.1.296 and 2.1.316), so that is the whole
 * re-point; `marketplace remove` uninstalls every plugin that came from the
 * marketplace, so rt never runs it. Config dirs are deduped by the realpath of
 * their `plugins/` folder: cswap accounts usually share one through a symlink.
 *
 * An older rt re-pointed with remove, add and reinstall, writing a pending
 * record before the remove. A record it left behind names plugins the remove
 * already uninstalled, so this piece still finishes it: point at the generated
 * folder, reinstall each recorded user plugin that is missing and not held by
 * its engine floor, and hand a project or local one back as an install to run
 * in its project.
 */

import { realpathSync } from "fs";
import { basename, join, resolve } from "path";
import { cswapConfigDirs } from "../../cswap.ts";
import { stripJsonc } from "../../jsonc.ts";
import { resolveTool } from "../../deps/resolve.ts";
import type { ApplyContext } from "../apply.ts";
import { heldCopy, runnableEngine } from "../../engine-floor.ts";
import { isGeneratedMarketplaceFolder } from "../../rt-paths.ts";
import { orgLayoutState } from "../../team/org-layout.ts";
import { writeGeneratedMarketplace } from "../generated-marketplace.ts";
import { PACK_EXEC_TIMEOUT_MS, readServedPacks } from "../pack-cache.ts";
import { ADMIT_UNFLOORED, admit, installArgs, type Admission, type Admitted } from "../plugin-calls.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { readSetupState, updateSetupState, type PendingMarketplaceMove } from "../state.ts";
import { cloneSlugs } from "../team-settings.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import { parseMarketplaceList } from "../marketplace-list.ts";
import { claudeMessage } from "./plugins.ts";

export interface MarketplaceOutcome {
  state: "done" | "skipped" | "partial";
  detail: string;
  /** The exact claude commands to finish by hand; set only on partial. */
  commands?: string[];
  /** A sentence the org.folder row shows although the outcome is not partial. */
  note?: string;
}

type InstalledPlugin = PendingMarketplaceMove["plugins"][number];

export function marketplaceName(p: Pick<Probes, "readFile">, dir: string): string | null {
  const raw = p.readFile(join(dir, ".claude-plugin", "marketplace.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(stripJsonc(raw)) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

/** The plugin ids the marketplace folder at `dir` lists under `marketplace`, or null when its file cannot be read. */
export function catalogPluginIds(p: Pick<Probes, "readFile">, dir: string, marketplace: string): Set<string> | null {
  const raw = p.readFile(join(dir, ".claude-plugin", "marketplace.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(stripJsonc(raw)) as { plugins?: unknown };
    const entries = Array.isArray(parsed.plugins) ? (parsed.plugins as { name?: unknown }[]) : [];
    return new Set(entries.flatMap((e) => (e && typeof e.name === "string" ? [`${e.name}@${marketplace}`] : [])));
  } catch {
    return null;
  }
}

/** The plugins installed from one marketplace, with the scope, enabled state and project a reinstall must restore. */
export function parseInstalledFrom(stdout: string, marketplace: string): InstalledPlugin[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    const out: InstalledPlugin[] = [];
    for (const item of parsed as { id?: unknown; scope?: unknown; enabled?: unknown; projectPath?: unknown }[]) {
      if (typeof item?.id !== "string" || !item.id.endsWith(`@${marketplace}`)) continue;
      const scope = typeof item.scope === "string" && item.scope.length > 0 ? item.scope : "user";
      const projectPath = typeof item.projectPath === "string" && item.projectPath.length > 0 ? item.projectPath : null;
      out.push({ id: item.id, scope, enabled: item.enabled === true, ...(projectPath !== null && scope !== "user" ? { projectPath } : {}) });
    }
    return out;
  } catch {
    return null;
  }
}

/** Claude may store the path it was given or its realpath (macOS tmp folders differ); both sides realpath when they exist. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function samePath(a: string, b: string): boolean {
  return real(a) === real(b);
}

/** One config dir per distinct `plugins/` folder, keeping the first (the default dir leads). */
function distinctConfigDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = real(join(dir, "plugins"));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `rt uninstall` finds the registration by the source setup-state recorded, so every older spelling follows it to the generated folder. */
function rewriteMarketplaces(ctx: ApplyContext, stale: string[], current: string): void {
  if (stale.length === 0) return;
  updateSetupState(ctx.p, (s) => ({ ...s, marketplaces: [...new Set(s.marketplaces.map((m) => (stale.some((old) => samePath(old, m)) ? current : m)))] }));
}

export function pendingFor(ctx: ApplyContext, marketplace: string, configDir: string): PendingMarketplaceMove | null {
  return (readSetupState(ctx.p).orgMarketplaceMoves ?? []).find((m) => m.marketplace === marketplace && m.configDir === configDir) ?? null;
}

export function setPending(ctx: ApplyContext, record: PendingMarketplaceMove | null, marketplace: string, configDir: string): void {
  updateSetupState(ctx.p, (s) => {
    const others = (s.orgMarketplaceMoves ?? []).filter((m) => !(m.marketplace === marketplace && m.configDir === configDir));
    const next = record ? [...others, record] : others;
    const { orgMarketplaceMoves: _dropped, ...rest } = s;
    return next.length ? { ...rest, orgMarketplaceMoves: next } : rest;
  });
}

interface Planned {
  argv: string[];
  command: string;
}

const step = (prefix: string, argv: string[]): Planned => ({ argv, command: `${prefix}claude ${argv.join(" ")}` });
type Grant = (pl: InstalledPlugin) => Admitted;
const add = (prefix: string, dir: string): Planned => step(prefix, ["plugin", "marketplace", "add", dir]);
const install = (prefix: string, pl: InstalledPlugin, grant: Grant): Planned => step(prefix, installArgs(grant(pl), pl.id, ["--scope", pl.scope]));
const disable = (prefix: string, pl: InstalledPlugin): Planned => step(prefix, ["plugin", "disable", pl.id]);

/** A project or local install is bound to the project claude runs in, and rt runs from no particular project, so only user installs are rt's to redo. */
const userScoped = (pl: InstalledPlugin): boolean => pl.scope === "user";

/**
 * A project or local plugin's on or off lives in that project's own settings, which a marketplace remove leaves alone, so
 * the hand-back is only the install, run from inside the project when claude named it.
 */
const handBackInstall = (prefix: string, pl: InstalledPlugin, grant: Grant): string => `${pl.projectPath ? `cd ${pl.projectPath} && ` : ""}${install(prefix, pl, grant).command}`;

/** Reinstall each plugin, then turn off the ones that were off: an install turns a plugin on. */
function reinstall(prefix: string, plugins: InstalledPlugin[], grant: Grant): Planned[] {
  return [...plugins.map((pl) => install(prefix, pl, grant)), ...plugins.filter((pl) => !pl.enabled).map((pl) => disable(prefix, pl))];
}

function handBack(prefix: string, plugins: InstalledPlugin[], grant: Grant): string[] {
  return plugins.map((pl) => handBackInstall(prefix, pl, grant));
}

const pluralPlugins = (n: number): string => `${n} plugin${n === 1 ? "" : "s"}`;

/** A folder another org's slug names is that org's own generated marketplace, never a leftover. */
function isLeftoverGeneratedFolder(ctx: ApplyContext, path: string, target: string): boolean {
  if (samePath(path, target)) return false;
  if (!isGeneratedMarketplaceFolder(ctx.p.home, path) && !isGeneratedMarketplaceFolder(real(ctx.p.home), real(path))) return false;
  return !cloneSlugs(ctx.p).includes(basename(path));
}

export async function convergeMarketplace(ctx: ApplyContext, clone: { dir: string; stalePaths: string[] }): Promise<MarketplaceOutcome> {
  const org = basename(clone.dir);
  // The org.layout row already explains a waiting clone, so this piece stays quiet on the org.folder row.
  const layout = orgLayoutState(ctx.p);
  if (layout.kind === "waiting" && layout.slug === org) return { state: "skipped", detail: `the ${org} org is on a layout this rt does not read, so Claude's registration was left as it is` };
  const generated = await writeGeneratedMarketplace(ctx.p, org);
  const target = generated.path;
  const name = generated.skipped === undefined ? marketplaceName(ctx.p, target) : null;
  if (generated.missing) return { state: "skipped", detail: `the ${org} org serves no team packs` };
  if (name === null) {
    const why = `rt could not write this Mac's copy of the ${org} marketplace (${generated.skipped ?? `${target} has no marketplace name`}), so Claude's registration was left as it is`;
    return { state: "skipped", detail: why, note: why };
  }
  for (const dropped of generated.dropped) ctx.log("org.folder", `generated marketplace left out ${dropped}`);
  const catalog = catalogPluginIds(ctx.p, target, name);
  const configDirs = distinctConfigDirs(claudeConfigDirs(ctx.p, cswapConfigDirs(ctx.p)));
  const defaultDir = configDirs[0]!;
  const prefixFor = (dir: string): string => (dir === defaultDir && ctx.p.env.CLAUDE_CONFIG_DIR === undefined ? "" : `CLAUDE_CONFIG_DIR=${dir} `);

  const claude = resolveTool(ctx.p, "claude");
  if (!claude.exec) {
    if (clone.stalePaths.length === 0) return { state: "skipped", detail: "Claude Code is not installed, so there is no marketplace to re-point" };
    return { state: "partial", detail: `Claude Code is not installed, so the ${name} marketplace may still point at the old folder. Install Claude Code and run the update again.` };
  }

  const engine = ctx.engine ? ctx.engine() : runnableEngine();
  const served = (await readServedPacks(ctx.p, basename(clone.dir))).packs;
  const admissionFor = (pl: InstalledPlugin): Admission => {
    const pack = served.find((x) => x.id === pl.id);
    return pack ? admit(pack.floor, engine) : ADMIT_UNFLOORED;
  };
  /** Only reached for a plugin that is not held, so a refusal here is a bug in the held check. */
  const grant: Grant = (pl) => {
    const a = admissionFor(pl);
    if (!a.ok) throw new Error(`${pl.id} needs engine ${a.floor} and was not held`);
    return a;
  };
  const isHeld = (pl: InstalledPlugin): boolean => !admissionFor(pl).ok;
  const heldCopies = (plugins: InstalledPlugin[]): string[] =>
    plugins.flatMap((pl) => {
      const a = admissionFor(pl);
      const pack = served.find((x) => x.id === pl.id);
      return !a.ok && pack ? [heldCopy(pack.name, pack.servedVersion, a.floor)] : [];
    });

  const notes: string[] = [];
  const heldNotes: string[] = [];
  const handedBack: string[] = [];
  const handedBackIds: string[] = [];
  /** Every source setup-state may still record for this marketplace; they follow it once one config dir points at the generated folder. */
  const stale = [clone.dir, ...clone.stalePaths];
  /** Generated folders a registration of this name pointed at, such as an org's folder from before a rename; deleted once every config dir points away. */
  const leftovers: string[] = [];
  const uncatalogued: string[] = [];
  let pointed = false;
  let sawMarketplace = false;
  const settleRecords = (): void => {
    if (pointed) rewriteMarketplaces(ctx, stale, target);
  };
  for (const dir of configDirs) {
    const prefix = prefixFor(dir);
    const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    const listed = await run(["plugin", "marketplace", "list", "--json"]);
    const known = listed.code === 0 ? parseMarketplaceList(listed.stdout) : null;
    if (known === null) {
      settleRecords();
      return { state: "partial", detail: `Claude Code's marketplace list could not be read (${claudeMessage(listed, `exited ${listed.code}`)}). Running the update again retries.` };
    }
    const registered = known.find((m) => m.name === name) ?? null;
    const current = registered !== null && registered.source !== null && samePath(registered.source, target);
    if (registered?.source && !current) {
      stale.push(registered.source);
      if (isLeftoverGeneratedFolder(ctx, registered.source, target) && !leftovers.includes(registered.source)) leftovers.push(registered.source);
    }
    let pending = pendingFor(ctx, name, dir);
    // A plugin the catalog no longer lists (its team retired) can never be reinstalled, so the record lets it go.
    const gone = pending && catalog ? pending.plugins.filter((pl) => !catalog.has(pl.id)) : [];
    if (pending && gone.length > 0) {
      for (const pl of gone) if (!uncatalogued.includes(pl.id)) uncatalogued.push(pl.id);
      const listed = pending.plugins.filter((pl) => catalog!.has(pl.id));
      pending = listed.length > 0 ? { ...pending, plugins: listed } : null;
      setPending(ctx, pending, name, dir);
    }

    let steps: Planned[];
    let handOff: InstalledPlugin[] = [];
    let handOffCommands: string[] = [];
    let done: string;
    let held: string[] = [];
    // The plugins a pending record must still carry once this run's commands succeed; null clears the record.
    let stillHeld: InstalledPlugin[] | null = null;
    if (pending) {
      sawMarketplace = true;
      const fit = pending.plugins.filter((pl) => !isHeld(pl));
      held = heldCopies(pending.plugins);
      stillHeld = pending.plugins.filter(isHeld);
      const repoint = current ? [] : [add(prefix, target)];
      if (registered === null) {
        // The older run stopped after its remove, so every recorded plugin is gone.
        const user = fit.filter(userScoped);
        handOff = fit.filter((pl) => !userScoped(pl));
        steps = [...repoint, ...reinstall(prefix, user, grant)];
        done = `${name} re-pointed at ${target} in ${dir}, ${pluralPlugins(user.length)} reinstalled`;
      } else {
        // The older run stopped part way through its remove, or after its add: reinstall what the record names and is still missing.
        const list = await run(["plugin", "list", "--json"]);
        const installed = list.code === 0 ? parseInstalledFrom(list.stdout, name) : null;
        if (installed === null) {
          settleRecords();
          return {
            state: "partial",
            detail: `Claude Code's plugin list could not be read (${claudeMessage(list, `exited ${list.code}`)}), so the ${name} plugins were not reinstalled. Running the update again retries.`,
            commands: [...handedBack, ...[...repoint, ...reinstall(prefix, fit.filter(userScoped), grant)].map((s) => s.command), ...handBack(prefix, fit.filter((pl) => !userScoped(pl)), grant)],
          };
        }
        const present = new Map(installed.map((pl) => [pl.id, pl]));
        const missing = (pl: InstalledPlugin): boolean => !present.has(pl.id);
        const stillOn = (pl: InstalledPlugin): boolean => !pl.enabled && (present.get(pl.id)?.enabled ?? true);
        const user = fit.filter(userScoped);
        const toInstall = user.filter(missing);
        steps = [...repoint, ...toInstall.map((pl) => install(prefix, pl, grant)), ...user.filter(stillOn).map((pl) => disable(prefix, pl))];
        handOff = fit.filter((pl) => !userScoped(pl) && missing(pl));
        done = `finished reinstalling ${pluralPlugins(toInstall.length)} from ${name} in ${dir}`;
      }
      handOffCommands = handBack(prefix, handOff, grant);
    } else if (registered === null) {
      notes.push(`${name} is not registered in ${dir}`);
      continue;
    } else if (current) {
      sawMarketplace = pointed = true;
      notes.push(`${name} already points at ${target} in ${dir}`);
      continue;
    } else {
      sawMarketplace = true;
      steps = [add(prefix, target)];
      done = `${name} re-pointed at ${target} in ${dir}`;
    }

    if (current) pointed = true;
    for (let i = 0; i < steps.length; i++) {
      const res = await run(steps[i]!.argv);
      if (res.code === 0) {
        if (steps[i]!.argv[1] === "marketplace") pointed = true;
        continue;
      }
      settleRecords();
      return {
        state: "partial",
        detail: `re-pointing the ${name} marketplace stopped at claude ${steps[i]!.argv.join(" ")}: ${claudeMessage(res, `exited ${res.code}`)}`,
        commands: [...handedBack, ...steps.slice(i).map((s) => s.command), ...handOffCommands],
      };
    }
    heldNotes.push(...held.filter((h) => !heldNotes.includes(h)));
    // Cleared once every command rt runs exited 0, except for held plugins: the record is the only note of what the older run removed, for the update that can reinstall them.
    if (stillHeld === null || stillHeld.length === 0) setPending(ctx, null, name, dir);
    else setPending(ctx, { marketplace: name, dir: target, configDir: dir, plugins: stillHeld }, name, dir);
    notes.push(done);
    handedBack.push(...handOffCommands);
    handedBackIds.push(...handOff.map((pl) => pl.id).filter((id) => !handedBackIds.includes(id)));
  }
  settleRecords();
  for (const leftover of leftovers) {
    ctx.p.removeDir(leftover);
    ctx.log("org.folder", `removed ${leftover}, which no Claude config folder points at any more`);
  }
  if (uncatalogued.length > 0) notes.push(`${uncatalogued.join(", ")} ${uncatalogued.length === 1 ? "is" : "are"} not in the ${name} marketplace any more, so rt cannot reinstall ${uncatalogued.length === 1 ? "it" : "them"}`);
  if (handedBack.length > 0) notes.push(`${handedBackIds.join(", ")} must be reinstalled from the project that used ${handedBackIds.length === 1 ? "it" : "them"}`);
  if (heldNotes.length > 0) {
    const detail = [...heldNotes, ...(notes.length > 0 ? [`${notes.join("; ")}.`] : []), "The held plugins wait for the app to update."].join(" ");
    return { state: "partial", detail, ...(handedBack.length > 0 ? { commands: handedBack } : {}) };
  }
  if (handedBack.length > 0) return { state: "partial", detail: notes.join("; "), commands: handedBack };
  return { state: sawMarketplace ? "done" : "skipped", detail: notes.join("; ") };
}
