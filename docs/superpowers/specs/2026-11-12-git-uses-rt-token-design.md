# git and the forge CLIs use the token rt holds (RT-526)

## Intent

People give rt their GitLab (or GitHub) token and expect everything rt does
on that forge to use it. Two paths still do not:

- `rt sync`'s fetch and push, and `git_push`, use the clone's own git auth.
  On an HTTPS clone with no credential helper of its own, they fail even
  though rt holds a token. Only clones rt itself made name `rt git credential`
  as their helper (`lib/setup/steps/repos.ts`, `cloneInto`).
- `rt sync`'s stack check runs `glab mr list` (or `gh pr list`) with no token,
  so it needs a separate CLI login and otherwise warns "rt could not check
  whether this branch is part of a stack".

A teammate hit both and could not tell why the token they gave rt was not
used. Success: on a Mac where only rt was given a token, `rt sync` checks the
stack, fetches and pushes; and a person can, by one explicit command, make
every git on a clone (`git_push` included) use rt's token.

This is a security change: it decides how a credential reaches git.

## State of main (verified 2026-11-12 at 2e68600d0)

- Stack check: not done. `lib/stack-guard.ts` `listGitlab` passes
  `glabEnv(host)` (no token); `listGithub` passes no env at all.
- HTTPS clones under `rt sync`: not done. `fetchOrigin`
  (`commands/git/shared.ts`) runs a plain `git fetch origin`; the push in
  `syncBranch` (`commands/sync.ts`) runs a plain `git push`. The token retry in
  `lib/worktree/fetch-auth.ts` (`runGitOrigin`) covers only the pool and
  daemon fetches.
- SSH clones: partly done. `fetchOrigin` stops with "no SSH key is loaded"
  and suggests `ssh-add`; it never offers HTTPS. When an agent holds a key and
  origin still refuses, it prints git's raw failure.
- No-token-in-config: holds today. `rt git credential` reads the token at
  call time; `gitWithToken` passes it through env, never argv or a URL.

## Goals

1. `rt sync` fetches and pushes with rt's token on an HTTPS clone whose own
   auth fails, without writing anything.
2. A new opt-in verb, `rt git auth`, makes the clone use rt's token for every
   git (helper in `.git/config`, never the token), and on an SSH clone can
   switch origin to HTTPS.
3. `rt git auth --check` lists the registered clones that would benefit, with
   the command for each. Read-only, no network.
4. The stack check passes rt's stored token to glab and gh, falling back to
   the CLI's own login when rt holds none or may not offer it.
5. An SSH auth failure under `rt sync` names the SSH key as the cause and, when
   rt could authenticate over HTTPS, offers the switch.
6. GitLab and GitHub both (same mechanism; decided through herd_ask).

## Non-goals

- `git_push` code (`lib/mcp/git-tools.ts`) does not change. It benefits only
  through the helper `rt git auth` writes.
- No setup row, no tray change, no change to `lib/setup/validators/accounts.ts`,
  `lib/setup/form.ts` or `rt-tray/`.
- No change to how rt-made clones are wired, or to the pool and daemon fetch
  path beyond reusing its helpers.
- GitLab behaviour otherwise does not change.

## Anti-goals (a failure even if it works)

- A token in git config, a URL, argv, a log line, an error message or a
  `--json` envelope.
- The token offered to any host other than github.com, gitlab.com or the host
  the person confirmed (`rt.integrations.forgeHost`), including after an HTTP
  redirect, over cleartext http, or to a submodule or push URL on another host.
- A GitLab token offered to github.com, or a GitHub token to a GitLab host.
- rt changing a clone's config or origin URL without the person agreeing in
  that run (a y/n at a terminal, or `--yes`).
- git's `store` handing rt's token to another helper (the macOS keychain).
- Using `@{u}` anywhere.

## Approaches considered

1. **Env-only fallback in sync plus an opt-in verb (picked).** `rt sync`
   retries once with rt's helper passed through `GIT_CONFIG_*` env; a separate
   `rt git auth` writes the helper into the clone only when asked. Sync works
   with no write; the permanent fix is one explicit command.
2. Ask inline in `rt sync` and `rt repos register`. Consent lands where the
   failure happens, but sync gains an interactive branch mid-run and agents
   get a different path anyway.
3. Env-only fallback and never write. Smallest, but leaves `git_push`, plain
   git and the ticket's register and doctor parts undone.

For SSH, `rt git auth --https` (one verb owns every config change rt makes to
a clone) was picked over a separate `use-https` verb and over a prompt inside
`rt sync`. For the doctor check, `rt git auth --check` was picked over a
non-blocking setup row (tray contract, and another lane is editing setup) and
over no check at all.

## Design

### 1. The token reaches git only through rt's helper

Every path in this design hands git `rt git credential` as the helper for one
host, never the token:

- the persistent form writes, in the clone's `.git/config`, two values for
  `credential.https://<host>.helper`: an empty one (clears every helper before
  it for that host, so `store` cannot reach the keychain) and
  `rtCredentialHelper(<rt link>)` (from `lib/setup/steps/repos.ts`, where
  `<rt link>` is `linkPath(home, "rt")`, the same stable path rt-made clones
  name);
- the one-run fallback in `rt sync` passes the same two values as
  `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` env, appended
  after any `GIT_CONFIG_*` pairs already in the environment (never clobbering
  them), with the helper naming the running rt (`rtSelfArgv()`, shell-quoted).

So the token is in no env var either: it exists only in the helper's stdout
to git. A pre-push hook sees no token.

The helper (`commands/git/credential.ts`) already answers only `get`, only
`protocol=https`, only for a host that passes `mayOfferToken` against the
confirmed host, and reads the token at call time. This design adds tests that
pin it: empty reply for another host, for `protocol=http`, for `store` and
`erase`, and for a GitLab host that is not confirmed. A redirect to another
host is covered twice: git looks up `credential.<url>.helper` by the URL it is
authenticating, so the per-host key never matches another host, and the helper
re-checks the host it is asked about.

Before rt offers the fallback or writes the helper it checks, in this order:
origin's effective URL (`git remote get-url [--push] origin`, which applies
`insteadOf`) is `https://`; its host passes `mayOfferToken` (and, for a GitLab
token, `mayOfferGitLabToken`); rt holds a token for it
(`forgeTokenLookupForGit`, the same read the helper does). Any miss means rt
has nothing to add and git's own result stands.

### 2. `rt sync`: one retry through rt's helper

`fetchOrigin` (`commands/git/shared.ts`): when the fetch fails and the output
is an HTTPS auth failure (`isAuthFailure` from `lib/worktree/fetch-auth.ts`),
build the helper env (section 1) and retry once. On success it returns that
env, as it already returns the env a fetch succeeded under, so the push uses
it too. On a second auth failure the failure says rt's token was refused too
("Could not fetch from origin: the forge refused rt's token as well"), with
`why` naming the host and `next` naming `rt setup gitlab connect` (or the
GitHub equivalent) to replace the token. The token never appears in it.

The push in `syncBranch` (`commands/sync.ts`): when the fetch succeeded
without rt's help but the push fails on an HTTPS auth failure (a separate push
URL, or read-only credentials), retry once the same way, checking the push URL
(`get-url --push`).

After a sync that needed the fallback and finished, a non-quiet sync prints
one note after its last progress line:
`info  rt used its <forge> token for this sync` with
`next  To use it for every git on this clone, run rt git auth`. A quiet
(`--json`) sync prints nothing extra; a failed sync prints no note after its
failure (`compactFailure` and `branch_sync` read the last stderr lines).
Copy goes through rt:ui-copy.

The ssh-agent retry and the HTTPS retry are independent: the first runs only
on an SSH auth failure, the second only on an HTTPS auth failure.

### 3. `rt sync`: SSH failures say so and offer HTTPS

An SSH auth failure (`looksLikeSshAuthFailure`) on fetch, or on push, ends in
a failure that names the SSH key:

- no agent holds a key (today's case): title stays "Could not fetch from
  origin: no SSH key is loaded";
- an agent holds a key and origin still refused (today a raw failure): "Could
  not fetch from origin: the forge refused your SSH key".

`next` lists `ssh-add` (only in the first case) and then
`rt git auth --https`, the second only when origin's SSH URL maps to an HTTPS
URL whose host passes the checks in section 1 and rt holds a token for it.
With no usable token, only the SSH advice shows. `details` keep git's own
output, through `printable` where a URL is shown.

### 4. `rt git auth [path] [--https] [--check] [--yes] [--json]`

New file `commands/git/auth.ts`, registered under `rt git` in
`lib/command-tree-def.ts` and `lib/module-registry.ts` (named here because a
verb needs them; no other change there). Path defaults to the current
directory's repo root. Output through `lib/ui/out.ts`; refusals through
`refuseWith`; failures through `failWith` / `failPlain`.

**Plain form, HTTPS origin.** Runs the section 1 checks. If rt is already the
clone's sole effective helper for that host, prints `done  <repo> already
uses rt's <forge> token` and exits 0. Otherwise it shows what it will write
(the key, and that it replaces the clone's own helpers for that one host in
this clone only), asks y/n at a terminal (`confirm` from `lib/rt-render.ts`),
and on yes writes the two config values with `git -C <root> config --add`.
Without a terminal it refuses unless `--yes`. The done line names the
`git config --unset-all credential.https://<host>.helper` command that
undoes it. Refusals, each with why: not a git repo; no origin; origin is
`http://`; host not confirmed (next: `rt setup gitlab connect --host <host>`);
rt holds no token for the host (next: connect the forge); no rt link at
`linkPath(home, "rt")` (the app is not installed); origin is SSH (next:
`rt git auth --https`).

**`--https`, SSH origin.** Maps origin's SSH URL to HTTPS
(`git@host:path(.git)` and `ssh://[user@]host[:port]/path(.git)` become
`https://host/path.git`; an SSH host alias the forge detection cannot map is
refused, saying so). Runs the section 1 checks against the HTTPS URL. The
confirm shows the old and new URL. On yes: `git remote set-url origin <https>`;
if `remote.origin.pushurl` is set and is the SSH form of the same repo, it is
rewritten too, and a pushurl naming anything else is left alone and the done
line says so; then the helper is written as in the plain form. After the
rewrite, if `git remote get-url origin` is not the HTTPS URL (an `insteadOf`
in the user's config maps it back), rt says so and names the rule; it does not
touch global config. `--https` on an HTTPS origin behaves as the plain form.

**`--check`.** Reads the repo index (`loadRepoIndexEntries`, `lib/repo-index.ts`)
and, for each registered checkout that exists, origin's URL and local
credential config. No network, no write, no prompt. Each repo gets one row:

| State | Shown as | next |
|---|---|---|
| HTTPS, rt is the sole helper for the host | `done` | none |
| HTTPS, rt not wired, token held, host confirmed | `pending` "uses its own git credentials" | `rt git auth <path>` |
| SSH, token held for the mapped HTTPS host | `off` "uses SSH" | `rt git auth --https <path>` |
| no token, unconfirmed host, http, no origin, not a forge | `skipped` with the reason | none |

`--json` emits `{ ok: true, repos: [{ path, label, state, transport, host, next? }] }`;
the token presence is a state, never a value. Exit 0 whatever the states.

The token-presence read in `--check` uses the same lookup as the helper; an
unreadable store reads as `skipped` "rt could not read its token store", never
as absent.

### 5. `rt repos register` points at it

After a successful human-mode register (`commands/repos.ts`), for each
registered checkout whose state under the `--check` rules is `pending`, print
one note with `next  rt git auth <path>`. `--json` output does not change.
Nothing is written.

### 6. Stack check passes rt's token

`createStackGuardRunners` (`lib/stack-guard.ts`) gets a token seam. For a
GitLab origin: when `mayOfferGitLabToken(remote, confirmedHost)` and rt holds
a GitLab token, glab runs with `forgeAuthEnv("gitlab", host, token)`; else
with `glabEnv(host)` as today (glab's own login). For a GitHub origin: only
when the host is github.com and rt holds a GitHub token (stored, staged or the
gh session, as `forgeTokenLookupForGit` reads), gh runs with
`forgeAuthEnv("github", host, token)` (`GH_TOKEN`); else as today. A token
lookup that throws falls back to the CLI's own login. The token is read once
per sync, not per listing. Failure text from glab or gh passes through
`redactCredentials` before it reaches a refusal hint.

### 7. Docs

The sites/docs page that covers `rt sync` gets a short "How rt sync signs in"
section, and the rt CLI reference gains `rt git auth` (rt:docs).

## Constraints

- Output: `.claude/rules/output-layer.md` and `output-git-verbs.md`. Sync's API
  never prints a failure; it returns `failure` and the caller draws it.
  `rt sync --json` stdout stays the payload; the final failure stays last on
  stderr in at most three lines.
- `lib/__tests__/no-raw-output.test.ts`: no console or raw stream writes.
- Command-tree rules (`.claude/rules/command-tree.md`): plain-language
  description for the new verb, and the picker conformance test.
- Tests use an isolated HOME and temp git repos with `file://` or fake
  remotes; no live forge, no real `~/.gitconfig`, no real `~/.mattstack`. The
  token and helper are faked through seams; no test runs the compiled rt.
- The e2e or pty file that covers a changed sync string is run.
- No `@{u}`.

## Left to the builder

- The exact copy of each new line (through rt:ui-copy), within the shapes
  above.
- How the helper-env builder is shared between `fetchOrigin`, the push retry
  and `rt git auth` (a small module under `commands/git/` or an addition to
  `lib/worktree/fetch-auth.ts`, both inside the write fence).
- How "rt is the sole effective helper" is read (`git config
  --get-urlmatch` or `--get-all` on the per-host key, after the last empty
  value).
- Test layout, as long as each anti-goal has a test that would fail if it
  were broken.
