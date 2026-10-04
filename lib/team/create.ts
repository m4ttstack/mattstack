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

import { dirname, join } from "path";
import { type AgeKeySeam, createRealAgeKeySeam, ensureAgeKey, renderSopsYamlFor } from "../home/age-key.ts";
import { TEAM_PATH_REGEX } from "../secrets/team-store.ts";
import { forgeArgv } from "./forge.ts";
import { assertOnlyTeam } from "./one-team.ts";
import { updateTeamLocal } from "./team-local.ts";
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
}

export interface CreateTeamResult {
  slug: string;
  team: string;
  name: string;
  remote: string;
  dir: string;
  /** false when the dir already existed — nothing was written or committed. */
  created: boolean;
  /** Files and intent are on disk but no git ran: CLT was absent, so the
   *  Install re-run owns init/remote/commit once the checklist installs it. */
  gitDeferred?: true;
}

/** The scaffold's own marker: present only once the initial commit has actually happened, so a partially-built dir (mkdirp/git-init done, nothing committed yet) is never mistaken for a finished zone. */
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
    "mattstack/org/settings.org.jsonc": `${ORG_SETTINGS_HEADER}${JSON.stringify(orgSettings, null, 2)}\n`,
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

  writeIntent(p, { v: 1, at: p.now().toISOString(), mode: "create", team: { slug, name: opts.name, remote: url, others: opts.others } });
  return url;
}

export async function createTeam(p: Probes, opts: CreateTeamOpts, ageKeySeam: AgeKeySeam = createRealAgeKeySeam()): Promise<CreateTeamResult> {
  const slug = slugify(opts.name);
  const team = defaultTeamName(slug);
  const dir = join(p.home, ".mattstack", "teams", slug);
  assertNotRealStoreInTest(join(dir, "mattstack", "org", "settings.org.jsonc"));
  assertOnlyTeam(p, slug);

  const originConfigured = p.exists(dir) ? readExistingOrigin(p, dir) : null;
  if (originConfigured !== null && opts.remote !== null && opts.remote !== originConfigured) {
    throw new UserActionableError("team-exists", `The ${slug} team is already set up here with a different repo`, {}, {
      why: "Use the repo it was created with, or remove the team's folder to start over.",
      log: dir,
    });
  }

  const scaffolded = p.exists(join(dir, SCAFFOLD_MARKER));
  if (originConfigured !== null && scaffolded) {
    writeIntent(p, {
      v: 1,
      at: p.now().toISOString(),
      mode: "create",
      team: { slug, name: opts.name, remote: originConfigured, others: opts.others },
    });
    return { slug, team, name: opts.name, remote: stripUserinfo(originConfigured), dir, created: false };
  }

  // Past here the zone is either absent or partially built (dir exists, but
  // not yet fully scaffolded/committed) — every step below is a no-op when a
  // prior attempt already got that far.
  const remote = originConfigured ?? (await resolveRemote(p, slug, opts));

  p.mkdirp(dir);

  const { publicKey } = await ensureAgeKey(ageKeySeam);
  const writeScaffold = () => {
    for (const [relPath, content] of Object.entries(scaffoldFiles(slug, opts.name, remote, [publicKey], team))) {
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
      team: { slug, name: opts.name, remote, others: opts.others },
    });

  // The Team screen reaches here before the checklist installs CLT, when
  // /usr/bin/git is Apple's stub: it fails and pops the install dialog. Leave
  // the zone git-less; Install re-runs this once CLT exists and finishes it.
  if (!p.exists(join(dir, ".git")) && !(await gitUsable(p.exec))) {
    writeScaffold();
    recordIntent();
    return { slug, team, name: opts.name, remote: stripUserinfo(remote), dir, created: true, gitDeferred: true };
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

  const addResult = await p.exec(["git", "add", "-A"], { cwd: dir });
  if (addResult.code !== 0) throw gitStepError("git-add-failed", "git add -A", addResult);

  const commitResult = await p.exec(["git", "commit", "-m", `team: scaffold ${slug}`], { cwd: dir });
  if (commitResult.code !== 0 && !/nothing to commit/i.test(`${commitResult.stdout}\n${commitResult.stderr}`)) {
    throw gitStepError("git-commit-failed", "git commit", commitResult);
  }

  recordIntent();

  return { slug, team, name: opts.name, remote: stripUserinfo(remote), dir, created: true };
}
