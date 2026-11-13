/**
 * Classifies one clone for rt's forge token: wired, could be wired, or
 * refused and why. Reads local config and origin only; never writes, never
 * touches the network, and no field but `originUrl` repeats a raw URL.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { linkPath } from "../../lib/deps/resolve.ts";
import { shellQuote } from "../../lib/herdr-launch.ts";
import { rtCredentialHelper } from "../../lib/setup/steps/repos.ts";
import { runGit } from "../../lib/worktree/git-async.ts";
import { createOriginAuth, forgeName, sshToHttps, type Forge, type OriginAuth, type OriginAuthVerdict, type SkipReason } from "./origin-auth.ts";
import { printable } from "./shared.ts";

export type CloneStateName = "done" | "pending" | "off" | "skipped";
/** The machine cause; Task 8 maps it to a refusal code, Task 7 to the --check row. */
export type CloneCause =
  | "wired" | "ready" | "ssh-ready"
  | "own-helper" | "insteadof-maps-back" | "no-rt-link" | "unmappable-ssh"
  | "no-origin" | "http-origin" | "not-https" | "not-a-forge" | "unconfirmed-host" | "no-token" | "token-unreadable";

export interface CloneState {
  state: CloneStateName;
  cause: CloneCause;
  transport: "https" | "ssh" | "http" | "other" | "none";
  /** For SSH, the mapped HTTPS host. */
  host: string | null;
  forge: Forge | null;
  reason: string;
  /** A runnable command, its path shell-quoted. */
  next?: string;
  originUrl: string | null;
  /** The mapped URL for an SSH origin. */
  httpsUrl: string | null;
  /** The entries rt did not write. */
  ownHelpers?: string[];
  /** `url.<base>.insteadOf <value>`, redacted. */
  insteadOfRule?: string;
}

export interface CloneDeps {
  auth: OriginAuth;
  rtLink: string;
  rtLinkExists(): boolean;
}

export function realCloneDeps(auth: OriginAuth = createOriginAuth()): CloneDeps {
  const rtLink = linkPath(process.env.HOME ?? homedir(), "rt");
  return { auth, rtLink, rtLinkExists: () => existsSync(rtLink) };
}

export async function helperEntries(root: string, host: string): Promise<string[]> {
  const res = await runGit(root, ["config", "--local", "--get-all", `credential.https://${host}.helper`]);
  if (res.exitCode !== 0) return [];
  return res.stdout.replace(/\n$/, "").split("\n");
}

export function rtWired(entries: string[], rtLink: string): boolean {
  return entries.length === 2 && entries[0] === "" && entries[1] === rtCredentialHelper(rtLink);
}

/** The rule git would apply to `httpsUrl`, or null when it reaches git unchanged. */
export async function insteadOfMapsBack(root: string, httpsUrl: string): Promise<string | null> {
  const echo = await runGit(root, ["ls-remote", "--get-url", httpsUrl]);
  if (echo.exitCode !== 0 || echo.stdout.trim() === httpsUrl) return null;
  const rules = await runGit(root, ["config", "--get-regexp", "^url\\..*\\.insteadof$"]);
  let best: { base: string; value: string } | null = null;
  for (const line of rules.exitCode === 0 ? rules.stdout.split("\n") : []) {
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    const base = key.slice("url.".length, key.length - ".insteadof".length);
    // git applies the longest matching prefix.
    if (httpsUrl.startsWith(value) && (!best || value.length > best.value.length)) best = { base, value };
  }
  if (!best) return `an insteadOf rule maps it to ${printable(echo.stdout.trim())}`;
  return `url.${printable(best.base)}.insteadOf ${printable(best.value)}`;
}

const VERDICT_CAUSE: Record<Exclude<SkipReason, "ssh">, CloneCause> = {
  "no-origin": "no-origin",
  http: "http-origin",
  "not-https": "not-https",
  "not-forge": "not-a-forge",
  unconfirmed: "unconfirmed-host",
  "no-token": "no-token",
  unreadable: "token-unreadable",
};

function skipCopy(cause: CloneCause, host: string | null, forge: Forge | null): string {
  switch (cause) {
    case "no-origin": return "has no origin";
    case "http-origin": return "origin uses http, not https";
    case "not-https": return "origin is not an https URL";
    case "not-a-forge": return "origin is not on GitHub or GitLab";
    case "unconfirmed-host": return `rt has not confirmed ${host ?? "this host"}`;
    case "no-token": return forge ? `rt holds no ${forgeName(forge)} token` : "rt holds no token for it";
    case "token-unreadable": return "rt could not read its token store";
    case "unmappable-ssh": return "its SSH host is not a known forge";
    case "no-rt-link": return "rt is not installed";
    default: return "";
  }
}

async function originUrlOf(root: string): Promise<string | null> {
  const res = await runGit(root, ["remote", "get-url", "origin"]);
  const url = res.exitCode === 0 ? res.stdout.trim() : "";
  return url === "" ? null : url;
}

export async function classifyClone(root: string, deps: CloneDeps): Promise<CloneState> {
  const originUrl = await originUrlOf(root);
  const raw = await deps.auth.verdict(originUrl);
  const isSsh = !raw.ok && raw.reason === "ssh";

  const transport: CloneState["transport"] =
    originUrl === null ? "none"
    : isSsh ? "ssh"
    : !raw.ok && raw.reason === "http" ? "http"
    : /^https:\/\//i.test(originUrl) ? "https"
    : "other";

  let httpsUrl: string | null = null;
  let v: OriginAuthVerdict = raw;
  if (isSsh) {
    httpsUrl = await sshToHttps(originUrl!);
    if (httpsUrl === null) {
      return { state: "skipped", cause: "unmappable-ssh", transport, host: null, forge: null, reason: skipCopy("unmappable-ssh", null, null), originUrl, httpsUrl };
    }
    v = await deps.auth.verdict(httpsUrl);
  }

  const host = v.host;
  const forge = v.forge;
  const base = { transport, host, forge, originUrl, httpsUrl };
  const skipped = (cause: CloneCause, extra: Partial<CloneState> = {}): CloneState => ({ state: "skipped", cause, ...base, reason: skipCopy(cause, host, forge), ...extra });

  if ((transport === "https" || transport === "ssh") && host !== null) {
    const entries = await helperEntries(root, host);
    const wired = rtWired(entries, deps.rtLink);
    if (wired && transport === "https") {
      return { state: "done", cause: "wired", ...base, reason: forge ? `already uses rt's ${forgeName(forge)} token` : "already uses rt's token" };
    }
    if (entries.length > 0 && !wired) {
      return skipped("own-helper", { reason: `has its own credential helper for ${host}`, ownHelpers: entries });
    }
  }

  if (transport === "ssh" && httpsUrl !== null) {
    const rule = await insteadOfMapsBack(root, httpsUrl);
    if (rule !== null) return skipped("insteadof-maps-back", { reason: `an insteadOf rule maps https back to SSH: ${rule}`, insteadOfRule: rule });
  }

  if (!v.ok) return skipped(v.reason === "ssh" ? "not-https" : VERDICT_CAUSE[v.reason]);
  if (!deps.rtLinkExists()) return skipped("no-rt-link");

  if (transport === "ssh") {
    return { state: "off", cause: "ssh-ready", ...base, reason: "uses SSH", next: `rt git auth --https ${shellQuote(root)}` };
  }
  return { state: "pending", cause: "ready", ...base, reason: "uses its own git credentials", next: `rt git auth ${shellQuote(root)}` };
}
