import { getSetting } from "../settings/resolve.ts";

export const REAL_DEFAULTS: readonly string[] = [
  "Tests:.*failed",
  "Test Suites:.*failed",
  "FAIL ",
  "✕",
  "✗",
  "error TS[0-9]",
  "Type error",
  "ESLint",
  "Prettier",
  "AssertionError",
  "expect\\(",
  "error Command failed",
  "ELIFECYCLE",
];

export const INFRA_DEFAULTS: readonly string[] = [
  "execution took longer than",
  "gyp ERR",
  "node-pre-gyp ERR",
  "No space left on device",
  "Cannot connect to the Docker daemon",
  "ECONNRESET",
  "ETIMEDOUT",
  "503 Service",
  "failed to pull image",
  "runner system failure",
  "Connection reset by peer",
  "dial tcp.*connection refused",
  "fatal: unable to access",
  "TLS handshake timeout",
];

export interface TriageConfig {
  realPatterns: string[];
  infraPatterns: string[];
  noisyJobs: string[];
  baseDepth: number;
  baseRef: string | null;
  skipBase: boolean;
}

export type InlineConfig = Record<string, unknown>;

export interface CompiledPatterns {
  real: RegExp[];
  infra: RegExp[];
}

const DEFAULT_BASE_DEPTH = 3;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function settingsConfig(
  read: (key: string) => unknown = (k) => getSetting(k).value,
): TriageConfig {
  const depth = read("ci.triage.baseDepth");
  const ref = read("ci.triage.baseRef");
  return {
    realPatterns: strings(read("ci.triage.realPatterns")),
    infraPatterns: strings(read("ci.triage.infraPatterns")),
    noisyJobs: strings(read("ci.triage.noisyJobs")),
    baseDepth: typeof depth === "number" ? depth : DEFAULT_BASE_DEPTH,
    baseRef: typeof ref === "string" && ref !== "" ? ref : null,
    skipBase: read("ci.triage.skipBase") === true,
  };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

export function mergeConfig(
  base: TriageConfig,
  inline: InlineConfig | undefined,
): TriageConfig | { error: string } {
  const out: TriageConfig = { ...base };
  if (!inline) return out;

  const arrays: [string, "realPatterns" | "infraPatterns" | "noisyJobs"][] = [
    ["real-patterns", "realPatterns"],
    ["infra-patterns", "infraPatterns"],
    ["noisy-jobs", "noisyJobs"],
  ];
  for (const [key, field] of arrays) {
    const v = inline[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      return { error: `config key ${key} must be an array of strings` };
    }
    out[field] = union(base[field], v as string[]);
  }

  const depth = inline["base-depth"];
  if (depth !== undefined) {
    if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 20) {
      return { error: "config key base-depth must be an integer from 1 to 20" };
    }
    out.baseDepth = depth;
  }

  const ref = inline["base-ref"];
  if (ref !== undefined) {
    if (typeof ref !== "string") return { error: "config key base-ref must be a string" };
    out.baseRef = ref === "" ? null : ref;
  }

  const skip = inline["skip-base"];
  if (skip !== undefined) {
    if (typeof skip !== "boolean") return { error: "config key skip-base must be a boolean" };
    out.skipBase = skip;
  }
  return out;
}

function compileAll(patterns: string[]): RegExp[] | { error: string } {
  const out: RegExp[] = [];
  for (const p of patterns) {
    if (p.includes("[[:")) {
      return { error: `pattern ${p} uses a POSIX bracket class, which JavaScript regular expressions do not support` };
    }
    try {
      out.push(new RegExp(p));
    } catch (e) {
      return { error: `pattern ${p} does not compile: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return out;
}

export function compilePatterns(
  cfg: TriageConfig,
  forgeInfra: string[],
): CompiledPatterns | { error: string } {
  const real = compileAll([...REAL_DEFAULTS, ...cfg.realPatterns]);
  if ("error" in real) return real;
  const infra = compileAll([...INFRA_DEFAULTS, ...cfg.infraPatterns, ...forgeInfra]);
  if ("error" in infra) return infra;
  return { real, infra };
}
