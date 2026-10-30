/**
 * The P1 "Fancy URLs" row: the local proxy installed by mattstack, its
 * certificate trusted, and Homebrew present or already tried, all from the
 * one admin dialog Allow raises.
 */
import type { Probes } from "./probes.ts";
import { readSetupState } from "./state.ts";
import { PORTLESS_LAUNCHD_PLIST, PROXY_INSTALLER_MISSING, deployedProxyVersion, proxyCaIsTrusted, proxyInstallerMissing } from "./steps/services.ts";

const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export async function brewInstalled(p: Pick<Probes, "exists">): Promise<boolean> {
  return BREW_PATHS.some((path) => p.exists(path));
}

export interface FancyUrls {
  state: "done" | "todo";
  detail: string;
  /** Asks Allow to install Homebrew in the same admin dialog. */
  brewMissing: boolean;
}

export const FANCY_URLS_DETAIL = {
  done: "Allowed",
  noProxy: "Not set up yet",
  untrusted: "Certificate not trusted yet",
  noBrew: "Homebrew not installed yet",
  brewFailed: "Homebrew did not install. Tools that need it say so on their own rows",
} as const;

export async function fancyUrlsState(p: Probes): Promise<FancyUrls> {
  const brewMissing = !(await brewInstalled(p));
  if (proxyInstallerMissing(p)) return { state: "done", detail: PROXY_INSTALLER_MISSING, brewMissing };

  // A plist with no VERSION is a proxy mattstack never installed, which Allow takes over.
  const installed = p.exists(PORTLESS_LAUNCHD_PLIST) && deployedProxyVersion(p) !== null;
  if (!installed) return { state: "todo", detail: FANCY_URLS_DETAIL.noProxy, brewMissing };
  if (!(await proxyCaIsTrusted(p))) return { state: "todo", detail: FANCY_URLS_DETAIL.untrusted, brewMissing };
  if (!brewMissing) return { state: "done", detail: FANCY_URLS_DETAIL.done, brewMissing };

  const attempt = readSetupState(p).homebrew;
  if (attempt === undefined) return { state: "todo", detail: FANCY_URLS_DETAIL.noBrew, brewMissing };
  return { state: "done", detail: attempt.outcome === "failed" ? FANCY_URLS_DETAIL.brewFailed : FANCY_URLS_DETAIL.done, brewMissing };
}
