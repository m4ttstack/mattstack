# The last forge tokens leave git's environment (RT-575)

## Intent

PRs #1136 (RT-526) and #1142 (RT-573) gave rt a git credential helper,
`rt git credential`, that reads rt's forge token when git asks for it, and
moved sync, the pool fetch and the escalation push onto it. 26 calls in 14
files (the ticket says about 28; the guard counts 29 lines with the 3 in the
definition file) still hand git the token through `gitWithToken`
(`lib/team/git-credential.ts`): an inline shell helper that reads the token
from `RT_GIT_TOKEN` in git's environment. Any process git starts (a hook, a
credential helper, a remote helper, a pre-push script) inherits that
environment and can read the token. This change moves every one of those
calls onto `rt git credential`, so the token exists only on the helper's
stdout to git, and deletes `gitWithToken`.

This is credential handling: it decides how a secret reaches git.

## Goals

1. No call under `cli.ts`, `commands/` or `lib/` passes a forge token to git
   through a child's environment. `lib/__tests__/token-env-exemptions.json`
   ends empty (`[]`).
2. No behaviour change a person can see in team create, join, invite,
   publish, rename, trial branches, the data branch guard and restore, setup
   (repo clone, home remote push, team and org steps, access checks), the
   home repo clone, or the daemon's team pull and push. The same calls offer
   a token in the same cases and succeed or fail the same way.
3. GitHub and GitLab both covered by tests.

## Non-goals

- `lib/mcp/git-tools.ts` (`branch_sync`) and the agent sync path: outside
  this change's files. See "Also noted".
- No change to `rt git credential`'s own answers (`commands/git/credential.ts`,
  `credentialHelperReply`), its host gate, or which token it reads.
- No change to how rt-made clones are wired (`rtCredentialHelper` in their
  `.git/config`), to `rt git auth`, or to sync's fetch and push retry.
- No new setting, setup row, output string or `--json` field.
- The token lookups each call site does today are not removed or merged
  (approach A below). A later cleanup may turn them into a cheaper "does rt
  hold a token" check.

## Anti-goals (a failure even if it works)

- A token in argv, a URL, git config (local, global or system), an env var of
  any child, a log line, an error message, test output or a committed fixture.
- A token in a file on disk that rt did not already keep there (rt's sops
  store and the setup stage at `~/.mattstack/rt/setup-staging/rt.json`, 0600,
  are the only ones).
- The token offered to a host the call does not offer it to today, or to a
  host `rt git credential`'s gate refuses (anything other than github.com,
  gitlab.com and the host confirmed through `rt setup <forge> connect --host`;
  never a GitLab token to github.com; never over `http://`).
- git's `store` handing rt's token to another helper (the macOS keychain).
- A write to the real `~/.gitconfig` or `~/.mattstack`, in code or in tests.

## Approaches considered

A shepherd ruling (herd gate f5c7b8e8, 2026-11-14) picked A.

- **A. The helper replaces the token; each caller's lookup stays as the offer
  decision (picked).** A new builder names `rt git credential` as the only
  helper for the remote's https host through `git -c` pairs. Each call site
  keeps its existing token read and gate; a non-null result means "offer",
  null means "plain git", exactly as today. The helper reads the same token
  itself when git asks. No user-visible change.
- **B. The helper decides alone.** Name the helper on every https remote and
  drop the callers' lookups. Fewer reads, but visible changes: the helper
  falls back to the gh login, so rt would offer a token on paths that offer
  none today (setup's push to a URL the person typed, `home-remote.ts`), and
  every https call would stop prompting.
- **C. A plus a one-shot token file** (`rt git credential --token-file`, a
  0600 file in a 0700 run directory) for tokens rt has not stored. Not needed:
  section 2 shows no caller hands git a token outside rt's store, its stage or
  the gh login, and it adds a secret on disk.

## Design

### 1. The builder

`lib/team/git-credential.ts` loses `gitWithToken` and `HOST_HELPER` and gains:

```ts
export function gitWithRtCredential(
  args: string[],
  offer: boolean,
  env: Record<string, string>,
  opts: { remote: string | null; helper?: string },
): { argv: string[]; env: Record<string, string>; offered: boolean };
```

- When `offer` is false, or `opts.remote` is not `https://` with a host
  (`hostFromRemote`), it returns `{ argv: ["git", ...args], env, offered:
  false }`: the same plain call `gitWithToken` made for a null token or a
  non-https remote.
- `offered` is true exactly when the helper pair was added. A caller that
  branches on whether rt offered its token reads `offered`, never the env:
  `home/init-exec.ts:100` today tests `Object.keys(cmd.env).length === 0`,
  which would always read "not offered" once the env stops carrying the
  token and would drop its retry with git's own credentials. It moves to
  `!cmd.offered`, keeping the try-rt-then-git's-own fallback; its existing
  `gho_other_account` case (`init-exec.test.ts`) pins that.
- Otherwise it returns `git -c credential.https://<host>.helper= -c
  credential.https://<host>.helper=<helper> ...args` with `env` unchanged.
  The empty value clears every helper before it for that host (system,
  global, local, and any inherited `GIT_CONFIG_PARAMETERS`, which git places
  before a command's own `-c`), so only rt's helper answers and git's
  `store` reaches nothing else. Every other host keeps the user's helpers.
- `helper` defaults to `poolCredentialHelper()`: `rt git credential` run
  through `rtSelfArgv({ main: <rt's cli.ts> })`, which names the compiled
  binary in the app and `bun --no-env-file --config=<rt's bunfig> cli.ts`
  from source, so the CLI, setup and the daemon (whose `Bun.main` is
  `lib/daemon.ts`) all reach the same CLI entry. `rtSelfHelper` and
  `poolCredentialHelper` move from `lib/worktree/fetch-auth.ts` into
  `lib/team/git-credential.ts` (fetch-auth already imports that module, so
  this avoids an import cycle); fetch-auth re-exports both so its callers do
  not change. Tests pass `helper` explicitly.
- argv carries the helper's path, never the token. The env carries nothing
  new. The helper's argv is quoted with `shellQuote` as today. `shellQuote`
  comes from `lib/herdr-launch.ts`, which imports `lib/ui/out.ts` and
  `lib/subprocess.ts`; `git-credential.ts` is imported low in the graph
  (`forge-token.ts` and others), so the builder confirms no import cycle
  forms (a `bun test` of `forge-token` and `git-credential` plus `bun run
  typecheck`) or takes a dependency-free quote function instead.

The name and signature differ from `gitWithToken` on purpose: the guard test
matches `gitWithToken(`, and the boolean makes a token argument a type error.

### 2. Every call site, its token source, and why the helper reads the same

Each call changes from `gitWithToken(args, token, env, { remote })` to
`gitWithRtCredential(args, token !== null, env, { remote })`, keeping the
token read above it. The table is the proof that the helper serves the same
token. `rt git credential` reads, for the asked host:
`mayOfferToken(https://<host>/..., forgeHost)` and then
`forgeTokenLookupForGit(createRealProbes(), ...)`: rt's sops store, else the
setup stage (`readStagedSecret`), else for GitHub `gh auth token --hostname
github.com`. It runs as git's child, so it has the caller's HOME and
environment.

Source families (the "Src" column):

- **S** `storedForgeToken(p, remote)` (`lib/team/stored-forge-token.ts:25`):
  `storedTokenRefusal` (GitLab hosts must pass `mayOfferGitLabToken`) then
  `forgeTokenLookupForGit(p, remote)`. Same lookup as the helper. Gate: for a
  GitLab host, identical to the helper's; github.com passes both.
- **F** `trustedForgeTokenFor(ctx, remote)`, and `forgeTokenFor` behind a
  caller's own `mayOfferToken` (join, `join.ts:610`)
  (`lib/setup/steps/forge-token.ts`): `forgeTokenLookup` with
  `readSecret(..., ctx.secrets)`, `readStagedSecret(ctx.p)` and the gh
  session. In production `ctx.secrets` is `{ createRealAgeKeySeam(),
  createRealSecretsExecSeam() }` (`commands/setup.ts:205`), the helper's own
  seams. During Install, before `secrets.write` drains the stage, a token the
  person entered exists only in the stage file, which the helper reads in the
  same HOME. After the drain it is in the store, which the helper reads too.
  Gate: `mayOfferToken` against the same confirmed host, as the helper.
- **Fu** `forgeTokenFor(ctx, remote)` with no host gate, at one git site:
  setup's team create publish (`steps/team.ts:84`, `opts.token` into
  `publishTeam`). Same reads as F, but no gate. The gate goes into
  `publishTeam` itself (`lib/team/publish.ts`), so every publish caller
  gets it from one place: it offers only when `opts.token !== null` and the
  token remote passes the helper's gate (`mayOfferGitLabToken` for a GitLab
  key, else `mayOfferToken`, against `confirmedForgeHost(p)`). The gated
  token is computed once at the top of `publishTeam` and used for all four
  of its token uses: `remoteHead` (line 135), `assertOriginTakesNewOrg`
  (line 140), the push (line 148) and `publishPointer` (line 215). Every
  other publish caller already passed that gate, so only Fu changes. Section 4
  covers the difference.
- **P** `forgeTokenLookupFromPresence` over `realSecretPresence()`
  (`lib/setup/plan.ts:259`): store, then stage, then gh session, behind
  `withholdFromUntrustedHost` (`mayOfferToken`). Same reads as the helper.
- **R** `forgeTokenLookupReal` (`readStoredGitHubToken`): store, then stage,
  no gh session. The site offers only when this found a token; the helper
  then finds the same stored or staged token first, so its gh fallback never
  answers there.

| Site | Calls | Src (production) | Process | Pinning test (existing, switched to assert the helper is named iff the seam returns a token) |
|---|---|---|---|---|
| `team/trial-branch.ts` 67, 70, 78, 93, 120 | 5 | S (`opts.readToken ?? storedForgeToken`, `commands/team.ts:723`) | CLI | `lib/team/__tests__/trial-branch.test.ts` (`readToken`) |
| `team/org-data-branch.ts` 153, 232 | 2 | S (`convergeDataBranch` default `storedForgeToken`; daemon `team-snapshots.ts` passes none; setup `org-folder.ts:48`); join passes its own S/F token | CLI, setup, daemon | `org-data-branch.test.ts` (`readToken`), `lib/daemon/__tests__/team-snapshots.test.ts` |
| `team/org-data-branch.ts` 322, 351 | 2 | publish's `opts.token` (row below) | CLI, setup | `org-data-branch.test.ts`, `publish.test.ts` |
| `team/join.ts` 637, 654, 660, 694 | 4 | `mayOfferToken(pointer.remote, confirmedHost) ? seams.forgeToken(...)`: S from `rt team join`, F from setup (`steps/team.ts:159`, token only staged until `secrets.write`) | CLI, setup | `join.test.ts` (`forgeToken`) |
| `team/data-branch-guard.ts` 81, 175 | 2 | S (`opts.readToken ?? storedForgeToken`, `commands/team.ts:1537`) | CLI, daemon | `data-branch-guard.test.ts` (`readToken`) |
| `team/invite.ts` 234 | 1 | S (`seams.forgeToken`, behind `refuseUnconfirmedForgeHost`) | CLI | `invite.test.ts` (`forgeToken`) |
| `team/repo-access.ts` 48 | 1 | P from setup validators (`access.ts:57,115`); `forgeTokenLookupForRemote` (`forgeTokenLookupForGit` plus gate) from join (`join.ts:297`) | setup, CLI | `repo-access.test.ts`, `lib/setup/__tests__/validators-access.test.ts` |
| `setup/home-remote.ts` 120 | 1 | R, only on the REST-create path (github.com); a typed URL offers nothing | setup | `home-remote.test.ts` (`githubToken` hook) |
| `setup/steps/repos.ts` 178 | 1 | F behind `mayOfferToken` (`trustedForgeTokenFor`), token may be staged only | setup | `steps-a.test.ts`, `lib/__tests__/forge-token-for.test.ts` |
| `team/main-pointer.ts` 47, 58 | 2 | handed in by join (S/F), invite (S), data-branch-guard (S), `forge-access-apply.ts:55` (S) | CLI, setup, daemon | `main-pointer.test.ts` |
| `daemon/home-snapshot.ts` 734 | 1 | S (`teamSnapshotSpec`: `opts.readToken ?? storedForgeToken`); the home spec has no `tokenFor` and stays plain | daemon | `home-snapshot.test.ts` (`readToken`) |
| `home/init-exec.ts` 99 | 1 | `mayOfferToken(url, forgeHost)` then S (`exec.cloneToken`) | CLI, setup restore | `init-exec.test.ts` (`cloneToken`) |
| `team/org-pull.ts` 63 | 1 | S (`seams.token ?? storedForgeToken`) | CLI, setup | `org-pull.test.ts` (`token`) |
| `team/publish.ts` 148 | 1 | `opts.token`: S from `rt team publish` (`commands/team.ts:744`), invite, rename, share-pack; Fu from setup's team create (`steps/team.ts:84`); the org identity step's `trustedForgeTokenFor(ctx, tokenLookupRemoteForHost(declared.host))` via `claimPendingAdmin` (`create.ts:157`) | CLI, setup | `publish.test.ts`, `commands/__tests__/team.test.ts` |
| `team/remote-head.ts` 10 | 1 | handed in by publish and rename (S) | CLI, setup | none today; new `lib/team/__tests__/remote-head.test.ts` (GitHub and GitLab remotes) |

`ctx.identity.token` (`lib/setup/apply.ts:62`) is a test seam; production
never sets it.

**New equivalence tests** (the proof the table relies on, in
`lib/team/__tests__/git-credential.test.ts` or a sibling, isolated HOME,
faked secret seams, no real store):

1. Reads: for each of token stored, token staged only (the join and setup
   Install case), GitHub with only a gh session, and nothing held, `S`, `F`
   and `P` over the same faked store, stage and gh session return the same
   token as `gitCredentialReply("get", ...)` does for that host (or all
   return nothing). GitHub and GitLab.
2. Gates: a matrix of each gate in the table (S's `storedTokenRefusal`, the
   `mayOfferToken` gates of F, P, join and init-exec, and Fu's none) against
   the helper's gate, across github.com, gitlab.com, a confirmed GitLab host,
   an unconfirmed GitLab-shaped host, an unrecognised host, and github.com
   asked while only a GitLab token is held. Every row agrees except Fu on the
   unconfirmed GitLab-shaped host, which the test pins as the section 4
   tightening and which `publishTeam`'s gate now turns into "no offer", the
   same answer as the helper.
3. The builder end to end with real git and no network: `git <built argv>
   credential fill` in a temp repo, with `helper` set to a stub script that
   prints a fixed fake credential, and a global config (temp HOME) that names
   a second helper for the same host. The fill returns the stub's answer, the
   second helper is never run, `git credential approve` reaches only the
   stub, a different host gets no answer from the stub, and the child's
   environment holds no token. This replaces the `gitWithToken` real-git
   cases.

### 3. Timing differences

- **Daemon team pull and push** (`home-snapshot.ts`): today the token is read
  once per pull interval (cached, default 300 s, clamped to at least 30 s by
  `clampPullIntervalSec`) and passed to every git call. After: the cached
  read stays as the offer decision (same cadence), and `rt git credential`
  reads the token again each time git asks for one, so a revoked or replaced
  token is picked up at once instead of after the cache expires. Cost: per
  authenticated fetch or push, one helper spawn for `get` and one for
  `store` (`store` returns before any read), plus one store read. At the
  30 s floor that is two spawns and one sops read per team per 30 s; no
  loop pays it per file or per commit.
- **CLI and setup**: one helper spawn and one store read per git call that
  the forge challenges. The most in one verb: trial branch (up to 5) and
  join (4, once). Setup's repo clone is one per repo, beside a network clone
  that dominates. Public remotes never challenge, so they spawn nothing.
- git asks only after a 401, as with the inline helper, so the number of
  network round trips does not change.

### 4. Two gate edges where the helper is stricter

In both, today's path hands a token to a host the person never confirmed for
it, which RT-526's anti-goals forbid. The helper's gate stops that. These are
the only visible differences, and in each the old path could succeed only by
offering a token where rt says it never will. My call. The same gate also
covers the reverse mismatch in `claimPendingAdmin` (a team declaring
github.com or a confirmed GitLab host while its origin is on an unconfirmed
GitLab-shaped host): today that token goes to the unconfirmed origin and can
only fail; after, the push is plain git.

- **Setup's team create publish** (`steps/team.ts:84`, Fu). The remote can be
  one the person typed (`intent.team.remote`, `RT_TEAM_REMOTE`). For an
  https remote on a GitLab-shaped host other than gitlab.com that the person
  has not confirmed with `rt setup gitlab connect --host`, today git gets the
  stored GitLab token, which can be a token for gitlab.com or for another
  confirmed host. After, `publishTeam`'s gate (section 2, Fu) makes the push
  plain git: no rt helper pair, so the person's own helpers for that host
  answer, and the publish fails only if git holds nothing there. A person
  whose token is for that host already confirmed it, since setup offers a
  GitLab token field only for a confirmed host, so their publish is
  unchanged. github.com and gitlab.com remotes are unchanged.

  This can stop a publish that works today: a creator whose stored GitLab
  token happens to be valid on a self-hosted host they never confirmed. The
  shepherd ruled (gate 8634d45b, Matt's pick): tighten, and give that
  failure a remedy that names the fix.

  - `lib/team/publish.ts` exports the one rule both sides read:
    `withheldPublishHost(remote, token, confirmedHost): string | null`,
    the host when `token !== null`, the remote is https, its token key is
    `gitlabToken` and `mayOfferGitLabToken` refuses it; else null.
    `publishTeam`'s gate is `withheldPublishHost(...) === null` plus the
    `mayOfferToken` check for a GitHub key, so the gate and the remedy can
    never disagree.
  - `lib/setup/steps/team.ts` (`teamCreateRun`): when `publishTeam` throws a
    `UserActionableError` and `withheldPublishHost(created.remote, token,
    confirmedForgeHost(ctx.p))` names a host, the outcome is `failed` with
    today's `detail` (`err.message`) and the remedy `Confirm <host> as your
    GitLab host, then Retry. Run rt setup gitlab connect --host <host>`. Two
    codes take it: `push-denied`, and `team-pull-only`, because on a private
    repo the first git call to ask for credentials is `remoteHead`'s
    `ls-remote`, which publish reports as `team-pull-only` before any push.
    Every other code, and every remote with no withheld host, keeps today's
    remedy byte for byte. The wording follows rt:ui-copy (a state, then
    the fix) and the setup output rules: the command is the last words,
    as in `steps/org.ts`'s "Run rt team publish".
  - Tests first, in `lib/setup/__tests__/steps-a.test.ts`: a create intent
    whose remote is an unconfirmed GitLab-shaped https host with a GitLab
    token held, git answering an auth failure, for both codes, asserting the
    new remedy; the same with the host confirmed, and with no token, asserting
    today's remedy. The existing github.com `push-denied` test stays as is.
    `commands/__tests__/setup-copy.test.ts` pins no step remedy, and no e2e
    or pty file covers this string.

  Pinned also by equivalence test 2 (the gate row) and a `publish.test.ts`
  case: a GitLab token, an unconfirmed GitLab-shaped `tokenRemote`, and a
  plain argv with no helper pair. The report and PR body name this change.
- **The org identity step's publish** (`steps/org.ts:117` via
  `claimPendingAdmin`). It looks the token up by the team's declared forge
  host and offers it to the clone's origin. When a team declares a GitLab
  host while its origin is on github.com, today rt offers the GitLab token to
  github.com, which fails. After, the helper answers with github.com's own
  token (stored, staged or the gh login), so that publish can now succeed.
  A person can see this: a publish that failed now works. Pinned by a
  `publish.test.ts` case: `tokenRemote` on github.com with a token in hand,
  asserting the helper pair is named for github.com only.

### 5. The exemptions list and the guard

`lib/__tests__/token-env-exemptions.json` becomes `[]`: every caller moves,
and `lib/team/git-credential.ts` no longer defines `HOST_HELPER` or reads
`RT_GIT_TOKEN`. The guard test stays as is; its "exempt file with no lines"
test already rejects a stale entry. Each moved file's tests stop reading
`env.RT_GIT_TOKEN` and assert instead that argv names the helper for the
remote's host and that no env value equals the fake token.

### 6. Docs

`sites/docs/` pages that describe git auth are checked (rt:docs). The
change is internal, so a page is edited only if it says rt passes the token
through the environment.

## Also noted (from the ticket)

- `branch_sync` has no retry for its preflight fetch: `lib/mcp/git-tools.ts`
  is outside this change's files. Listed in the report, not fixed.
- `originFetchAuth`'s `git remote get-url` inherits `GIT_DIR`
  (`lib/worktree/fetch-auth.ts`): under a caller that exports `GIT_DIR` or
  `GIT_WORK_TREE`, the lookup reads that repo's origin instead of `cwd`'s, so
  the helper pair can be scoped to the wrong host. The helper's own gate still
  decides at ask time, so the worst case is a missed or useless retry, not a
  token sent to the wrong host. The spec review ruled it out of scope (it is
  the pool's retry wiring, not the token-in-env goal). Listed in the report
  for its own ticket, with a test that sets `GIT_DIR` to a second repo.

## Constraints

- Tests: isolated HOME (`test-setup.ts`), temp git repos, `file://` remotes
  or stub helpers, fake tokens only; never the real `~/.gitconfig`,
  `~/.mattstack` or `packages/glance/harness_credentials.json`; no live
  forge; no run of rt, the daemon or a built binary against the real HOME.
- Run from the worktree root: targeted `bun test` for every touched file and
  its tests, `lib/__tests__/no-token-in-git-env.test.ts`, `bun run
  typecheck`, `bun run purity`. The one output string added is the setup
  remedy in section 4, which no e2e or pty file covers; if another changes,
  its covering file runs.
- `lib/__tests__/no-raw-output.test.ts` and the clean-code comment rule
  apply.
- Write fence: `lib/team/`, `lib/setup/home-remote.ts`,
  `lib/setup/steps/repos.ts`, `lib/setup/steps/team.ts` (added by gate
  8634d45b, for the section 4 remedy only), `lib/daemon/home-snapshot.ts`,
  `lib/home/init-exec.ts`, `commands/git/`, the helper's lib code
  (`lib/worktree/fetch-auth.ts`, only for the move and re-exports in section
  1), the exemptions list and guard test, those files' tests (they include
  `commands/__tests__/team.test.ts`, `lib/setup/__tests__/steps-a.test.ts`,
  `lib/setup/__tests__/validators-access.test.ts` and
  `lib/setup/__tests__/home-remote.test.ts`, which read `RT_GIT_TOKEN` today),
  and `sites/docs/` git auth pages. `lib/skills/__tests__/origin-git.test.ts`
  asserts `RT_GIT_TOKEN` is undefined and keeps passing untouched.

## Left to the builder

- Test layout, as long as each anti-goal has a test that fails if it breaks.
- Whether the equivalence tests live in `git-credential.test.ts` or a new
  file under `lib/team/__tests__/`.
- Order of the call-site moves (one commit per file or per family).
