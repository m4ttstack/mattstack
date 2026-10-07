/**
 * The Claude marketplace piece of the org.folder step. `claude plugin
 * marketplace remove` uninstalls every plugin that came from the marketplace
 * (verified against claude 2.1.292), so re-pointing a moved clone is remove,
 * add, reinstall each user plugin, then disable the ones that were off; a
 * project or local plugin is handed back as an install to run in its project.
 * A pending record in setup-state is written before the remove, so a run that
 * stops between remove and add is finished by the next one.
 */

import { realpathSync } from "fs";
import { join, resolve } from "path";
import { stripJsonc } from "../../jsonc.ts";
import { resolveTool } from "../../deps/resolve.ts";
import type { ApplyContext } from "../apply.ts";
import { PACK_EXEC_TIMEOUT_MS } from "../pack-cache.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { readSetupState, updateSetupState, type PendingMarketplaceMove } from "../state.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import { claudeMessage, parseMarketplaceList } from "./plugins.ts";

export interface MarketplaceOutcome {
  state: "done" | "skipped" | "partial";
  detail: string;
  /** The exact claude commands to finish by hand; set only on partial. */
  commands?: string[];
}

type InstalledPlugin = PendingMarketplaceMove["plugins"][number];

export function marketplaceName(p: Pick<Probes, "readFile">, cloneDir: string): string | null {
  const raw = p.readFile(join(cloneDir, ".claude-plugin", "marketplace.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(stripJsonc(raw)) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
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
function samePath(a: string, b: string): boolean {
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(a) === real(b);
}

function rewriteMarketplaces(ctx: ApplyContext, stale: string[], current: string): void {
  if (stale.length === 0) return;
  updateSetupState(ctx.p, (s) => ({ ...s, marketplaces: s.marketplaces.map((m) => (stale.some((old) => samePath(old, m)) ? current : m)) }));
}

function pendingFor(ctx: ApplyContext, marketplace: string, configDir: string): PendingMarketplaceMove | null {
  return (readSetupState(ctx.p).orgMarketplaceMoves ?? []).find((m) => m.marketplace === marketplace && m.configDir === configDir) ?? null;
}

function setPending(ctx: ApplyContext, record: PendingMarketplaceMove | null, marketplace: string, configDir: string): void {
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
const install = (prefix: string, pl: InstalledPlugin): Planned => step(prefix, ["plugin", "install", pl.id, "--scope", pl.scope]);
const disable = (prefix: string, pl: InstalledPlugin): Planned => step(prefix, ["plugin", "disable", pl.id]);

/** A project or local install is bound to the project claude runs in, and rt runs from no particular project, so only user installs are rt's to redo. */
const userScoped = (pl: InstalledPlugin): boolean => pl.scope === "user";

/**
 * A project or local plugin's on or off lives in that project's own settings, which a marketplace remove leaves alone, so
 * the hand-back is only the install, run from inside the project when claude named it.
 */
const handBackInstall = (prefix: string, pl: InstalledPlugin): string => `${pl.projectPath ? `cd ${pl.projectPath} && ` : ""}${install(prefix, pl).command}`;

function plan(prefix: string, name: string, dir: string, plugins: InstalledPlugin[], opts: { remove: boolean }): Planned[] {
  return [
    ...(opts.remove ? [step(prefix, ["plugin", "marketplace", "remove", name])] : []),
    step(prefix, ["plugin", "marketplace", "add", dir]),
    ...plugins.map((pl) => install(prefix, pl)),
    ...plugins.filter((pl) => !pl.enabled).map((pl) => disable(prefix, pl)),
  ];
}

function handBack(prefix: string, plugins: InstalledPlugin[]): string[] {
  return plugins.map((pl) => handBackInstall(prefix, pl));
}

const pluralPlugins = (n: number): string => `${n} plugin${n === 1 ? "" : "s"}`;

export async function convergeMarketplace(ctx: ApplyContext, clone: { dir: string; stalePaths: string[] }): Promise<MarketplaceOutcome> {
  const name = marketplaceName(ctx.p, clone.dir);
  if (name === null) return { state: "skipped", detail: "the clone declares no Claude marketplace" };
  const configDirs = claudeConfigDirs(ctx.p, []);
  const defaultDir = configDirs[0]!;
  const prefixFor = (dir: string): string => (dir === defaultDir && ctx.p.env.CLAUDE_CONFIG_DIR === undefined ? "" : `CLAUDE_CONFIG_DIR=${dir} `);

  const claude = resolveTool(ctx.p, "claude");
  if (!claude.exec) {
    if (clone.stalePaths.length === 0) return { state: "skipped", detail: "Claude Code is not installed, so there is no marketplace to re-point" };
    rewriteMarketplaces(ctx, clone.stalePaths, clone.dir);
    return { state: "partial", detail: `Claude Code is not installed, so the ${name} marketplace may still point at the old folder. Install Claude Code and run the update again.` };
  }

  const notes: string[] = [];
  const handedBack: string[] = [];
  const handedBackIds: string[] = [];
  let sawMarketplace = false;
  for (const dir of configDirs) {
    const prefix = prefixFor(dir);
    const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    const listed = await run(["plugin", "marketplace", "list", "--json"]);
    const known = listed.code === 0 ? parseMarketplaceList(listed.stdout) : null;
    if (known === null) {
      return { state: "partial", detail: `Claude Code's marketplace list could not be read (${claudeMessage(listed, `exited ${listed.code}`)}). Running the update again retries.` };
    }
    const registered = known.find((m) => m.name === name) ?? null;
    const atClone = registered !== null && registered.source !== null && samePath(registered.source, clone.dir);
    const pending = pendingFor(ctx, name, dir);

    let steps: Planned[];
    let handOff: InstalledPlugin[];
    let handOffCommands: string[];
    let done: string;
    let stale: string[] = [];
    if (pending && registered === null) {
      // A run stopped after the remove: finish from what it recorded.
      sawMarketplace = true;
      const user = pending.plugins.filter(userScoped);
      handOff = pending.plugins.filter((pl) => !userScoped(pl));
      handOffCommands = handBack(prefix, handOff);
      steps = plan(prefix, name, clone.dir, user, { remove: false });
      done = `${name} re-pointed in ${dir}, ${pluralPlugins(user.length)} reinstalled`;
    } else if (pending && atClone) {
      // A run stopped after the add: the marketplace is back, the plugins may not be. Reinstall what the record names and is still missing.
      sawMarketplace = true;
      const list = await run(["plugin", "list", "--json"]);
      const installed = list.code === 0 ? parseInstalledFrom(list.stdout, name) : null;
      if (installed === null) {
        return {
          state: "partial",
          detail: `Claude Code's plugin list could not be read (${claudeMessage(list, `exited ${list.code}`)}), so the ${name} plugins were not reinstalled. Running the update again retries.`,
          commands: [...handedBack, ...plan(prefix, name, clone.dir, pending.plugins.filter(userScoped), { remove: false }).slice(1).map((s) => s.command), ...handBack(prefix, pending.plugins.filter((pl) => !userScoped(pl)))],
        };
      }
      const present = new Map(installed.map((pl) => [pl.id, pl]));
      const missing = (pl: InstalledPlugin): boolean => !present.has(pl.id);
      const stillOn = (pl: InstalledPlugin): boolean => !pl.enabled && (present.get(pl.id)?.enabled ?? true);
      const user = pending.plugins.filter(userScoped);
      const toInstall = user.filter(missing);
      steps = [...toInstall.map((pl) => install(prefix, pl)), ...user.filter(stillOn).map((pl) => disable(prefix, pl))];
      handOff = pending.plugins.filter((pl) => !userScoped(pl) && missing(pl));
      handOffCommands = handBack(prefix, handOff);
      done = `finished reinstalling ${pluralPlugins(toInstall.length)} from ${name} in ${dir}`;
    } else if (registered === null) {
      notes.push(`${name} is not registered in ${dir}`);
      continue;
    } else if (atClone) {
      sawMarketplace = true;
      notes.push(`${name} already points at the clone in ${dir}`);
      continue;
    } else {
      sawMarketplace = true;
      const list = await run(["plugin", "list", "--json"]);
      const installed = list.code === 0 ? parseInstalledFrom(list.stdout, name) : null;
      if (installed === null) {
        return { state: "partial", detail: `Claude Code's plugin list could not be read (${claudeMessage(list, `exited ${list.code}`)}), so the ${name} marketplace was not re-pointed. Running the update again retries.` };
      }
      // A remove that failed part way leaves the old registration with some plugins already gone; the earlier record still names them.
      const carried = (pending?.plugins ?? []).filter((pl) => !installed.some((i) => i.id === pl.id));
      const plugins = [...installed, ...carried];
      const user = plugins.filter(userScoped);
      handOff = plugins.filter((pl) => !userScoped(pl));
      handOffCommands = handBack(prefix, handOff);
      stale = registered.source !== null ? [registered.source] : [];
      setPending(ctx, { marketplace: name, dir: clone.dir, configDir: dir, plugins }, name, dir);
      steps = plan(prefix, name, clone.dir, user, { remove: true });
      done = `${name} re-pointed in ${dir}, ${pluralPlugins(user.length)} reinstalled`;
    }

    for (let i = 0; i < steps.length; i++) {
      const res = await run(steps[i]!.argv);
      if (res.code === 0) continue;
      rewriteMarketplaces(ctx, [...clone.stalePaths, ...stale], clone.dir);
      return {
        state: "partial",
        detail: `re-pointing the ${name} marketplace stopped at claude ${steps[i]!.argv.join(" ")}: ${claudeMessage(res, `exited ${res.code}`)}`,
        commands: [...handedBack, ...steps.slice(i).map((s) => s.command), ...handOffCommands],
      };
    }
    // Cleared once every command rt runs exited 0; the handed-back installs are the person's to run.
    setPending(ctx, null, name, dir);
    rewriteMarketplaces(ctx, [...clone.stalePaths, ...stale], clone.dir);
    notes.push(done);
    handedBack.push(...handOffCommands);
    handedBackIds.push(...handOff.map((pl) => pl.id).filter((id) => !handedBackIds.includes(id)));
  }
  rewriteMarketplaces(ctx, clone.stalePaths, clone.dir);
  if (handedBack.length > 0) {
    notes.push(`${handedBackIds.join(", ")} must be reinstalled from the project that used ${handedBackIds.length === 1 ? "it" : "them"}`);
    return { state: "partial", detail: notes.join("; "), commands: handedBack };
  }
  return { state: sawMarketplace ? "done" : "skipped", detail: notes.join("; ") };
}
