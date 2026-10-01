/**
 * rt skills init [--repo <path>] [--zone <slug>] [--json]
 *
 * Scaffolds a zero-fill team pack named after its zone's namespace (roster
 * `work` only, every domain slot unbound), declares the repo in the zone,
 * materializes, compiles, checks, and installs the pack plugin on this
 * machine. Never commits; never writes into an existing pack directory.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { updateRepoIndexAsync } from "../lib/repo-index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { envelope } from "../lib/setup/contract.ts";
import { failureFor, logFailureDetail, UserActionableError, userErrorPayload } from "../lib/errors.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { materializeSkills, packVerdict, type MaterializeSkillsResult } from "../lib/setup/skills-materialize.ts";
import { createTeam } from "../lib/team/create.ts";
import { initPack, POLICY_REFUSALS, type InitDeps, type InitOutcome, type InitRemedy } from "../lib/skills/init.ts";
import { loadStepSource, resolvePluginRoots } from "../lib/skills/sources.ts";
import { textInput } from "../lib/ui/prompts.ts";
import * as ui from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import { checkPack, compilePackAll } from "./skills.ts";
import { childEnv } from "../lib/subprocess.ts";

export type InitArgs = { repo: string; zone: string | null; json: boolean };

export function parseInitArgs(args: string[]): InitArgs {
  const out: InitArgs = { repo: process.cwd(), zone: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (flag: string): string => {
      const v = args[++i];
      if (!v || v.startsWith("--")) throw new UserActionableError("usage", `${flag} needs a value`);
      return v;
    };
    switch (a) {
      case "--repo": out.repo = resolve(value(a)); break;
      case "--zone": out.zone = value(a); break;
      case "--json": out.json = true; break;
      default: throw new UserActionableError("usage", `unrecognized argument "${a}"`);
    }
  }
  return out;
}

export function initOutcomeBlocks(o: Extract<InitOutcome, { ok: true }>): Block[] {
  return [
    ui.line("done", `Created the ${o.pack.name} pack`, o.pack.dir),
    ui.kv("Zone", o.pack.zone),
    ui.kv("Marketplace", o.pack.marketplace),
    ui.kv("Installed", `${o.installed.plugin} ${o.installed.version}`),
    ui.kv("Repo bindings", o.repo.manifest),
    ui.callout("next", ["Run ", ui.cmd("/reload-plugins"), " in your Claude session, then try ", ui.cmd(o.tryNext)]),
  ];
}

export function initRefusalBlocks(o: Extract<InitOutcome, { ok: false; refused: true }>): Block[] {
  return [ui.line("refused", o.detail), ...(o.next ? [ui.callout("next", ui.cmd(o.next))] : [])];
}

function remedyCell(r: InitRemedy): Array<string | Segment> {
  const commands = r.commands.flatMap((c, i) => (i === 0 ? [ui.cmd(c)] : [", then ", ui.cmd(c)]));
  return [r.folder ? "Delete the pack folder it started, then run " : "Run ", ...commands];
}

export function initFailure(o: Extract<InitOutcome, { ok: false }>): ui.FailureInput {
  if (o.refused) return { title: o.detail, ...(o.next ? { next: ui.cmd(o.next) } : {}) };
  const [title = o.detail, ...rest] = o.detail.split("\n");
  const details = [...rest, ...(o.remedy?.folder ? [`Pack folder: ${o.remedy.folder}`] : []), ...(o.wrote.length > 0 ? ["Written so far:", ...o.wrote] : [])];
  return {
    title,
    next: o.remedy ? remedyCell(o.remedy) : ["Fix it, then run ", ui.cmd("rt skills compile"), " and ", ui.cmd("rt skills check")],
    ...(details.length > 0 ? { details: details.join("\n") } : {}),
  };
}

export function initMaterializeVerdict(r: MaterializeSkillsResult, pack: string): { ok: boolean; detail: string; warnings: string[]; pruneWarnings: string[] } {
  if (r.skipped) return { ok: false, detail: r.reason, warnings: [], pruneWarnings: [] };
  const row = r.repos[0];
  if (!row) return { ok: false, detail: "no bindings file was written", warnings: [], pruneWarnings: [] };
  const pruneWarnings = row.pruneWarnings ?? [];
  const { written, failures, warnings } = packVerdict([row], pack);
  if (failures.length > 0) return { ok: false, detail: failures.join("; "), warnings, pruneWarnings };
  return { ok: written > 0, detail: row.detail, warnings, pruneWarnings };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function realDeps(opts: { json: boolean }): InitDeps {
  const p = createRealProbes();
  const claudeBin = resolveClaudeBin();
  const run = async (cmd: string, args: string[]) => {
    const proc = Bun.spawn([cmd, ...args], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, stderr };
  };
  return {
    fs: {
      exists: (path) => existsSync(path),
      readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      writeFile: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      mkdirp: (path) => mkdirSync(path, { recursive: true }),
      readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    },
    home: homedir(),
    gitRemote: async (dir) => {
      try {
        execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "pipe" });
      } catch {
        return { kind: "not-a-repo" };
      }
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        if (url) return { kind: "ok", url };
      } catch {
        // origin is unset or has no URL; fall through to the first remote.
      }
      let firstRemote: string | null = null;
      try {
        const remotes = execFileSync("git", ["-C", dir, "remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        firstRemote = remotes[0] ?? null;
      } catch {
        return { kind: "no-remote" };
      }
      if (!firstRemote) return { kind: "no-remote" };
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", firstRemote], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        return url ? { kind: "ok", url } : { kind: "no-remote" };
      } catch {
        return { kind: "no-remote" };
      }
    },
    isTTY: Boolean(process.stdin.isTTY) && !opts.json && !process.env.RT_BATCH,
    promptZone: async () => ({
      name: await textInput({ message: "Team name (a new zone will be created)", stderr: true }),
      remote: await textInput({ message: "Empty git remote URL for the team zone", stderr: true }),
    }),
    createZone: async (name, remote) => {
      const r = await createTeam(p, { name, remote, others: false });
      return { slug: r.slug, dir: r.dir };
    },
    engineDescription: (engine) => {
      try {
        return loadStepSource(engine, resolvePluginRoots()).description;
      } catch {
        return null;
      }
    },
    claude: claudeBin ? (args) => run(claudeBin, args) : null,
    registerRepo: async (dir) => {
      const identity = serializeIdentity(await deriveRepoIdentity(dir));
      const indexed = await updateRepoIndexAsync(identity, dir);
      if (!indexed.ok) throw new UserActionableError("locate-failed", `rt could not add ${dir} to its repo list: ${indexed.error}`);
      return identity;
    },
    materialize: async (repoName, pack) => {
      const { ok, detail, warnings, pruneWarnings } = initMaterializeVerdict(await materializeSkills(p, { repo: repoName }), pack);
      for (const w of warnings) ui.note(ui.line("warn", "Another pack did not materialize", w));
      for (const w of pruneWarnings) ui.note(ui.line("warn", w));
      return { ok, detail };
    },
    // compilePackAll and checkPack resolve outside withCleanErrors, so a usage error from
    // pack resolution would escape as an uncaught throw and lose the `wrote` list.
    compile: async (packDir, manifest) => {
      try {
        return await compilePackAll({ packDir, manifest });
      } catch (err) {
        return { ok: false, errors: [message(err)] };
      }
    },
    check: async (packDir, manifest) => {
      try {
        return { drift: (await checkPack({ packDir, manifest })).drift };
      } catch (err) {
        ui.note(ui.line("warn", "The check could not run", message(err)));
        return { drift: true };
      }
    },
  };
}

export async function skillsInit(args: string[], _ctx: CommandContext = {}, deps?: InitDeps): Promise<void> {
  let parsed: InitArgs;
  try {
    parsed = parseInitArgs(args);
  } catch (err) {
    if (err instanceof UserActionableError) {
      if (args.includes("--json")) ui.json(envelope({ error: { code: "usage", message: err.message } }));
      else ui.fail({ title: err.message });
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  const resolvedDeps = deps ?? realDeps({ json: parsed.json });
  let out: InitOutcome;
  try {
    out = await initPack({ repoDir: parsed.repo, zone: parsed.zone }, resolvedDeps);
  } catch (err) {
    // A dep the pre-attempt setup calls directly (promptZone, createZone) can throw a
    // UserActionableError before initPack's own post-write attempt() wrapper is reached;
    // that must still refuse cleanly rather than crash to a bare stack.
    if (err instanceof UserActionableError) {
      if (parsed.json) {
        ui.json(userErrorPayload(new UserActionableError(err.code, err.message, { ...err.extra, refused: true })));
      } else {
        logFailureDetail(err);
        ui.fail(failureFor(err));
      }
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  if (parsed.json) {
    if (out.ok) ui.json(envelope(out));
    else if (out.refused) ui.json(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: true })));
    else ui.json(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: false, wrote: out.wrote })));
  } else if (out.ok) {
    ui.print(...initOutcomeBlocks(out));
  } else if (out.refused && POLICY_REFUSALS.has(out.code)) {
    ui.note(...initRefusalBlocks(out));
  } else {
    ui.fail(initFailure(out));
  }
  if (!out.ok) process.exitCode = out.refused ? 2 : 1;
}
