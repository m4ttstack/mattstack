/**
 * lib/agent-argv/node-pin.ts ... which Node an agent pane should run, on an
 * nvm machine whose repo carries a .nvmrc.
 *
 * nvm's installer loads nvm from ~/.zshrc and never runs `nvm use`, so a pane
 * shell lands on nvm's default Node rather than the repo's. The pin is resolved
 * from nvm's versions dir directly (no nvm.sh, which brew installs outside
 * NVM_DIR) and handed to the pane as a PATH prefix, which the agent's own
 * non-interactive shells inherit: nvm.sh keeps a current nvm Node when it is
 * sourced again.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { shellSingleQuote } from "./claude.ts";

export type NodePin = { kind: "bin"; dir: string } | { kind: "missing"; version: string };

const ALIAS_DEPTH = 4;

function parseVersion(dirName: string): number[] | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(dirName);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareDesc(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
  return 0;
}

function highestMatching(installed: string[], prefix: number[]): string | undefined {
  return installed
    .map((d) => ({ d, v: parseVersion(d) }))
    .filter((x): x is { d: string; v: number[] } => x.v !== null && prefix.every((p, i) => x.v![i] === p))
    .sort((a, b) => compareDesc(a.v, b.v))[0]?.d;
}

function readFirstLine(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/)[0]!.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Reads the given PATH: a bare Bun.which reads the PATH the process started with, the minimal one under launchd. */
function onPath(name: string, pathValue: string | undefined): boolean {
  return pathValue ? Bun.which(name, { PATH: pathValue }) !== null : false;
}

export function resolveNodePin(cwd: string, env: NodeJS.ProcessEnv = process.env): NodePin | undefined {
  const wanted = readFirstLine(join(cwd, ".nvmrc"));
  if (!wanted) return undefined;
  const nvmDir = env.NVM_DIR || join(env.HOME ?? homedir(), ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  if (!existsSync(versionsDir)) return undefined;
  if (onPath("mise", env.PATH)) return undefined;

  let installed: string[];
  try {
    installed = readdirSync(versionsDir);
  } catch {
    return undefined;
  }

  let spec = wanted;
  for (let depth = 0; depth < ALIAS_DEPTH; depth++) {
    const numeric = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec);
    if (numeric) {
      const prefix = numeric.slice(1).filter((p) => p !== undefined).map(Number);
      const hit = highestMatching(installed, prefix);
      if (hit) return { kind: "bin", dir: join(versionsDir, hit, "bin") };
      return { kind: "missing", version: spec.replace(/^v/, "") };
    }
    // A custom `stable` alias wins over the implicit one, as in nvm; `node` is never an alias.
    const aliasable = spec !== "node" && (spec === "lts/*" || (/^[\w./-]+$/.test(spec) && !spec.includes("..")));
    const next = aliasable ? readFirstLine(join(nvmDir, "alias", spec)) : undefined;
    if (next) {
      spec = next;
      continue;
    }
    if (spec === "node" || spec === "stable") {
      const hit = highestMatching(installed, []);
      return hit ? { kind: "bin", dir: join(versionsDir, hit, "bin") } : undefined;
    }
    return undefined;
  }
  return undefined;
}

/** The pane-line pieces for a pin: env tokens that sit with the other env assignments, and a lead clause run before them. */
export function nodePinShell(pin: NodePin | undefined): { env: string[]; lead: string } {
  if (!pin) return { env: [], lead: "" };
  if (pin.kind === "bin") return { env: [`PATH=${shellSingleQuote(pin.dir)}:"$PATH"`], lead: "" };
  const msg = `rt: .nvmrc asks for node ${pin.version}, which nvm has not installed. Run: nvm install ${pin.version}`;
  return { env: [], lead: `echo ${shellSingleQuote(msg)} >&2 && ` };
}
