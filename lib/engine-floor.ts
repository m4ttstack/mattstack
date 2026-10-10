import { join } from "path";
import { readFileSync } from "fs";
import { compareVersions } from "./skills/installed-plugins.ts";
import { warn } from "./ui/warn.ts";

declare const MATTSTACK_ENGINE: string | undefined;

export type Floor = string | null;
export const FLOOR_REL = "pack/requires.json";

export interface EngineDeps {
  baked: string | undefined;
  sourceRoot: string | null;
  readFile(path: string): string | null;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** A compiled binary's import.meta.dir is virtual, so its "source root" never holds a plugin.json and an unbaked build reads null. */
function defaultDeps(): EngineDeps {
  return {
    baked: typeof MATTSTACK_ENGINE !== "undefined" ? MATTSTACK_ENGINE : undefined,
    sourceRoot: join(import.meta.dir, ".."),
    readFile: safeRead,
  };
}

let warned = false;
export function __resetEngineWarning(): void {
  warned = false;
}

export function runnableEngine(deps: EngineDeps = defaultDeps()): string | null {
  if (deps.baked) return deps.baked;
  if (deps.sourceRoot !== null) {
    const raw = deps.readFile(join(deps.sourceRoot, "plugins", "mattstack", ".claude-plugin", "plugin.json"));
    if (raw !== null) {
      try {
        const v = (JSON.parse(raw) as { version?: unknown }).version;
        if (typeof v === "string" && v.length > 0) return v;
      } catch {}
    }
  }
  if (!warned) {
    warned = true;
    warn("engine-floor", "This rt cannot tell which mattstack engine it runs, so no pack is held on this Mac", {});
  }
  return null;
}

export function fits(floor: Floor, engine: string | null): boolean {
  if (floor === null || engine === null) return true;
  return compareVersions(engine, floor) >= 0;
}

export function readFloor(readFile: (path: string) => string | null, pluginDir: string): Floor {
  const path = join(pluginDir, FLOOR_REL);
  const raw = readFile(path);
  if (raw === null) return null;
  try {
    const v = (JSON.parse(raw) as { minEngine?: unknown }).minEngine;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {}
  warn("engine-floor", `${path} is not a valid engine floor, so it is ignored`, {});
  return null;
}

export function heldCopy(plugin: string, version: string | null, floor: string): string {
  return `${plugin}${version ? ` ${version}` : ""} needs a newer mattstack app (engine ${floor} or later). Update the app when it's offered.`;
}

export function refusalCopy(engine: string | null, what: string, floor: string): string {
  return `This app runs engine ${engine ?? "unknown"}; ${what} needs engine ${floor}. Update the app first.`;
}
