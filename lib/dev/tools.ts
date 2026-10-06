import { join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";

export type DevToolName = "git" | "bun" | "go" | "node";
export interface DevPins {
  bun: string;
  go: string;
}
export type DevToolState = "ready" | "missing" | "too-old";
export interface DevToolStatus {
  name: DevToolName;
  need: "required" | "warning";
  state: DevToolState;
  found: string | null;
  version: string | null;
  wanted: string | null;
}

export const NODE_FLOOR = "20.0.0";
export const PINS_URL_BASE = "https://raw.githubusercontent.com/m4ttstack/mattstack/main";

interface Spec {
  name: DevToolName;
  need: "required" | "warning";
  versionArgs: string[];
  parse(out: string): string | null;
  fallbackDirs(home: string): string[];
}

const SPECS: readonly Spec[] = [
  { name: "git", need: "required", versionArgs: ["--version"], parse: (o) => o.match(/git version (\d+(?:\.\d+)*)/)?.[1] ?? null, fallbackDirs: () => ["/usr/bin"] },
  { name: "bun", need: "required", versionArgs: ["--version"], parse: (o) => o.trim().match(/^(\d+\.\d+\.\d+)/)?.[1] ?? null, fallbackDirs: (h) => [join(h, ".bun", "bin"), "/opt/homebrew/bin"] },
  { name: "go", need: "required", versionArgs: ["version"], parse: (o) => o.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null, fallbackDirs: () => ["/opt/homebrew/bin", "/usr/local/go/bin", "/usr/local/bin"] },
  { name: "node", need: "warning", versionArgs: ["--version"], parse: (o) => o.trim().match(/^v?(\d+\.\d+\.\d+)/)?.[1] ?? null, fallbackDirs: () => ["/opt/homebrew/bin", "/usr/local/bin"] },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function parseBunPin(packageJson: string): string | null {
  try {
    const pm = (JSON.parse(packageJson) as { packageManager?: unknown }).packageManager;
    return typeof pm === "string" ? (pm.match(/^bun@(\d+\.\d+\.\d+)$/)?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

export function parseGoPin(goMod: string): string | null {
  return goMod.match(/^go (\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1] ?? null;
}

export function isBundledPath(path: string): boolean {
  return path.includes(".app/Contents/");
}

export async function readPins(p: Probes, clone: string | null): Promise<DevPins> {
  let pkg: string | null;
  let goMod: string | null;
  if (clone) {
    pkg = p.readFile(join(clone, "package.json"));
    goMod = p.readFile(join(clone, "ui", "go.mod"));
  } else {
    const [a, b] = await Promise.all([p.fetch(`${PINS_URL_BASE}/package.json`), p.fetch(`${PINS_URL_BASE}/ui/go.mod`)]);
    pkg = a.status === 200 ? a.body : null;
    goMod = b.status === 200 ? b.body : null;
  }
  const bun = pkg ? parseBunPin(pkg) : null;
  const go = goMod ? parseGoPin(goMod) : null;
  if (!bun || !go) {
    throw new UserActionableError(
      "dev-pins-unreadable",
      "rt could not read which bun and Go versions mattstack needs",
      {},
      { why: clone ? "The clone's package.json or ui/go.mod is missing a version." : "GitHub did not answer. Check your internet connection." },
    );
  }
  return { bun, go };
}

/** Follows the link chain so a PATH entry that points into an app bundle is recognised as one. */
function realTarget(p: Probes, path: string): string {
  let cur = path;
  for (let i = 0; i < 10; i++) {
    const next = p.readlink(cur);
    if (!next) return cur;
    cur = next.startsWith("/") ? next : join(cur, "..", next);
  }
  return cur;
}

function candidates(p: Probes, spec: Spec): string[] {
  const pathDirs = (p.env.PATH ?? "").split(":").filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...pathDirs, ...spec.fallbackDirs(p.home)]) {
    const path = join(dir, spec.name);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!p.exists(path) && !p.readlink(path)) continue;
    if (isBundledPath(path) || isBundledPath(realTarget(p, path))) continue;
    out.push(path);
  }
  return out;
}

function wantedFor(name: DevToolName, pins: DevPins): string | null {
  if (name === "bun") return pins.bun;
  if (name === "go") return pins.go;
  if (name === "node") return NODE_FLOOR;
  return null;
}

export async function probeDevTools(p: Probes, pins: DevPins): Promise<DevToolStatus[]> {
  const result: DevToolStatus[] = [];
  for (const spec of SPECS) {
    const wanted = wantedFor(spec.name, pins);
    let status: DevToolStatus = { name: spec.name, need: spec.need, state: "missing", found: null, version: null, wanted };
    for (const path of candidates(p, spec)) {
      const r = await p.exec([path, ...spec.versionArgs], { timeoutMs: 5000 });
      const version = r.code === 0 ? spec.parse(r.stdout) : null;
      if (!version) continue;
      const state: DevToolState = wanted && compareVersions(version, wanted) < 0 ? "too-old" : "ready";
      status = { ...status, state, found: path, version };
      break;
    }
    result.push(status);
  }
  return result;
}

export function installCommandFor(name: DevToolName, wanted: string | null): string {
  switch (name) {
    case "bun":
      return `curl -fsSL https://bun.sh/install | bash -s bun-v${wanted}`;
    case "go":
      return "brew install go";
    case "node":
      return "brew install node";
    case "git":
      return "xcode-select --install";
  }
}
