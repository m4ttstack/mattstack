/**
 * Stack guard for `rt sync`: decides, before any ref moves, whether the
 * current branch belongs to a stack and must not be rebased onto the default
 * branch on its own. Sources, in order: gitq's stack store (the branch is a
 * node), then the forge (its open MR targets a non-default branch, or an
 * open MR targets it).
 */

import type { Probes } from "./setup/probes.ts";
import { forgeFromRemote } from "./setup/team-settings.ts";
import { forgeArgv, forgeAuthEnv, glabEnv, parseForgeRemote } from "./team/forge.ts";
import { mayOfferGitLabToken, tokenOrNull, type ForgeTokenLookup } from "./team/forge-token.ts";
import { bundledToolExec } from "./deps/resolve.ts";
import { redactCredentials } from "../packages/rt-client/src/redact.ts";

export interface StackMembership {
  name: string;
  root: string;
  parent: string;
  children: string[];
}

export interface ForgeMr {
  iid: number;
  source: string;
  target: string;
  url: string;
}

export interface StackRefusal {
  kind: "stack-refusal" | "stack-check-unavailable";
  branch: string;
  source: "gitq" | "forge";
  stack: StackMembership | null;
  mrs: ForgeMr[] | null;
  tool: string;
  hint: string;
}

/** Distinct from 3, which is the paused-conflict bundle the same --json mode emits. */
export const STACK_REFUSAL_EXIT = 4;

export function renderStackRefusal(refusal: StackRefusal, mode: "json" | "human"): string {
  if (mode === "json") return JSON.stringify(refusal, null, 2);
  return refusal.tool ? `${refusal.hint}. Run: ${refusal.tool}` : refusal.hint;
}

export type StackVerdict =
  | { verdict: "clear" }
  | { verdict: "refuse"; refusal: StackRefusal }
  | { verdict: "unverified"; refusal: StackRefusal };

export interface StackGuardRunners {
  /** stdout of `gitq stacks --json` for cwd, or null when gitq cannot answer here. */
  gitqStacks(cwd: string): Promise<string | null>;
  /** Open MRs from or into `branch`; a listing the forge may have cut short is a failure, never a shorter list. */
  forgeOpenMrs(cwd: string, branch: string): Promise<{ ok: true; mrs: ForgeMr[] } | { ok: false; error: string }>;
}

interface GitqStackJson {
  stackName: string;
  root: string;
  nodes: { branch: string; parent: string }[];
}

/** Null when the output is not a gitq stacks document, so a caller cannot mistake it for "no stacks". */
function parseGitqStacks(stdout: string): GitqStackJson[] | null {
  try {
    const parsed = JSON.parse(stdout) as { stacks?: Partial<GitqStackJson>[] } | null;
    if (!Array.isArray(parsed?.stacks)) return null;
    return parsed.stacks.filter((stack): stack is GitqStackJson => Array.isArray(stack?.nodes));
  } catch {
    return null;
  }
}

function gitqMembership(stacks: GitqStackJson[], branch: string): StackMembership | null {
  for (const stack of stacks) {
    const node = stack.nodes.find((n) => n.branch === branch);
    if (!node) continue;
    return {
      name: stack.stackName,
      root: stack.root,
      parent: node.parent,
      children: stack.nodes.filter((n) => n.parent === branch).map((n) => n.branch),
    };
  }
  return null;
}

/** `known: false` means gitq could not answer here, which is not the same as "not in a stack". */
export async function stackMembershipOf(
  cwd: string,
  branch: string,
  runners: Pick<StackGuardRunners, "gitqStacks">,
): Promise<{ known: boolean; membership: StackMembership | null }> {
  const out = await runners.gitqStacks(cwd);
  if (out === null) return { known: false, membership: null };
  const stacks = parseGitqStacks(out);
  if (stacks === null) return { known: false, membership: null };
  return { known: true, membership: gitqMembership(stacks, branch) };
}

function unavailable(branch: string, hint: string): StackVerdict {
  return {
    verdict: "unverified",
    refusal: { kind: "stack-check-unavailable", branch, source: "forge", stack: null, mrs: null, tool: "", hint },
  };
}

export async function checkStackMembership(opts: {
  cwd: string;
  branch: string;
  /** Null when discovery failed; the forge check then cannot classify MR targets and reports unverified. */
  defaultBranch: string | null;
  runners: StackGuardRunners;
}): Promise<StackVerdict> {
  // The default branch is every stack's root, never a member: MRs targeting it are ordinary, not dependents.
  if (opts.branch === opts.defaultBranch) return { verdict: "clear" };
  const gitqOut = await opts.runners.gitqStacks(opts.cwd);
  const stacks = gitqOut === null ? null : parseGitqStacks(gitqOut);
  const membership = stacks === null ? null : gitqMembership(stacks, opts.branch);
  if (membership) {
    const tool = `gitq sync --stack ${membership.name}`;
    return {
      verdict: "refuse",
      refusal: {
        kind: "stack-refusal",
        branch: opts.branch,
        source: "gitq",
        stack: membership,
        mrs: null,
        tool,
        hint: `${opts.branch} is in stack ${membership.name}, so changing it on its own would break the stack`,
      },
    };
  }
  if (opts.defaultBranch === null) {
    return unavailable(opts.branch, "rt could not find the default branch, so it cannot tell whether this branch is in a stack");
  }
  const forge = await opts.runners.forgeOpenMrs(opts.cwd, opts.branch);
  if (!forge.ok) {
    return unavailable(opts.branch, `rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (${forge.error})`);
  }
  const own = forge.mrs.filter((mr) => mr.source === opts.branch && mr.target !== opts.defaultBranch);
  const dependents = forge.mrs.filter((mr) => mr.target === opts.branch);
  if (own.length > 0 || dependents.length > 0) {
    const detail = own.length > 0
      ? `its open merge request targets ${own[0]!.target}`
      : dependents.length === 1
        ? `the open merge request from ${dependents[0]!.source} targets it`
        : `the open merge requests from ${dependents.map((mr) => mr.source).join(", ")} target it`;
    return {
      verdict: "refuse",
      refusal: {
        kind: "stack-refusal",
        branch: opts.branch,
        source: "forge",
        stack: null,
        mrs: [...own, ...dependents],
        tool: "gitq track",
        hint: `${opts.branch} is in a stack gitq does not track yet: ${detail}`,
      },
    };
  }
  return { verdict: "clear" };
}

type ForgeListing = { ok: true; mrs: ForgeMr[] } | { ok: false; error: string };

/** A hung gitq or forge CLI must not hold the sync before its first ref move. */
const CLI_TIMEOUT_MS = 30_000;

/** `secret` is the token rt handed the CLI: a legacy or custom-prefix token has no shape the pattern redaction knows. */
function failure(prefix: string, r: { code: number; stdout: string; stderr: string }, secret?: string): ForgeListing {
  const first = (r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n")[0]!;
  const detail = redactCredentials(secret ? first.split(secret).join("[redacted]") : first);
  return { ok: false, error: `${prefix}: ${detail}` };
}

function isForgeMr(mr: ForgeMr): boolean {
  return Number.isInteger(mr.iid) && typeof mr.source === "string" && typeof mr.target === "string" && typeof mr.url === "string";
}

function parseListing<T>(stdout: string, map: (row: T) => ForgeMr): ForgeListing {
  try {
    const rows = JSON.parse(stdout) as unknown;
    if (!Array.isArray(rows)) return { ok: false, error: "forge listing was not a JSON array" };
    const mrs = (rows as T[]).map(map);
    if (!mrs.every(isForgeMr)) return { ok: false, error: "forge listing contained a record without iid, source, target, and url" };
    return { ok: true, mrs };
  } catch {
    return { ok: false, error: "forge listing was not JSON" };
  }
}

/** A filtered listing this long may be cut short, since the forge stops at the page size rt asks for. */
const LISTING_LIMIT = 100;

function complete(listing: ForgeListing, query: string): ForgeListing {
  if (!listing.ok || listing.mrs.length < LISTING_LIMIT) return listing;
  return { ok: false, error: `${query} returned ${LISTING_LIMIT} rows, the most rt asks for, so the listing may be incomplete` };
}

/** How a forge CLI runs for this check: its own login, or rt's token for the gated host and repo. */
interface CliOpts {
  env?: Record<string, string>;
  cwd?: string;
  /** The repo flag and its value, present only when a token goes along. */
  pin?: string[];
  token?: string;
}

function execOpts(cli: CliOpts) {
  return { ...(cli.env ? { env: cli.env } : {}), ...(cli.cwd ? { cwd: cli.cwd } : {}), timeoutMs: CLI_TIMEOUT_MS };
}

async function listGithub(p: Probes, cli: CliOpts, filter: string): Promise<ForgeListing> {
  const r = await p.exec([...forgeArgv(p, "gh"), "pr", "list", ...(cli.pin ?? []), "--state", "open", filter, "--limit", String(LISTING_LIMIT), "--json", "number,headRefName,baseRefName,url"], execOpts(cli));
  if (r.code !== 0) return failure("gh pr list failed", r, cli.token);
  return complete(parseListing<{ number: number; headRefName: string; baseRefName: string; url: string }>(r.stdout, (row) => ({
    iid: row.number, source: row.headRefName, target: row.baseRefName, url: row.url,
  })), `gh pr list ${filter}`);
}

async function listGitlab(p: Probes, cli: CliOpts, filter: string): Promise<ForgeListing> {
  const r = await p.exec([...forgeArgv(p, "glab"), "mr", "list", ...(cli.pin ?? []), filter, "--output", "json", "--per-page", String(LISTING_LIMIT)], execOpts(cli));
  if (r.code !== 0) return failure("glab mr list failed", r, cli.token);
  return complete(parseListing<{ iid: number; source_branch: string; target_branch: string; web_url: string }>(r.stdout, (row) => ({
    iid: row.iid, source: row.source_branch, target: row.target_branch, url: row.web_url,
  })), `glab mr list ${filter}`);
}

export interface StackGuardAuth {
  confirmedHost(): string | null;
  tokenFor(remote: string): Promise<ForgeTokenLookup>;
}

async function heldToken(auth: StackGuardAuth, remote: string): Promise<string | null> {
  try {
    return tokenOrNull(await auth.tokenFor(remote));
  } catch {
    return null;
  }
}

/**
 * `host/path` from the origin the gate checked, or null when it cannot be
 * derived. With a token, the CLI must be pinned to this repo: glab and gh
 * otherwise pick a remote themselves (an `upstream` ranks above origin) and
 * would send rt's token to that remote's host, and glab reads
 * GITLAB_HOST=gitlab.com as no override at all.
 */
function repoPin(forge: { host: string; provider: "github" | "gitlab" }, remote: string): string | null {
  const parsed = parseForgeRemote(remote);
  if (!parsed || parsed.host !== forge.host || parsed.provider !== forge.provider) return null;
  const segments = parsed.path.split("/");
  const shapeOk = forge.provider === "github" ? segments.length === 2 : segments.length >= 2;
  if (!shapeOk || !segments.every((seg) => /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(seg))) return null;
  return `${forge.host}/${parsed.path}`;
}

/** Decided once per check, so both listings share one token read. */
async function cliOpts(
  forge: { host: string; provider: "github" | "gitlab" },
  remote: string,
  cwd: string,
  auth: StackGuardAuth | undefined,
): Promise<CliOpts> {
  const asToday: CliOpts = forge.provider === "gitlab" ? withEnv(glabEnv(forge.host)) : {};
  if (!auth || /^http:\/\//i.test(remote)) return asToday;
  const gated = forge.provider === "gitlab"
    ? mayOfferGitLabToken(remote, auth.confirmedHost())
    : forge.host === "github.com";
  if (!gated) return asToday;
  const pin = repoPin(forge, remote);
  if (!pin) return asToday;
  const token = await heldToken(auth, remote);
  if (!token) return asToday;
  const env = forgeAuthEnv(forge.provider, forge.host, token) ?? {};
  return forge.provider === "gitlab"
    ? { env: { ...env, GITLAB_HOST: forge.host }, cwd, pin: ["-R", pin], token }
    : { env: { ...env, GH_HOST: forge.host }, cwd, pin: ["--repo", pin], token };
}

function withEnv(env: Record<string, string> | undefined): CliOpts {
  return env ? { env } : {};
}

// Filtered by branch on the forge's side, so how many other MRs are open never
// decides whether this branch's own MR or its dependents are seen. The `=`
// form keeps a dash-leading branch name from parsing as a flag.
async function listBranchMrs(p: Probes, remote: string, branch: string, cwd: string, auth: StackGuardAuth | undefined): Promise<ForgeListing> {
  const forge = forgeFromRemote(remote);
  if (!forge) return { ok: false, error: redactCredentials(`origin ${remote} is not a GitHub or GitLab remote`) };
  const cli = await cliOpts(forge, remote, cwd, auth);
  const [own, dependents] = forge.provider === "github"
    ? [await listGithub(p, cli, `--head=${branch}`), await listGithub(p, cli, `--base=${branch}`)]
    : [await listGitlab(p, cli, `--source-branch=${branch}`), await listGitlab(p, cli, `--target-branch=${branch}`)];
  if (!own.ok) return own;
  if (!dependents.ok) return dependents;
  return { ok: true, mrs: [...own.mrs, ...dependents.mrs] };
}

/** Real runners over the machine's gitq and forge CLIs. Without `auth`, glab and gh use their own login. */
export function createStackGuardRunners(p: Probes, auth?: StackGuardAuth): StackGuardRunners {
  return {
    async gitqStacks(cwd) {
      const r = await p.exec([...(bundledToolExec(p, "gitq") ?? ["gitq"]), "stacks", "--json", "-C", cwd], { timeoutMs: CLI_TIMEOUT_MS });
      return r.code === 0 ? r.stdout : null;
    },
    async forgeOpenMrs(cwd, branch) {
      const remote = await p.exec(["git", "remote", "get-url", "origin"], { cwd, timeoutMs: CLI_TIMEOUT_MS });
      if (remote.code !== 0) return failure("no origin remote", remote);
      return listBranchMrs(p, remote.stdout.trim(), branch, cwd, auth);
    },
  };
}
