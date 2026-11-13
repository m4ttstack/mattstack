/**
 * Classifies one clone for rt's forge token: wired, could be wired, or
 * refused and why. Reads local config and origin only; never writes, never
 * touches the network, and no field but `originUrl` repeats a raw URL.
 */

import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
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
  /** For `own-helper`: the helper key that comes after rt's pair (`rtWrote`), or would once rt writes it. Never its value. */
  helperAfter?: { key: string; rtWrote: boolean };
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

export interface HelperOrder {
  /** The values of rt's own key, `credential.https://<host>.helper`, in order. */
  own: string[];
  /** rt's pair is there and no helper for the host comes after it. */
  wired: boolean;
  /** The first helper key for the host that comes after rt's pair, or would once rt writes it; printable. */
  after: string | null;
}

interface ConfigEntry {
  scope: "local" | "worktree";
  key: string;
  /** Null for a key with no `=`. */
  value: string | null;
}

/** git's urlmatch, widened: a key rt cannot parse counts as one for the host, so a doubt never reads as "no helper". */
function keyAppliesTo(key: string, host: string): boolean {
  if (key === "credential.helper") return true;
  const sub = /^credential\.(.*)\.helper$/s.exec(key)?.[1];
  if (sub === undefined) return false;
  const m = /^(?:([^:/]*):\/\/)?(?:[^@/]*@)?([^/:?#]*)/.exec(sub);
  const scheme = m?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "https") return false;
  const pattern = (m?.[2] ?? "").toLowerCase();
  if (pattern === "") return true;
  const glob = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^.]*");
  // Ports are dropped on both sides: a key for another port of the host still counts, which fails closed.
  return new RegExp(`^${glob}$`).test(host.toLowerCase().replace(/:\d*$/, ""));
}

/**
 * Every `credential.*` entry the clone's own config sets (local and worktree
 * scope, includes followed), in the order git reads them. Global and system
 * entries always come first, so rt's empty value clears them. Throws when git
 * cannot read the config: an unread config must never pass as "no helper".
 */
async function clonesCredentialEntries(root: string): Promise<ConfigEntry[]> {
  const res = await runGit(root, ["config", "--show-scope", "--get-regexp", "-z", "^credential\\."]);
  if (res.exitCode === 1) return [];
  if (res.exitCode !== 0) throw new Error("git could not read this clone's credential config");
  const fields = res.stdout.split("\0");
  const entries: ConfigEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i]!;
    if (scope !== "local" && scope !== "worktree") continue;
    const item = fields[i + 1]!;
    const nl = item.indexOf("\n");
    entries.push(nl < 0 ? { scope, key: item, value: null } : { scope, key: item.slice(0, nl), value: item.slice(nl + 1) });
  }
  return entries;
}

/**
 * The shared git dir from `rev-parse --path-format=absolute --git-common-dir`.
 * A git older than 2.31 can echo the flag it does not know and still exit 0,
 * so anything but one absolute path throws rather than skip the read.
 */
export function commonDirFrom(stdout: string): string {
  const lines = stdout.replace(/\n$/, "").split("\n");
  if (lines.length !== 1 || !isAbsolute(lines[0]!)) throw new Error("git could not find this clone's git dir");
  return lines[0]!;
}

/** The `config.worktree` files under the shared git dir: the main worktree's and each linked one's. */
async function worktreeConfigFiles(root: string): Promise<string[]> {
  const common = await runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.exitCode !== 0) throw new Error("git could not find this clone's git dir");
  const dir = commonDirFrom(common.stdout);
  let linked: string[] = [];
  try {
    linked = readdirSync(join(dir, "worktrees"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return [join(dir, "config.worktree"), ...linked.map((name) => join(dir, "worktrees", name, "config.worktree"))];
}

/**
 * The worktree-scope `credential.*` keys of every worktree of the clone, when
 * the clone's own config turns on `extensions.worktreeConfig` (git honors it
 * from nowhere else). rt writes its pair to the shared config, so in each
 * worktree these come after it. Read from the shared git dir, so a worktree
 * whose folder is gone still counts: its config applies again if the folder
 * comes back. Throws when a file that is there cannot be read.
 */
async function otherWorktreeKeys(root: string): Promise<string[]> {
  const ext = await runGit(root, ["config", "--local", "--type=bool", "--get", "extensions.worktreeConfig"]);
  if (ext.exitCode === 1) return [];
  if (ext.exitCode !== 0) throw new Error("git could not read this clone's credential config");
  if (ext.stdout.trim() !== "true") return [];
  const keys: string[] = [];
  for (const file of await worktreeConfigFiles(root)) {
    if (!existsSync(file)) continue;
    const res = await runGit(root, ["config", "--file", file, "--includes", "--get-regexp", "-z", "^credential\\."]);
    if (res.exitCode === 1) continue;
    if (res.exitCode !== 0) throw new Error("git could not read a worktree's credential config");
    for (const item of res.stdout.split("\0")) {
      if (item === "") continue;
      const nl = item.indexOf("\n");
      keys.push(nl < 0 ? item : item.slice(0, nl));
    }
  }
  return keys;
}

/**
 * Where rt's pair sits among the helpers git would run for https://<host>.
 * git's `approve` hands the token to every helper after the empty value, so
 * rt's pair must come last. Unwritten, the pair would land after the last key
 * of the clone's `[credential "https://<host>"]` section, or at the end of
 * the clone's config when it has none.
 */
export async function readHelperOrder(root: string, host: string, rtLink: string): Promise<HelperOrder> {
  const entries = await clonesCredentialEntries(root);
  const rtKey = `credential.https://${host}.helper`;
  const own = entries.filter((e) => e.key === rtKey).map((e) => e.value ?? "\0");
  const isPair = own.length === 2 && own[0] === "" && own[1] === rtCredentialHelper(rtLink);
  const sectionPrefix = `credential.https://${host}.`;
  let pairAt: number | null = null;
  if (isPair) pairAt = entries.findIndex((e) => e.key === rtKey);
  else if (own.length === 0) {
    const section = entries.findLastIndex((e) => e.scope === "local" && e.key.startsWith(sectionPrefix));
    pairAt = section >= 0 ? section : entries.findLastIndex((e) => e.scope === "local");
  }
  const next = pairAt === null ? undefined : entries.slice(pairAt + 1).find((e) => e.key !== rtKey && keyAppliesTo(e.key, host));
  // Any key here applies after the shared pair, rt's own key included.
  const elsewhere = next ? undefined : (await otherWorktreeKeys(root)).find((key) => keyAppliesTo(key, host));
  const afterKey = next?.key ?? elsewhere;
  const after = afterKey !== undefined ? printable(afterKey) : null;
  return { own, wired: isPair && after === null, after };
}

async function readInsteadOfRules(root: string): Promise<string> {
  const res = await runGit(root, ["config", "-z", "--get-regexp", "^url\\..*\\.insteadof$"]);
  return res.exitCode === 0 ? res.stdout : "";
}

/**
 * When git rewrites `httpsUrl`: the rule as `url.<base>.insteadOf <value>`, or
 * "" when git rewrote it but no rule could be named. Null when unchanged.
 */
export async function insteadOfMapsBack(root: string, httpsUrl: string, readRules: (root: string) => Promise<string> = readInsteadOfRules): Promise<string | null> {
  const echo = await runGit(root, ["ls-remote", "--get-url", httpsUrl]);
  if (echo.exitCode !== 0 || echo.stdout.trim() === httpsUrl) return null;
  let best: { base: string; value: string } | null = null;
  for (const entry of (await readRules(root)).split("\0")) {
    const nl = entry.indexOf("\n");
    if (nl < 0) continue;
    const key = entry.slice(0, nl);
    const value = entry.slice(nl + 1);
    const base = key.slice("url.".length, key.length - ".insteadof".length);
    // git applies the longest matching prefix.
    if (httpsUrl.startsWith(value) && (!best || value.length > best.value.length)) best = { base, value };
  }
  return best ? `url.${printable(best.base)}.insteadOf ${printable(best.value)}` : "";
}

const VERDICT_CAUSE: Record<Exclude<SkipReason, "ssh">, CopiedCause> = {
  "no-origin": "no-origin",
  http: "http-origin",
  "not-https": "not-https",
  "not-forge": "not-a-forge",
  unconfirmed: "unconfirmed-host",
  "no-token": "no-token",
  unreadable: "token-unreadable",
};

type CopiedCause = Exclude<CloneCause, "wired" | "ready" | "ssh-ready" | "own-helper" | "insteadof-maps-back">;

function skipCopy(cause: CopiedCause, host: string | null, forge: Forge | null): string {
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
  const skipped = (cause: CopiedCause): CloneState => ({ state: "skipped", cause, ...base, reason: skipCopy(cause, host, forge) });

  if ((transport === "https" || transport === "ssh") && host !== null) {
    const order = await readHelperOrder(root, host, deps.rtLink);
    if (order.wired && transport === "https") {
      return { state: "done", cause: "wired", ...base, reason: forge ? `already uses rt's ${forgeName(forge)} token` : "already uses rt's token" };
    }
    if (order.after !== null) {
      const rtWrote = order.own.length > 0;
      const reason = rtWrote ? "another credential helper comes after rt's" : `has its own credential helper for ${host}`;
      return { state: "skipped", cause: "own-helper", ...base, reason, helperAfter: { key: order.after, rtWrote } };
    }
    if (order.own.length > 0 && !order.wired) {
      return { state: "skipped", cause: "own-helper", ...base, reason: `has its own credential helper for ${host}`, ownHelpers: order.own };
    }
  }

  if (transport === "ssh" && httpsUrl !== null) {
    const rule = await insteadOfMapsBack(root, httpsUrl);
    if (rule === "") return { state: "skipped", cause: "insteadof-maps-back", ...base, reason: "an insteadOf rule rewrites its URL" };
    if (rule !== null) return { state: "skipped", cause: "insteadof-maps-back", ...base, reason: `an insteadOf rule rewrites it: ${rule}`, insteadOfRule: rule };
  }

  if (!v.ok) return skipped(v.reason === "ssh" ? "not-https" : VERDICT_CAUSE[v.reason]);
  if (!deps.rtLinkExists()) return skipped("no-rt-link");

  if (transport === "ssh") {
    return { state: "off", cause: "ssh-ready", ...base, reason: "uses SSH", next: `rt git auth --https ${shellQuote(root)}` };
  }
  return { state: "pending", cause: "ready", ...base, reason: "uses its own git credentials", next: `rt git auth ${shellQuote(root)}` };
}
