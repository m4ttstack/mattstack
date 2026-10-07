/**
 * The Claude marketplace piece of the org.folder step. `claude plugin
 * marketplace remove` uninstalls every plugin that came from the marketplace
 * (verified against claude 2.1.292), so re-pointing a moved clone is remove,
 * add, reinstall each plugin at its scope, then disable the ones that were off.
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

/** The plugins installed from one marketplace, with the scope and enabled state a reinstall must restore. */
export function parseInstalledFrom(stdout: string, marketplace: string): InstalledPlugin[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    const out: InstalledPlugin[] = [];
    for (const item of parsed as { id?: unknown; scope?: unknown; enabled?: unknown }[]) {
      if (typeof item?.id !== "string" || !item.id.endsWith(`@${marketplace}`)) continue;
      out.push({ id: item.id, scope: typeof item.scope === "string" && item.scope.length > 0 ? item.scope : "user", enabled: item.enabled === true });
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

function plan(prefix: string, name: string, dir: string, plugins: InstalledPlugin[], opts: { remove: boolean }): Planned[] {
  return [
    ...(opts.remove ? [step(prefix, ["plugin", "marketplace", "remove", name])] : []),
    step(prefix, ["plugin", "marketplace", "add", dir]),
    ...plugins.map((pl) => step(prefix, ["plugin", "install", pl.id, "--scope", pl.scope])),
    ...plugins.filter((pl) => !pl.enabled).map((pl) => step(prefix, ["plugin", "disable", pl.id])),
  ];
}

export async function convergeMarketplace(ctx: ApplyContext, clone: { dir: string; stalePaths: string[] }): Promise<MarketplaceOutcome> {
  const name = marketplaceName(ctx.p, clone.dir);
  if (name === null) return { state: "skipped", detail: "the clone declares no Claude marketplace" };
  const configDirs = claudeConfigDirs(ctx.p, []);
  const defaultDir = configDirs[0]!;
  const prefixFor = (dir: string): string => (dir === defaultDir && ctx.p.env.CLAUDE_CONFIG_DIR === undefined ? "" : `CLAUDE_CONFIG_DIR=${dir} `);

  const claude = resolveTool(ctx.p, "claude");
  if (!claude.exec) {
    rewriteMarketplaces(ctx, clone.stalePaths, clone.dir);
    return {
      state: "partial",
      detail: `Claude Code is not installed, so the ${name} marketplace still points at the old folder`,
      commands: plan(prefixFor(defaultDir), name, clone.dir, [], { remove: true }).map((s) => s.command),
    };
  }

  const notes: string[] = [];
  let touched = false;
  for (const dir of configDirs) {
    const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    const listed = await run(["plugin", "marketplace", "list", "--json"]);
    const known = listed.code === 0 ? parseMarketplaceList(listed.stdout) : null;
    if (known === null) {
      return { state: "partial", detail: `Claude Code's marketplace list could not be read: ${claudeMessage(listed, `exited ${listed.code}`)}`, commands: plan(prefixFor(dir), name, clone.dir, [], { remove: true }).map((s) => s.command) };
    }
    const registered = known.find((m) => m.name === name) ?? null;
    const atClone = registered !== null && registered.source !== null && samePath(registered.source, clone.dir);
    const pending = pendingFor(ctx, name, dir);

    let steps: Planned[];
    let plugins: InstalledPlugin[];
    let stale: string[] = [];
    if (pending && registered === null) {
      // A run stopped after the remove: finish from what it recorded.
      plugins = pending.plugins;
      steps = plan(prefixFor(dir), name, clone.dir, plugins, { remove: false });
    } else if (pending && atClone) {
      // A run stopped after the add: the marketplace is back, the plugins may not be. Reinstall what the record names and is still missing.
      const list = await run(["plugin", "list", "--json"]);
      const installed = list.code === 0 ? parseInstalledFrom(list.stdout, name) : null;
      if (installed === null) {
        return { state: "partial", detail: `Claude Code's plugin list could not be read: ${claudeMessage(list, `exited ${list.code}`)}`, commands: plan(prefixFor(dir), name, clone.dir, pending.plugins, { remove: false }).slice(1).map((s) => s.command) };
      }
      const present = new Map(installed.map((pl) => [pl.id, pl]));
      plugins = pending.plugins;
      steps = [
        ...plugins.filter((pl) => !present.has(pl.id)).map((pl) => step(prefixFor(dir), ["plugin", "install", pl.id, "--scope", pl.scope])),
        ...plugins.filter((pl) => !pl.enabled && (present.get(pl.id)?.enabled ?? true)).map((pl) => step(prefixFor(dir), ["plugin", "disable", pl.id])),
      ];
    } else if (registered === null) {
      notes.push(`${name} is not registered in ${dir}`);
      continue;
    } else if (atClone) {
      notes.push(`${name} already points at the clone`);
      continue;
    } else {
      const list = await run(["plugin", "list", "--json"]);
      const installed = list.code === 0 ? parseInstalledFrom(list.stdout, name) : null;
      if (installed === null) {
        return { state: "partial", detail: `Claude Code's plugin list could not be read: ${claudeMessage(list, `exited ${list.code}`)}`, commands: plan(prefixFor(dir), name, clone.dir, [], { remove: true }).map((s) => s.command) };
      }
      // A remove that failed part way leaves the old registration with some plugins already gone; the earlier record still names them.
      const carried = (pending?.plugins ?? []).filter((pl) => !installed.some((i) => i.id === pl.id));
      plugins = [...installed, ...carried];
      stale = registered.source !== null ? [registered.source] : [];
      setPending(ctx, { marketplace: name, dir: clone.dir, configDir: dir, plugins }, name, dir);
      steps = plan(prefixFor(dir), name, clone.dir, plugins, { remove: true });
    }

    for (let i = 0; i < steps.length; i++) {
      const res = await run(steps[i]!.argv);
      if (res.code === 0) continue;
      rewriteMarketplaces(ctx, [...clone.stalePaths, ...stale], clone.dir);
      return {
        state: "partial",
        detail: `re-pointing the ${name} marketplace stopped at claude ${steps[i]!.argv.join(" ")}: ${claudeMessage(res, `exited ${res.code}`)}`,
        commands: steps.slice(i).map((s) => s.command),
      };
    }
    // Cleared only here, after every command exited 0.
    setPending(ctx, null, name, dir);
    rewriteMarketplaces(ctx, [...clone.stalePaths, ...stale], clone.dir);
    touched = true;
    notes.push(`${name} re-pointed in ${dir}${plugins.length ? `, ${plugins.length} plugin${plugins.length === 1 ? "" : "s"} reinstalled` : ""}`);
  }
  rewriteMarketplaces(ctx, clone.stalePaths, clone.dir);
  const skipped = !touched && notes.every((n) => n.includes("not registered"));
  return { state: skipped ? "skipped" : "done", detail: notes.join("; ") };
}
