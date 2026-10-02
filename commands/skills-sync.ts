/**
 * rt skills sync -- bring a pack's compiled skills and installed plugin
 * caches current: pull engine and pack checkouts, update the engine plugin,
 * recompile and recheck on drift, commit and push, update the pack plugin,
 * and flag any cswap session whose plugins symlink has drifted.
 *
 *   rt skills sync [--pack <name>] [--manifest <path>] [--repo <slug or host/path>] [--json]
 *
 * The full step chain and its refusal conditions live in lib/skills/sync.ts;
 * this file only wires real dependencies (git/claude subprocesses, checkPack,
 * compilePackAll, materializeSkills) and renders the resulting SyncReport.
 */

import { homedir } from "os";
import { join } from "path";
import { discoverPacks, packFromDir, type PackInfo } from "../lib/skills/packs.ts";
import { buildPluginRoots, type PluginListEntry } from "../lib/skills/sources.ts";
import { realpathSync } from "fs";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { syncPack, type SyncDeps, type SyncEngine, type SyncReport, type SyncStep } from "../lib/skills/sync.ts";
import { checkPack, compilePackAll } from "./skills.ts";
import { childEnv } from "../lib/subprocess.ts";
import { resolveSharedCheckout } from "../lib/release/shared-checkout.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { materializeSkills, packVerdict, type MaterializeSkillsResult } from "../lib/setup/skills-materialize.ts";

/**
 * The mattstack pack is the only valid sync engine: falling back to the pack
 * itself when no mattstack pack is discovered would silently point
 * update-engine's version compare and loadStepSource's lookups at the wrong
 * plugin, so an absent engine refuses instead of guessing. A directory
 * checkout wins; otherwise an engine installed from any other marketplace is
 * read from its installed cache, chosen as compile chooses it from `claude plugin
 * list` (the last enabled `mattstack@` entry).
 */
export function deriveEngine(packs: PackInfo[], pack: PackInfo, installed: PluginListEntry[] = []): { engine: SyncEngine } | { error: string } {
  const mattstack = packs.find((p) => p.name === "mattstack");
  if (mattstack) return { engine: mattstack };
  if (pack.name === "mattstack") return { engine: pack };
  const candidates = installed.filter((e) => e.id.startsWith("mattstack@") && e.enabled !== false);
  const root = buildPluginRoots(candidates).byName.mattstack;
  const entry = root ? candidates.findLast((e) => realDir(e.installPath) === root.dir) : undefined;
  const cached = entry ? packFromDir("mattstack", entry.installPath, entry.id.slice("mattstack@".length)) : null;
  if (cached) return { engine: { ...cached, installedCache: true, ...(entry?.scope ? { scope: entry.scope } : {}) } };
  return {
    error: `no "mattstack" engine found for "${pack.name}" (looked for a directory checkout registered via extraKnownMarketplaces in Claude's settings.json, then an installed mattstack plugin in claude plugin list); install the mattstack plugin and re-run`,
  };
}

function realDir(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** An unreadable listing reads as nothing installed, so deriveEngine refuses with its own message rather than this one's. */
async function installedPlugins(deps: SyncDeps): Promise<PluginListEntry[]> {
  if (!deps.claudeBin) return [];
  const res = await deps.run(deps.claudeBin, ["plugin", "list", "--json"]);
  if (res.code !== 0) return [];
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? (parsed as PluginListEntry[]) : [];
  } catch {
    return [];
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

export function manifestTarget(args: string[]): { manifest?: string; repo?: string } {
  const manifest = flagValue(args, "--manifest");
  const repo = flagValue(args, "--repo");
  return { ...(manifest ? { manifest } : {}), ...(repo ? { repo } : {}) };
}

export function syncMaterializeVerdict(r: MaterializeSkillsResult, pack: string): { ok: boolean; detail: string; warnings: string[] } {
  if (r.skipped) return { ok: true, detail: `nothing was written: ${r.reason}`, warnings: [] };
  const warnings = r.repos.flatMap((row) => (row.pruneWarnings ?? []).map((w) => `${row.name}: ${w}`));
  const verdict = packVerdict(r.repos, pack);
  if (verdict.failures.length > 0) return { ok: false, detail: verdict.failures.join("; "), warnings };
  const others = verdict.warnings.length > 0 ? `; these other packs did not: ${verdict.warnings.join("; ")}` : "";
  return { ok: true, detail: `wrote ${verdict.written} ${pack} bindings file${verdict.written === 1 ? "" : "s"}${others}`, warnings };
}

const STEP_TITLE: Record<string, string> = {
  guards: "Safety checks",
  "pull-engine": "Pull the engine",
  "pull-pack": "Pull the pack",
  "update-engine": "Update the installed engine",
  materialize: "Rebuild the bindings files",
  check: "Check for drift",
  bump: "Bump the pack's version",
  compile: "Recompile",
  recheck: "Check again",
  "commit-push": "Commit and push",
  "update-pack": "Update the installed pack",
  "verify-installed": "Verify the installed copy",
  "cswap-sweep": "Check each account's plugin link",
};

const STEP_STATUS: Record<SyncStep["status"], RenderStatus> = { ran: "done", skipped: "skipped", refused: "refused", failed: "failed" };

/** The command that clears a refusal, for the steps whose refusal one command clears. */
const STEP_NEXT: Record<string, (pack: string) => string> = { check: (pack) => `rt skills check --pack ${pack}` };

const stepTitle = (step: SyncStep): string => STEP_TITLE[step.name] ?? step.name;

const stops = (step: SyncStep): boolean => step.status === "refused" || step.status === "failed";

/** What a person reads on stdout: the steps up to the one that stopped the run, then a summary only when none did. */
export function syncBlocks(report: SyncReport): Block[] {
  const stop = report.steps.findIndex(stops);
  const shown = stop === -1 ? report.steps : report.steps.slice(0, stop);
  const blocks: Block[] = shown.map((step) => out.line(STEP_STATUS[step.status], stepTitle(step), step.detail));
  const { engine, pack } = report.versions;
  if (engine.before !== engine.after) blocks.push(out.kv("Engine", `${engine.before ?? "unknown"} -> ${engine.after ?? "unknown"}`));
  if (pack.installedBefore !== pack.installedAfter) blocks.push(out.kv("Installed pack", `${pack.installedBefore ?? "unknown"} -> ${pack.installedAfter ?? "unknown"}`));
  for (const warning of report.warnings) blocks.push(out.line("warn", warning));
  if (stop !== -1) return blocks;
  if (report.restartNeeded) blocks.push(out.summary("done", "Synced"), out.callout("next", ["Run ", out.cmd("/reload-plugins"), " in any Claude session that is already running"]));
  else blocks.push(out.summary("done", "Already current"));
  return blocks;
}

/**
 * lib/skills/sync.ts marks these steps `refused` only when a command they ran
 * failed (git pull, claude plugin update or marketplace update, the compile),
 * so a person reads them as failures. --json keeps the status sync gave them.
 */
const REFUSED_ON_FAILED_COMMAND: ReadonlySet<string> = new Set(["pull-engine", "pull-pack", "update-engine", "compile"]);

const isPolicyRefusal = (step: SyncStep): boolean => step.status === "refused" && !REFUSED_ON_FAILED_COMMAND.has(step.name);

const textLines = (text: string): string[] => text.split(/\r\n|\r|\n/);

/** A title is one line, so a multi-line message leads with its first line and the rest go below it. */
function plainFailure(message: string): out.FailureInput {
  const [title = "", ...rest] = textLines(message);
  return rest.length > 0 ? { title, details: rest.join("\n") } : { title };
}

/** A policy refusal, for out.note: rt declining by rule, never a failure. */
export function syncRefusal(report: SyncReport): Block[] | null {
  const refused = report.steps.find(isPolicyRefusal);
  if (!refused) return null;
  const next = STEP_NEXT[refused.name];
  return [
    out.line("refused", `rt did not sync ${report.pack}`, `it stopped at: ${stepTitle(refused)}`),
    out.callout("why", ...textLines(refused.detail)),
    ...(next ? [out.callout("next", out.cmd(next(report.pack)))] : []),
  ];
}

export function syncFailure(report: SyncReport): out.FailureInput | null {
  const failed = report.steps.find((s) => s.status === "failed" || (s.status === "refused" && !isPolicyRefusal(s)));
  if (!failed) return null;
  const [why = "", ...rest] = textLines(failed.detail);
  return { title: `The sync stopped at: ${stepTitle(failed)}`, why, ...(rest.length > 0 ? { details: rest.join("\n") } : {}) };
}

export async function skillsSync(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const packFlag = flagValue(args, "--pack");
  const target = manifestTarget(args);

  const fail = (error: string, shown?: out.FailureInput): never => {
    if (json) out.json({ ok: false, error });
    else out.fail(shown ?? plainFailure(error));
    process.exit(1);
  };

  const packs = discoverPacks();
  if (packs.length === 0) {
    fail("no packs discovered (no directory marketplace plugin carries a surface.jsonc); pass --pack <name>", {
      title: "No packs found",
      why: "A pack is a plugin from a directory marketplace that has a surface file.",
    });
  }

  const pack = packFlag ? packs.find((p) => p.name === packFlag) : packs.length === 1 ? packs[0] : undefined;
  if (!pack) {
    const names = packs.map((p) => p.name).join(", ");
    if (packFlag) fail(`no pack named "${packFlag}" (discovered: ${names})`, { title: `No pack is called ${packFlag}`, next: out.cmd("rt skills packs"), details: `Packs here: ${names}` });
    else fail(`which pack? pass --pack <name> (discovered: ${names})`, usageFailure("Which pack?", "rt skills sync --pack <name>", `There is more than one: ${names}.`));
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const deps: SyncDeps = {
    run: async (cmd, cmdArgs, opts) => {
      const proc = Bun.spawn([cmd, ...cmdArgs], { cwd: opts?.cwd, env: childEnv(), stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, stdout, stderr };
    },
    claudeBin: resolveClaudeBin(),
    checkPack: async (name) => {
      const payload = await checkPack({ pack: name, ...target });
      return { drift: payload.drift, lintHits: payload.mcpLint.length, strict: payload.strictLint };
    },
    compilePack: (name) => compilePackAll({ pack: name, ...target }),
    materialize: async (name) => syncMaterializeVerdict(await materializeSkills(createRealProbes(), {}), name),
    configDir,
    cswapSessionsDir: join(homedir(), ".claude-swap-backup", "sessions"),
    inTreeRoot: resolveSharedCheckout(homedir()),
  };

  const needsInstalled = !packs.some((p) => p.name === "mattstack") && pack!.name !== "mattstack";
  const engineResult = deriveEngine(packs, pack!, needsInstalled ? await installedPlugins(deps) : []);
  if ("error" in engineResult) {
    fail(engineResult.error, {
      title: `rt could not find the mattstack plugin that ${pack!.name} is built on`,
      why: "Install the mattstack plugin, then run this again.",
    });
    return;
  }
  const engine = engineResult.engine;

  let report: SyncReport;
  try {
    report = await syncPack(pack!, engine, deps);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  if (json) {
    out.json(report);
  } else {
    const blocks = syncBlocks(report);
    if (blocks.length > 0) out.print(...blocks);
    const refusal = syncRefusal(report);
    if (refusal) out.note(...refusal);
    const failure = syncFailure(report);
    if (failure) out.fail(failure);
  }
  if (!report.ok) process.exitCode = 1;
}
