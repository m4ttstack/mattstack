/**
 * Runs after a team pull moved the clone, behind materialize: renders each
 * husk pack in that org whose inputs changed, so a member's next load_skill
 * finds its tree ready. An unchanged pack costs one input hash.
 *
 * The render runs in a child rt (`rt skills render --husk-packs`): a cold
 * compile is seconds of synchronous work and shells out synchronously, which
 * the daemon's event loop must never carry (no-daemon-sync-exec).
 */
import { join } from "node:path";
import type { Logger } from "pino";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { anyHuskPack } from "../skills/render-paths.ts";
import { rtDir } from "../rt-paths.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { childEnv, MAX_LOGGED_OUTPUT, outputTail } from "../subprocess.ts";

export type HuskRenderResult = { pack: string; ok: boolean; detail: string };
type RenderFn = (org: string) => Promise<HuskRenderResult[]>;

/** Covers the plugin list's own 60s deadline plus a cold compile per pack. */
export const RENDER_DEADLINE_MS = 5 * 60_000;

/** The daemon's own entry is lib/daemon.ts from source, so Bun.main there is not the CLI. */
const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli.ts");

export function renderChildArgv(org: string, opts: { compiled?: boolean; execPath?: string } = {}): string[] {
  return [...rtSelfArgv({ ...opts, main: CLI_ENTRY }), "skills", "render", "--husk-packs", "--org", org, "--json"];
}

export interface RenderChild {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: NodeJS.Signals): void;
}

export type RenderSpawn = (argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => RenderChild;

const spawnChild: RenderSpawn = (argv, opts) =>
  Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

function parseResults(stdout: string): HuskRenderResult[] | null {
  try {
    const body = JSON.parse(stdout) as { ok?: unknown; results?: unknown };
    if (body?.ok !== true || !Array.isArray(body.results)) return null;
    return body.results.filter((r): r is HuskRenderResult => typeof r?.pack === "string" && typeof r?.ok === "boolean" && typeof r?.detail === "string");
  } catch {
    return null;
  }
}

/** Runs the child and reads its JSON summary; throws on a timeout, a crash or an unreadable summary. */
export async function renderInChild(org: string, deps: { argv?: string[]; spawn?: RenderSpawn; timeoutMs?: number } = {}): Promise<HuskRenderResult[]> {
  const timeoutMs = deps.timeoutMs ?? RENDER_DEADLINE_MS;
  // Bun reads bunfig and .env from the child's cwd, and a checkout's would load into the render.
  const child = (deps.spawn ?? spawnChild)(deps.argv ?? renderChildArgv(org), { cwd: rtDir(), env: { ...childEnv(), RT_BATCH: "1", RT_SKIP_SETUP: "1" } });
  const stdout = new Response(child.stdout).text().catch(() => "");
  const stderr = new Response(child.stderr).text().catch(() => "");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let killedAtDeadline = false;
  try {
    const timedOut = new Promise<"timeout">((resolve) => {
      deadline = setTimeout(() => {
        killedAtDeadline = true;
        child.kill("SIGKILL");
        resolve("timeout");
      }, timeoutMs);
      deadline.unref?.();
    });
    const outcome = await Promise.race([child.exited, timedOut]);
    if (killedAtDeadline || outcome === "timeout") throw new Error(`the husk render timed out after ${timeoutMs / 1000}s and was killed`);
    const results = parseResults(await stdout);
    if (results === null) throw new Error(`the husk render exited ${outcome} with no summary: ${outputTail(await stderr, MAX_LOGGED_OUTPUT)}`);
    return results;
  } finally {
    clearTimeout(deadline);
  }
}

export interface RenderPullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  render?: RenderFn;
}

/** The returned hook never throws: a failed render must not fail the pull that drove it. */
export function createRenderPullHook(deps: RenderPullHookDeps): (slug: string) => Promise<void> {
  return async (slug) => {
    try {
      const probes = deps.probes ?? createRealProbes();
      if (!anyHuskPack(probes, probes.home)) return;
      const results = await (deps.render ?? renderInChild)(slug);
      for (const r of results.filter((r) => !r.ok)) deps.log.warn({ team: slug, pack: r.pack, reason: r.detail }, "team pull: a husk pack did not render");
      const rendered = results.filter((r) => r.ok).map((r) => r.detail);
      if (rendered.length > 0) deps.log.debug({ team: slug, rendered }, "team pull: husk packs checked");
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but rendering husk packs failed; load_skill renders on demand");
    }
  };
}
