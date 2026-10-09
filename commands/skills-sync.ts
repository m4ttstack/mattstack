/**
 * rt skills sync -- bring a pack's compiled skills and installed plugin
 * caches current: pull engine and pack checkouts, update the engine plugin,
 * recompile and recheck on drift, commit and push, update the pack plugin,
 * and flag any cswap session whose plugins symlink has drifted.
 *
 *   rt skills sync [--pack <name>] [--manifest <path>] [--repo <slug or host/path>] [--commit-pending] [--expect <signature>] [--harness <id>] [--json]
 *
 * The full step chain and its refusal conditions live in lib/skills/sync.ts;
 * this file only wires real dependencies (git subprocesses, the selected harness, checkPack,
 * compilePackAll, materializeSkills) and renders the resulting SyncReport.
 */

import { homedir } from "os";
import type { CommandContext } from "../lib/command-tree.ts";
import { join } from "path";
import { existsSync, realpathSync } from "fs";
import { otherOrgRefusal, packOrg } from "../lib/skills/pack-org.ts";
import { currentRole, mayWritePath } from "../packages/rt-client/src/settings/org-roles.ts";
import { discoverPacks, packFromDir, solePack, whichPackWhy, type PackInfo } from "../lib/skills/packs.ts";
import { buildPluginRoots, type PluginListEntry } from "../lib/skills/sources.ts";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { syncHostOf, syncPack, type SyncDeps, type SyncEngine, type SyncHost, type SyncOptions, type SyncReport, type SyncStep } from "../lib/skills/sync.ts";
import { pluginEntriesFor, selectSkillsHarness, skillsHostFor, takeHarnessFlag } from "../lib/skills/maintain-host.ts";
import { SIGNATURE_RE } from "../lib/skills/changes.ts";
import { checkPack, compilePackAll, NO_PACKS_WHY } from "./skills.ts";
import { childEnv } from "../lib/subprocess.ts";
import { resolveSharedCheckout } from "../lib/release/shared-checkout.ts";
import { readDevModeConfig } from "./settings.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { teamsDir } from "../lib/rt-paths.ts";
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
export function deriveEngine(packs: PackInfo[], pack: PackInfo, installed: PluginListEntry[] = [], harness: string = "claude"): { engine: SyncEngine } | { error: string } {
  const mattstack = packs.find((p) => p.name === "mattstack");
  if (mattstack) return { engine: mattstack };
  if (pack.name === "mattstack") return { engine: pack };
  const candidates = installed.filter((e) => e.id.startsWith("mattstack@") && e.enabled !== false);
  const root = buildPluginRoots(candidates).byName.mattstack;
  const entry = root ? candidates.findLast((e) => realDir(e.installPath) === root.dir) : undefined;
  const cached = entry ? packFromDir("mattstack", entry.installPath, entry.id.slice("mattstack@".length)) : null;
  if (cached) return { engine: { ...cached, installedCache: true, ...(entry?.scope ? { scope: entry.scope } : {}) } };
  const looked = harness === "codex"
    ? "a directory checkout registered as a local marketplace in Codex's config.toml, then an installed mattstack plugin in codex plugin list"
    : "a directory checkout registered via extraKnownMarketplaces in Claude's settings.json, then an installed mattstack plugin in claude plugin list";
  return {
    error: `no "mattstack" engine found for "${pack.name}" (looked for ${looked}); install the mattstack plugin and re-run`,
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
async function installedPlugins(host: SyncHost): Promise<PluginListEntry[]> {
  if (!host.bin) return [];
  if (host.list) {
    try {
      const rows: unknown = await host.list();
      return Array.isArray(rows) ? (rows as PluginListEntry[]) : [];
    } catch {
      return [];
    }
  }
  const listed = await host.skills.inventory();
  return listed.ok ? listed.data : [];
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

export class ExpectFlagError extends Error {}

/** Throws ExpectFlagError when --expect carries no signature: a missing one would otherwise sync with no check at all. */
export function syncOptions(args: string[]): SyncOptions {
  const options: SyncOptions = { commitPending: args.includes("--commit-pending") };
  if (!args.includes("--expect")) return options;
  const expect = flagValue(args, "--expect");
  if (expect === undefined || !SIGNATURE_RE.test(expect)) {
    throw new ExpectFlagError("--expect needs the signature that rt skills changes --json prints");
  }
  return { ...options, expect };
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
  "commit-pending": "Stage your pack edits",
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
export function syncBlocks(report: SyncReport, harness: string = "claude"): Block[] {
  const stop = report.steps.findIndex(stops);
  const shown = stop === -1 ? report.steps : report.steps.slice(0, stop);
  const blocks: Block[] = shown.map((step) => out.line(STEP_STATUS[step.status], stepTitle(step), step.detail));
  const { engine, pack } = report.versions;
  if (engine.before !== engine.after) blocks.push(out.kv("Engine", `${engine.before ?? "unknown"} -> ${engine.after ?? "unknown"}`));
  if (pack.installedBefore !== pack.installedAfter) blocks.push(out.kv("Installed pack", `${pack.installedBefore ?? "unknown"} -> ${pack.installedAfter ?? "unknown"}`));
  for (const warning of report.warnings) blocks.push(out.line("warn", warning));
  if (stop !== -1) return blocks;
  if (report.restartNeeded) {
    blocks.push(out.summary("done", "Synced"), out.callout("next", harness === "codex"
      ? "Start a new Codex session to load it"
      : ["Run ", out.cmd("/reload-plugins"), " in any Claude session that is already running"]));
  }
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

export function hostMissingBlocks(label: string): Block[] {
  return [out.line("needs-you", `${label} is not installed`, "rt installs and syncs packs through it"), out.callout("next", `Install ${label}, then run this again`)];
}

export function claudeMissingBlocks(): Block[] {
  return hostMissingBlocks("Claude Code");
}

export async function skillsSync(args: string[], _ctx: CommandContext = {}, overrides?: { packs: PackInfo[]; deps: SyncDeps }): Promise<void> {
  const json = args.includes("--json");
  const packFlag = flagValue(args, "--pack");
  const target = manifestTarget(args);

  const fail = (error: string, shown?: out.FailureInput): never => {
    if (json) out.json({ ok: false, error });
    else out.fail(shown ?? plainFailure(error));
    process.exit(1);
  };

  let options: SyncOptions = {};
  try {
    options = syncOptions(args);
  } catch (err) {
    if (!(err instanceof ExpectFlagError)) throw err;
    fail(err.message, usageFailure("Which signature?", "rt skills sync --commit-pending --expect <signature>", "Pass the signature rt skills changes --json printed for the changes you looked at."));
  }

  const flag = takeHarnessFlag(args);
  if (!flag.ok) fail("--harness needs a value", usageFailure("Which harness?", "rt skills sync --harness <claude|codex>"));
  let harness = overrides?.deps.host?.harness ?? "claude";
  if (!overrides) {
    const chosen = await selectSkillsHarness(flag.ok ? flag.harness : undefined);
    if (!chosen.ok) fail(chosen.error.message, { title: chosen.error.message });
    else harness = chosen.data;
  }

  const packs = overrides?.packs ?? discoverPacks();
  if (packs.length === 0) {
    fail("no packs discovered (no directory marketplace plugin, team folder or org folder carries a surface.jsonc); pass --pack <name>", {
      title: "No packs found",
      why: NO_PACKS_WHY,
    });
  }

  const pack = packFlag ? packs.find((p) => p.name === packFlag) : solePack(packs);
  if (!pack) {
    const names = packs.map((p) => p.name).join(", ");
    if (packFlag) fail(`no pack named "${packFlag}" (discovered: ${names})`, { title: `No pack is called ${packFlag}`, next: out.cmd("rt skills packs"), details: `Packs here: ${names}` });
    else fail(`which pack? pass --pack <name> (discovered: ${names})`, usageFailure("Which pack?", "rt skills sync --pack <name>", whichPackWhy(packs)));
  }
  const owner = packOrg(pack!.dir);
  if (owner.kind === "other") {
    const { message, why } = otherOrgRefusal(owner.org, owner.current);
    if (json) out.json({ ok: false, error: `${message}. ${why}` });
    else out.note(out.line("refused", message), out.callout("why", why));
    process.exit(2);
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const realHost = harness === "claude" ? null : skillsHostFor(harness, childEnv());
  // Read at each call: the engine's update can move what is installed between check and compile.
  const listedNow = async () => {
    const entries = realHost ? await pluginEntriesFor(realHost) : undefined;
    return entries ? { pluginEntries: entries } : {};
  };
  const deps: SyncDeps = overrides?.deps ?? {
    mayCompile: (name) => {
      const dir = packs.find(p => p.name === name)?.dir;
      if (dir === undefined) return true;
      const found = packOrg(dir);
      if (found.kind === "outside") return true;
      return found.kind === "current" && mayWritePath(currentRole(found.org), found.rel);
    },
    run: async (cmd, cmdArgs, opts) => {
      const proc = Bun.spawn([cmd, ...cmdArgs], { cwd: opts?.cwd, env: childEnv(), stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, stdout, stderr };
    },
    claudeBin: harness === "claude" ? resolveClaudeBin() : null,
    checkPack: async (name) => {
      const payload = await checkPack({ pack: name, ...target, ...(await listedNow()) });
      return { drift: payload.drift, lintHits: payload.mcpLint.length, strict: payload.strictLint };
    },
    compilePack: async (name) => compilePackAll({ pack: name, ...target, ...(await listedNow()) }),
    materialize: async (name) => syncMaterializeVerdict(await materializeSkills(createRealProbes(), {}), name),
    configDir,
    cswapSessionsDir: join(homedir(), ".claude-swap-backup", "sessions"),
    inTreeRoot: resolveSharedCheckout(homedir(), existsSync, readDevModeConfig().sourcePath ?? null),
    orgsRoot: teamsDir(),
    ...(realHost && { host: realHost }),
  };
  const host = syncHostOf(deps);

  const needsInstalled = !packs.some((p) => p.name === "mattstack") && pack!.name !== "mattstack";
  const engineResult = deriveEngine(packs, pack!, needsInstalled ? await installedPlugins(host) : [], host.harness);
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
    report = await syncPack(pack!, engine, deps, options);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  if (json) {
    out.json(report);
  } else {
    const blocks = syncBlocks(report, host.harness);
    if (blocks.length > 0) out.print(...blocks);
    const refusal = syncRefusal(report);
    if (host.bin === null && report.steps.some((step) => step.name === "guards" && step.status === "refused")) out.note(...hostMissingBlocks(host.label));
    else if (refusal) out.note(...refusal);
    const failure = syncFailure(report);
    if (failure) out.fail(failure);
  }
  if (!report.ok) process.exitCode = 1;
}
