/**
 * The P1 "Fancy URLs" row: the local proxy installed by mattstack and its
 * certificate trusted, both from the admin dialog Allow raises.
 */
import type { Probes } from "./probes.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_INSTALLER_MISSING, deployedProxyVersion, proxyCaIsTrusted, proxyInstallerMissing } from "./steps/services.ts";

export interface FancyUrls {
  state: "done" | "todo";
  detail: string;
}

export const FANCY_URLS_DETAIL = {
  done: "Allowed",
  noProxy: "Not set up yet",
  untrusted: "Certificate not trusted yet",
} as const;

export async function fancyUrlsState(p: Probes): Promise<FancyUrls> {
  if (proxyInstallerMissing(p)) return { state: "done", detail: PROXY_INSTALLER_MISSING };

  // A plist with no VERSION is a proxy mattstack never installed, which Allow takes over.
  const installed = p.exists(PORTLESS_LAUNCHD_PLIST) && deployedProxyVersion(p) !== null;
  if (!installed) return { state: "todo", detail: FANCY_URLS_DETAIL.noProxy };
  if (!(await proxyCaIsTrusted(p))) return { state: "todo", detail: FANCY_URLS_DETAIL.untrusted };
  return { state: "done", detail: FANCY_URLS_DETAIL.done };
}
