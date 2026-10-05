import { realpathSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { orgDir } from "../rt-paths.ts";
import { currentOrg, listOrgs } from "../settings/stores.ts";
import { orgOfPackDir } from "./sources.ts";

export type PackOrg =
  | { kind: "outside" }
  | { kind: "current"; org: string; rel: string }
  | { kind: "other"; org: string; current: string };

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function inside(rel: string): boolean {
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Which org a pack folder belongs to on this Mac. A pack under any org clone,
 * or in a copy of an org repo whose marker names another org, is that org's;
 * rt writes only the current org's packs, so "other" is always refused.
 */
export function packOrg(packDir: string): PackOrg {
  const current = currentOrg();
  if (current === null) return { kind: "outside" };
  const dir = canonical(packDir);
  for (const org of [...listOrgs()].sort()) {
    const rel = relative(canonical(orgDir(org)), dir);
    if (!inside(rel)) continue;
    return org === current ? { kind: "current", org, rel: rel.split(sep).join("/") } : { kind: "other", org, current };
  }
  const marked = orgOfPackDir(packDir)?.org;
  return marked !== undefined && marked !== current ? { kind: "other", org: marked, current } : { kind: "outside" };
}

export function otherOrgRefusal(org: string, current: string): { message: string; why: string } {
  return { message: `This pack is in the ${org} org, not the one this Mac uses`, why: `rt works with one org per Mac, and this Mac uses ${current}` };
}
