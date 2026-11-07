import { getSetting } from "../settings/resolve.ts";

export type OrgIdContext = { forgeHost: string | null; teamKeys: string[] | null };
export type OrgIdResult = { ok: true } | { ok: false; hit: string; reason: string };

const MR_REF = /(?<![\w!])![0-9]+\b/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findOrgIds(fields: string[], ctx: OrgIdContext): OrgIdResult {
  if (!ctx.forgeHost) {
    return { ok: false, hit: "", reason: "mattstack.integrations has no forge host, so work org references cannot be checked" };
  }
  if (!ctx.teamKeys?.length) {
    return { ok: false, hit: "", reason: "mattstack.directory has no team keys, so work org ticket ids cannot be checked" };
  }
  const host = ctx.forgeHost.toLowerCase();
  const keyPatterns = ctx.teamKeys.map((key) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(key)}-[0-9]+\\b`));

  for (const field of fields) {
    const mr = MR_REF.exec(field);
    if (mr) return { ok: false, hit: mr[0], reason: "names a merge request reference" };
    if (field.toLowerCase().includes(host)) return { ok: false, hit: host, reason: "names a URL on the work org forge" };
    for (const pattern of keyPatterns) {
      const m = pattern.exec(field);
      if (m) return { ok: false, hit: m[0], reason: "names a work org ticket id" };
    }
  }
  return { ok: true };
}

type Reader = <T>(key: string) => { value: T | undefined };

export function orgIdContext(read: Reader = getSetting as Reader): OrgIdContext {
  const integrations = read<{ forge?: { host?: string } | null }>("mattstack.integrations").value;
  const directory = read<{ teams?: Record<string, { linear?: { team?: string } } | null> }>("mattstack.directory").value;
  const forgeHost = integrations?.forge?.host || null;
  const keys = Object.values(directory?.teams ?? {})
    .map((t) => t?.linear?.team)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  return { forgeHost, teamKeys: keys.length ? keys : null };
}
