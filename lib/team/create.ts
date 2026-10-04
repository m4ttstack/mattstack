/**
 * `rt team create` — scaffolds the local team zone (~/.mattstack/teams/<slug>)
 * as a fresh git repo with its starter settings, but never pushes: Install's
 * `team.create` step owns the push, via `publishTeam`.
 *
 * Every step below checks whether a previous attempt already got that far
 * before doing it again, so a failure partway through (network blip on
 * `git init`, a denied `git remote add`) leaves a zone a re-run can finish
 * rather than a permanent `team-exists` wall or a silently empty remote.
 */

import { applyEdits, modify, parse } from "jsonc-parser";
import { orgStoreFile } from "./org-store.ts";
import { publishTeam } from "./publish.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { dirname, join } from "path";
import { type AgeKeySeam, createRealAgeKeySeam, ensureAgeKey, renderSopsYamlFor } from "../home/age-key.ts";
import { TEAM_PATH_REGEX } from "../secrets/team-store.ts";
import { forgeArgv, forgeLogin } from "./forge.ts";
import { assertOnlyTeam } from "./one-team.ts";
import { readTeamLocal, updateTeamLocal } from "./team-local.ts";
import { UserActionableError } from "../errors.ts";
import { readIntent, writeIntent } from "../setup/intent.ts";
import { gitUsable } from "../setup/home-git.ts";
import type { ExecResult, Probes } from "../setup/probes.ts";
import { forgeFromRemote, parseOriginUrl, stripUserinfo } from "../setup/team-settings.ts";
import { withoutUrls } from "./redact.ts";
import { TEAM_NAME_RE } from "../../packages/rt-client/src/settings/stores.ts";
import { assertNotRealStoreInTest } from "../../packages/rt-client/src/test-isolation.ts";
import { slugify } from "./slug.ts";

export interface CreateTeamOpts {
  name: string;
  remote: string | null;
  createRepoOwner?: string;
  others: boolean;
  /** The first team folder; defaults to the org slug or team-<slug>. */
  firstTeam?: string;
}

export interface CreateTeamResult {
  slug: string;
  team: string;
  name: string;
  remote: string;
  dir: string;
  /** False when the clone was already scaffolded; deferred roles may still be written. */
  created: boolean;
  /** Files and intent are on disk but no git ran: CLT was absent, so the
   *  Install re-run owns init/remote/commit once the checklist installs it. */
  gitDeferred?: true;
  /** The creator's forge login is not known yet. */
  rolesDeferred?: true;
}

export interface CreateTeamSeams {
  forgeLogin: typeof forgeLogin;
  forgeToken: typeof storedForgeToken;
}

const REAL_SEAMS: CreateTeamSeams = { forgeLogin, forgeToken: storedForgeToken };
const JSONC_EDIT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
const ORG_STORE_RELATIVE = "mattstack/org/settings.org.jsonc";

function namedAdmins(storeText: string): unknown[] {
  const current = parse(storeText, [], { allowTrailingComma: true }) as Record<string, unknown> | undefined;
  const admins = (current?.["mattstack.org"] as { admins?: unknown } | undefined)?.admins;
  return Array.isArray(admins) ? admins : [];
}

/** Existing admins are authoritative, including on a create rerun. */
export function withCreator(storeText: string, team: string, creator: { username: string; agePublicKey?: string }): string {
  if (namedAdmins(storeText).length > 0) return storeText;
  const roles = { admins: [creator.username], teams: { [team]: { owners: [creator.username] } } };
  const entry = { username: creator.username, ...(creator.agePublicKey ? { agePublicKey: creator.agePublicKey } : {}), teams: [team] };
  const withRoles = applyEdits(storeText, modify(storeText, ["mattstack.org"], roles, JSONC_EDIT));
  return applyEdits(withRoles, modify(withRoles, ["mattstack.roster"], [entry], JSONC_EDIT));
}

async function creatorUsername(p: Probes, slug: string, remote: string, seams: CreateTeamSeams): Promise<string | null> {
  const recorded = readTeamLocal(p, slug).forgeUsername;
  if (recorded) return recorded;
  const forge = forgeFromRemote(remote);
  if (!forge) return p.env.USER ?? null;
  return seams.forgeLogin(p, forge.provider, forge.host, await seams.forgeToken(p, remote));
}

async function commitFiles(p: Probes, slug: string, paths: string[], message: string): Promise<void> {
  const cwd = join(p.home, ".mattstack", "teams", slug);
  const add = await p.exec(["git", "add", "--", ...paths], { cwd });
  if (add.code !== 0) throw gitStepError("git-add-failed", "git add", add);
  const diff = await p.exec(["git", "diff", "--cached", "--quiet", "--", ...paths], { cwd });
  if (diff.code === 0) return;
  if (diff.code !== 1) throw gitStepError("git-commit-failed", "git diff", diff);
  const commit = await p.exec(["git", "commit", "-m", message, "--", ...paths], { cwd });
  if (commit.code !== 0) throw gitStepError("git-commit-failed", "git commit", commit);
}

function commitCreator(p: Probes, slug: string, username: string): Promise<void> {
  return commitFiles(p, slug, [ORG_STORE_RELATIVE], `team: ${username} is the ${slug} org's admin`);
}

/** Only this Mac's pending create may claim or finish its creator's role commit. */
export async function claimPendingAdmin(p: Probes, slug: string, username: string, token: string | null): Promise<{ claimed: boolean; published: boolean; detail?: string }> {
  const pending = readTeamLocal(p, slug).creatorPending;
  if (!pending) return { claimed: false, published: false };
  const file = orgStoreFile(p.home, slug);
  const before = p.readFile(file);
  if (before === null) return { claimed: false, published: false };
  const after = withCreator(before, pending.team, { username, ...(pending.agePublicKey ? { agePublicKey: pending.agePublicKey } : {}) });
  if (after === before && !namedAdmins(before).includes(username)) {
    updateTeamLocal(p, slug, { creatorPending: undefined });
    return { claimed: false, published: false };
  }
  if (after !== before) p.writeFile(file, after);
  try {
    await commitCreator(p, slug, username);
    updateTeamLocal(p, slug, { creatorPending: undefined });
    const origin = readExistingOrigin(p, join(p.home, ".mattstack", "teams", slug));
    await publishTeam(p, slug, null, { token, tokenRemote: origin });
    return { claimed: true, published: true };
  } catch (err) {
    return { claimed: true, published: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The marker in HEAD proves that the scoped scaffold commit completed. */
const SCAFFOLD_MARKER = join("mattstack", "mattstack.jsonc");
const ORG_SETTINGS_HEADER = "// mattstack org settings, shared by every team. Created by `rt team create`. JSONC: comments and trailing commas are fine.\n";
const TEAM_SETTINGS_HEADER = "// mattstack team settings. Created by `rt team create`. JSONC: comments and trailing commas are fine.\n";

/** The first team is named after the org unless that is not a folder name a team may have. */
export function defaultTeamName(orgSlug: string): string {
  return TEAM_NAME_RE.test(orgSlug) ? orgSlug : `team-${orgSlug}`;
}

/**
 * The scaffold's tracked files, keyed by path relative to the clone root.
 * `recipients` seeds `.sops.yaml` at creation so a fresh org never passes
 * through a zero-recipient state.
 *
 * `board.projects` is deliberately not written: a present value claims repos
 * for the team's pack and flips the board's store-ownership latch.
 */
export function scaffoldFiles(slug: string, name: string, remote: string, recipients: string[] = [], team: string = defaultTeamName(slug)): Record<string, string> {
  const forge = forgeFromRemote(remote);

  const orgSettings: Record<string, unknown> = { "mattstack.integrations": { forge } };
  if (forge?.provider === "gitlab") orgSettings["board.gitlabHost"] = forge.host;
  const teamSettings = { "board.title": name };
  const marketplace = { name: slug, owner: { name }, plugins: [] };

  return {
    [SCAFFOLD_MARKER]: `${JSON.stringify({ role: "org", org: slug }, null, 2)}\n`,
    [ORG_STORE_RELATIVE]: `${ORG_SETTINGS_HEADER}${JSON.stringify(orgSettings, null, 2)}\n`,
    [`mattstack/teams/${team}/settings.team.jsonc`]: `${TEAM_SETTINGS_HEADER}${JSON.stringify(teamSettings, null, 2)}\n`,
    ".claude-plugin/marketplace.json": `${JSON.stringify(marketplace, null, 2)}\n`,
    ".sops.yaml": renderSopsYamlFor(TEAM_PATH_REGEX, recipients),
    ".gitignore": "mattstack/org/secrets/*.tmp\n.DS_Store\n",
  };
}

function readExistingOrigin(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw !== null ? parseOriginUrl(raw) : null;
}

const GIT_STEP_TITLE: Record<string, string> = {
  "git-init-failed": "rt could not start the team repo",
  "git-remote-failed": "rt could not point the team repo at its remote",
  "git-add-failed": "rt could not stage the team repo's files",
  "git-commit-failed": "rt could not make the team repo's first commit",
};

/** Every git-step failure becomes one of these — never a plain `Error` that would surface as an unhandled crash instead of a renderable message. */
function gitStepError(code: string, step: string, result: ExecResult): UserActionableError {
  return new UserActionableError(code, GIT_STEP_TITLE[code] ?? "rt could not set up the team repo", {}, {
    log: `${step} failed (exit ${result.code}): ${withoutUrls(`${result.stdout}\n${result.stderr}`.trim())}`,
  });
}

/**
 * A prior attempt may have already created the gh repo and then failed on a
 * later, purely-local step (git init, a scaffold write) before `.git/config`
 * ever recorded it — reuse that URL from the runtime intent instead of
 * calling `gh repo create` again, which fails outright once the repo
 * already exists remotely. The intent is written the moment gh succeeds
 * (before any filesystem mutation to the zone), so this is the durable
 * checkpoint a resume reads, not `.git/config`.
 */
function cachedRemoteFromIntent(p: Probes, slug: string): string | null {
  const intent = readIntent(p);
  return intent?.mode === "create" && intent.team?.slug === slug ? (intent.team.remote ?? null) : null;
}

async function resolveRemote(p: Probes, slug: string, opts: CreateTeamOpts): Promise<string> {
  if (opts.remote) return opts.remote;

  const cached = cachedRemoteFromIntent(p, slug);
  if (cached) return cached;

  if (!opts.createRepoOwner) {
    throw new UserActionableError("remote-required", "The team needs a repo", {}, {
      why: "Give rt the address of an empty repo, or let it create one on GitHub.",
      next: "rt team create <name> --remote <url>",
    });
  }

  const repoPath = `${opts.createRepoOwner}/mattstack-team-${slug}`;
  const result = await p.exec([...forgeArgv(p, "gh"), "repo", "create", repoPath, "--private"]);
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (/already exists/i.test(text)) {
      throw new UserActionableError("create-repo-exists", "GitHub already has a repo with this team's name", {}, {
        why: `It is ${repoPath}. Point rt at it instead of creating a new one.`,
        next: "rt team create <name> --remote <its url>",
      });
    }
    throw new UserActionableError("create-repo-failed", "GitHub did not create the team repo", {}, { log: `gh repo create ${repoPath} failed: ${withoutUrls(text.trim())}` });
  }
  const url = result.stdout.split("\n")[0]?.trim();
  if (!url) {
    throw new UserActionableError("create-repo-failed", "GitHub created the team repo but did not say where it is", {}, {
      log: `gh repo create ${repoPath} printed no URL to use as the remote`,
    });
  }

  // Provenance, recorded at the one moment it is knowable: rt just created
  // this remote. It confers no rights — it only lets the membership permission
  // be OFFERED later, so rt never asks whether it should administer a repo it
  // was merely pointed at (MAT-387). The permission itself stays off until a
  // human grants it.
  // Clears a stale joinedByRt from an earlier joined-then-deleted clone of
  // this same slug: updateTeamLocal merges, so an unset field here would
  // leave both flags true and this brand-new team pull-only from birth.
  updateTeamLocal(p, slug, { createdByRt: true, joinedByRt: false });

  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "create", team: { slug, name: opts.name, remote: url, others: opts.others, ...(opts.firstTeam ? { firstTeam: opts.firstTeam } : {}) } });
  return url;
}

export async function createTeam(p: Probes, opts: CreateTeamOpts, ageKeySeam: AgeKeySeam = createRealAgeKeySeam(), seams: CreateTeamSeams = REAL_SEAMS): Promise<CreateTeamResult> {
  const slug = slugify(opts.name);
  const team = opts.firstTeam ?? defaultTeamName(slug);
  if (!TEAM_NAME_RE.test(team)) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} cannot be a team name`, {}, { why: "A team name uses lowercase letters, digits and dashes, and starts with a letter." });
  }
  const dir = join(p.home, ".mattstack", "teams", slug);
  assertNotRealStoreInTest(orgStoreFile(p.home, slug));
  assertOnlyTeam(p, slug);

  const originConfigured = p.exists(dir) ? readExistingOrigin(p, dir) : null;
  if (originConfigured !== null && opts.remote !== null && opts.remote !== originConfigured) {
    throw new UserActionableError("team-exists", `The ${slug} team is already set up here with a different repo`, {}, {
      why: "Use the repo it was created with, or remove the team's folder to start over.",
      log: dir,
    });
  }

  const recordCreator = async (remote: string): Promise<{ needsCommit: boolean; deferred: boolean; username: string | null }> => {
    const file = orgStoreFile(p.home, slug);
    const before = p.readFile(file);
    if (before === null) return { needsCommit: false, deferred: false, username: null };
    const username = await creatorUsername(p, slug, remote, seams);
    const { publicKey } = await ensureAgeKey(ageKeySeam);
    if (username === null) {
      const named = namedAdmins(before).length > 0;
      if (!named) updateTeamLocal(p, slug, { creatorPending: { team, agePublicKey: publicKey } });
      return { needsCommit: false, deferred: !named, username: null };
    }
    const after = withCreator(before, team, { username, agePublicKey: publicKey });
    if (after !== before) p.writeFile(file, after);
    const local = readTeamLocal(p, slug);
    const pending = after !== before ? { team, agePublicKey: publicKey } : namedAdmins(before).includes(username) ? local.creatorPending : undefined;
    if (!local.forgeUsername || local.creatorPending || pending) updateTeamLocal(p, slug, { ...(!local.forgeUsername ? { forgeUsername: username } : {}), creatorPending: pending });
    return { needsCommit: after !== before || pending !== undefined, deferred: false, username };
  };

  const scaffolded = originConfigured !== null && p.exists(join(dir, SCAFFOLD_MARKER))
    ? (await p.exec(["git", "cat-file", "-e", `HEAD:${SCAFFOLD_MARKER}`], { cwd: dir })).code === 0
    : false;
  if (originConfigured !== null && scaffolded) {
    const creator = await recordCreator(originConfigured);
    if (creator.needsCommit && creator.username) {
      await commitCreator(p, slug, creator.username);
      updateTeamLocal(p, slug, { creatorPending: undefined });
    }
    writeIntent(p, {
      v: 1,
      at: p.now().toISOString(),
      mode: "create",
      team: { slug, name: opts.name, remote: originConfigured, others: opts.others, firstTeam: team },
    });
    return { slug, team, name: opts.name, remote: stripUserinfo(originConfigured), dir, created: false, ...(creator.deferred ? { rolesDeferred: true as const } : {}) };
  }

  // Past here the zone is either absent or partially built (dir exists, but
  // not yet fully scaffolded/committed) — every step below is a no-op when a
  // prior attempt already got that far.
  const remote = originConfigured ?? (await resolveRemote(p, slug, opts));

  p.mkdirp(dir);

  const { publicKey } = await ensureAgeKey(ageKeySeam);
  const scaffold = scaffoldFiles(slug, opts.name, remote, [publicKey], team);
  const paths = Object.keys(scaffold);
  const writeScaffold = () => {
    for (const [relPath, content] of Object.entries(scaffold)) {
      const fullPath = join(dir, relPath);
      if (p.exists(fullPath)) continue; // a resumed partial zone already has this file — never clobber real content with the scaffold's own placeholder
      p.mkdirp(dirname(fullPath));
      p.writeFile(fullPath, content);
    }
  };
  const recordIntent = () =>
    writeIntent(p, {
      v: 1,
      at: p.now().toISOString(),
      mode: "create",
      team: { slug, name: opts.name, remote, others: opts.others, firstTeam: team },
    });

  // The Team screen reaches here before the checklist installs CLT, when
  // /usr/bin/git is Apple's stub: it fails and pops the install dialog. Leave
  // the zone git-less; Install re-runs this once CLT exists and finishes it.
  if (!p.exists(join(dir, ".git")) && !(await gitUsable(p.exec))) {
    writeScaffold();
    const creator = await recordCreator(remote);
    recordIntent();
    return { slug, team, name: opts.name, remote: stripUserinfo(remote), dir, created: true, gitDeferred: true, ...(creator.deferred ? { rolesDeferred: true as const } : {}) };
  }

  if (!p.exists(join(dir, ".git"))) {
    const initResult = await p.exec(["git", "init", "-b", "main"], { cwd: dir });
    if (initResult.code !== 0) throw gitStepError("git-init-failed", "git init -b main", initResult);
  }

  if (originConfigured === null) {
    const remoteAddResult = await p.exec(["git", "remote", "add", "origin", remote], { cwd: dir });
    if (remoteAddResult.code !== 0) throw gitStepError("git-remote-failed", "git remote add origin", remoteAddResult);
  }

  writeScaffold();
  const creator = await recordCreator(remote);

  await commitFiles(p, slug, paths, `team: scaffold ${slug}`);

  const creatorLocal = readTeamLocal(p, slug);
  if (creatorLocal.forgeUsername && creatorLocal.creatorPending) updateTeamLocal(p, slug, { creatorPending: undefined });
  recordIntent();

  return { slug, team, name: opts.name, remote: stripUserinfo(remote), dir, created: true, ...(creator.deferred ? { rolesDeferred: true as const } : {}) };
}
