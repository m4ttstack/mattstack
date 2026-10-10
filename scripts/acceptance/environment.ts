/**
 * The environment an acceptance run drives: always one the acceptance run
 * owns, named by a descriptor file (RT_ACCEPTANCE_ENV), never the machine the
 * runner happens to be on. Its root holds an ownership marker with the same
 * id, so a descriptor pointed at someone's real home is refused.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { spawnSync } from "child_process";
import type { Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import type { LaunchProvenance } from "./evidence.ts";

export const OWNERSHIP_MARKER = ".rt-acceptance-owned";
export const ENV_VAR = "RT_ACCEPTANCE_ENV";

export type EnvironmentDescriptor = {
  owner: "rt-acceptance";
  id: string;
  /**
   * vm: a disposable guest. isolated-home: a throwaway HOME on this Mac with
   * its own daemon. shared-home: the person's regular HOME, for workers rt
   * starts and owns there; nothing disruptive runs in it.
   */
  kind: "vm" | "isolated-home" | "shared-home";
  root: string;
  home: string;
  codexHome?: string;
  /** PATH every probe runs with. */
  path: string;
  /** The installed app bundle under test. */
  app: string;
  /** The installed rt the bundle links. */
  rt: string;
  /** The daemon (or other service) a disruptive scenario may stop; recorded before any stop. */
  service?: { id: string };
  disruptive: boolean;
  /** Where the operator and capture helpers leave one manifest per scenario. */
  captureDir: string;
  /** The log a `claude` tripwire on the environment's PATH appends to; required for a Codex-only run. */
  claudeTripwireLog?: string;
  permissionMode: string;
  launch: LaunchProvenance;
};

export type ExecResult = { status: number; stdout: string; stderr: string };
export type Exec = (argv: string[], opts?: { timeoutMs?: number }) => ExecResult;

export type LoadedEnvironment = { descriptor: EnvironmentDescriptor; exec: Exec };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The descriptor, checked against its root's ownership marker; an error says why the run must record every scenario blocked. */
export function loadEnvironment(path: string | undefined, realHome: string = homedir()): Outcome<EnvironmentDescriptor> {
  if (!path) return { ok: false, error: { code: "not-ready", message: `no acceptance-owned environment: set ${ENV_VAR} to its descriptor` } };
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: { code: "invalid", message: `the environment descriptor ${path} cannot be read: ${(err as Error).message}` } };
  }
  if (!isObject(doc) || doc.owner !== "rt-acceptance" || typeof doc.id !== "string" || !doc.id) {
    return { ok: false, error: { code: "invalid", message: `${path} is not an rt-acceptance environment descriptor` } };
  }
  const d = doc as unknown as EnvironmentDescriptor;
  if (!["vm", "isolated-home", "shared-home"].includes(d.kind)) return { ok: false, error: { code: "invalid", message: `${path}: kind must be vm, isolated-home or shared-home` } };
  for (const key of ["root", "home", "app", "rt", "captureDir"] as const) {
    if (typeof d[key] !== "string" || !isAbsolute(d[key])) return { ok: false, error: { code: "invalid", message: `${path}: ${key} must be an absolute path` } };
  }
  if (typeof d.path !== "string" || !d.path) return { ok: false, error: { code: "invalid", message: `${path}: path must name the PATH probes run with` } };
  if (d.launch !== "managed" && d.launch !== "manual") return { ok: false, error: { code: "invalid", message: `${path}: launch must be managed or manual` } };
  if (typeof d.permissionMode !== "string" || !d.permissionMode) return { ok: false, error: { code: "invalid", message: `${path}: permissionMode is required` } };

  const marker = join(d.root, OWNERSHIP_MARKER);
  let owned = "";
  try {
    owned = readFileSync(marker, "utf8").trim();
  } catch {
    return { ok: false, error: { code: "refused", message: `${d.root} has no ${OWNERSHIP_MARKER} marker, so it is not an acceptance-owned environment` } };
  }
  if (owned !== d.id) return { ok: false, error: { code: "refused", message: `${marker} names ${owned || "nothing"}, not ${d.id}` } };

  if (d.kind === "isolated-home" && resolve(d.home) === resolve(realHome)) {
    return { ok: false, error: { code: "refused", message: `${d.kind} must not use the regular HOME ${realHome}` } };
  }
  if (d.kind === "shared-home" && d.disruptive) {
    return { ok: false, error: { code: "refused", message: "a shared-home environment cannot run disruptive scenarios: it would stop the person's own services" } };
  }
  if (d.disruptive && !d.service?.id) {
    return { ok: false, error: { code: "invalid", message: `${path}: a disruptive environment must name the service it may stop` } };
  }
  return { ok: true, data: d };
}

/** Runs a probe inside the environment: its HOME, CODEX_HOME and PATH only, nothing inherited. */
export function environmentExec(d: EnvironmentDescriptor): Exec {
  const env: Record<string, string> = { HOME: d.home, PATH: d.path, LANG: "en_US.UTF-8", RT_BATCH: "1" };
  if (d.codexHome) env.CODEX_HOME = d.codexHome;
  return (argv, opts = {}) => {
    const res = spawnSync(argv[0]!, argv.slice(1), { env, cwd: d.home, encoding: "utf8", timeout: opts.timeoutMs ?? 60_000 });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
}

/** The first x.y.z a `--version` banner prints. */
export function parseVersion(text: string): string | null {
  return /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1] ?? null;
}

export function tripwireCount(logPath: string | undefined): number | null {
  if (!logPath) return null;
  if (!existsSync(logPath)) return 0;
  return readFileSync(logPath, "utf8").split("\n").filter((line) => line.trim().length > 0).length;
}
