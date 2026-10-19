/**
 * The random id a Mac reports its version ping under. One file per flavor so
 * the prod and dev apps on one Mac count as two installs; it holds nothing
 * derived from the machine or the person.
 */

import { randomUUID } from "crypto";
import { dirname, join } from "path";
import type { Flavor } from "../flavor.ts";
import type { Probes } from "../setup/probes.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function installIdPath(home: string, flavor: Flavor): string {
  return join(home, ".mattstack", "rt", `telemetry-id-${flavor}`);
}

/** Throws when a fresh id cannot be written: an id that is not kept would show up as a new install on every ping. */
export function readInstallId(p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "home">, flavor: Flavor): string {
  const path = installIdPath(p.home, flavor);
  const existing = p.readFile(path)?.trim();
  if (existing && UUID_RE.test(existing)) return existing;

  const id = randomUUID();
  p.mkdirp(dirname(path));
  p.writeFile(path, `${id}\n`, 0o600);
  return id;
}
