# Token env cleanup (RT-575) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every git call that hands git a forge token through `RT_GIT_TOKEN` (`gitWithToken`) names `rt git credential` instead, and `gitWithToken` is deleted.

**Architecture:** A new builder `gitWithRtCredential(args, offer, env, opts)` in `lib/team/git-credential.ts` adds `-c credential.https://<host>.helper=` then `-c credential.https://<host>.helper=<rt git credential>` when `offer` is true. Each call site keeps its existing token lookup and gate as the offer decision (`token !== null`) and stops passing the token to git. `publishTeam` gains the helper's host gate; setup's team create gets one new remedy for the host it now withholds from.

**Tech Stack:** Bun, TypeScript, `bun:test`, real `git` in temp dirs for the end to end case.

**Spec:** `docs/superpowers/specs/2026-11-14-token-env-cleanup-design.md` (read it whole first; section numbers below refer to it).

## Global Constraints

- Write fence: `lib/team/`, `lib/setup/home-remote.ts`, `lib/setup/steps/repos.ts`, `lib/setup/steps/team.ts` (section 4 remedy only), `lib/daemon/home-snapshot.ts`, `lib/home/init-exec.ts`, `commands/git/`, `lib/worktree/fetch-auth.ts` (move and re-export only), `lib/__tests__/token-env-exemptions.json`, `lib/__tests__/no-token-in-git-env.test.ts`, the tests of all of those, `sites/docs/` git auth pages. Nothing else.
- A token never appears in argv, a URL, git config, any child's env, a log, an error, test output or a committed fixture. Tests use fake tokens (`tok_rt`, `glpat_fake`) only.
- No live forge calls. No `git config --global` outside a temp HOME. Never read or stage `packages/glance/harness_credentials.json`. Never run rt, the daemon or a built binary against the real HOME.
- Run every `bun test` from the worktree root (`/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/bilbo`), never a subdirectory.
- GitHub and GitLab both covered in every test group that touches a host.
- No em or en dashes in code, comments, tests or commit messages. Comments only for a constraint the code cannot show.
- Stage named files only (`git add <path> ...`), never `-A` or `.`. Commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The guard (`lib/__tests__/no-token-in-git-env.test.ts`) must pass after every task: when a task removes a file's last `gitWithToken(` line, it deletes that file's entry from `token-env-exemptions.json` in the same commit; a partial move lowers the entry's `lines` to the new count.
- No `--json` field, setting or setup row changes. The only new output string is the section 4 remedy (Task 6).

## Review Focus

1. A remote URL with credentials or odd casing (`HTTPS://GitLab.Example.com/...`, `https://user@host/...`): the helper pair must key on the same lowercased host `hostFromRemote` gives, never on raw URL text. Pinned in Task 1.
2. A caller whose env already carries `GIT_CONFIG_PARAMETERS` naming another helper (an alias or hook above rt): the builder's `-c` pair comes after it, so the empty value still clears it. Pinned by the real-git case in Task 1.
3. The daemon's cached offer decision going stale after the token is revoked: git asks the helper, which reads afresh, so a revoked token yields plain failure, not a stale token. Pinned in Task 9.
4. `home/init-exec` with rt's token rejected and git's own credentials good: the retry with plain git must still run once the env no longer carries the token. Pinned in Task 9 (existing `gho_other_account` case on `offered`).
5. The setup create remedy firing on a GitHub or confirmed GitLab remote: it must fire only for a withheld host. Pinned in Task 6.

---

### Task 1: The builder, its helper move, and a test helper

**Files:**
- Modify: `lib/team/git-credential.ts` (add builder, move `rtSelfHelper`, `poolCredentialHelper`, `CLI_ENTRY`; keep `gitWithToken` until Task 10)
- Modify: `lib/worktree/fetch-auth.ts:39-49` (delete the moved code, keep `type GitRunner` at line 37; `import { poolCredentialHelper, rtSelfHelper } from "../team/git-credential.ts"` since lines 61 and 138 still call them, plus `export { poolCredentialHelper, rtSelfHelper }`; drop the now unused `join`, `shellQuote` and `rtSelfArgv` imports)
- Create: `lib/team/__tests__/rt-credential-argv.ts` (test helper, no tests in it)
- Test: `lib/team/__tests__/git-credential.test.ts`

**Interfaces:**
- Produces (git-credential.ts):
  - `export interface GitWithRtCredential { argv: string[]; env: Record<string, string>; offered: boolean }`
  - `export function gitWithRtCredential(args: string[], offer: boolean, env: Record<string, string>, opts: { remote: string | null; helper?: string }): GitWithRtCredential`
  - `export function rtSelfHelper(argv?: string[]): string` and `export function poolCredentialHelper(): string` (moved verbatim; `CLI_ENTRY` becomes `join(import.meta.dir, "..", "..", "cli.ts")` from `lib/team/`, the same file)
- Produces (rt-credential-argv.ts, for every later task's tests):
  - `export function rtHelperHost(argv: string[]): string | null`: the host when `argv` is `["git", "-c", "credential.https://H.helper=", "-c", "credential.https://H.helper=!<...> git credential", ...]` with the same `H` both times; null when argv starts `["git", <not "-c">...]`; throws on a half pair or mismatched hosts.
  - `export function expectNoToken(env: Record<string, string> | undefined, token: string): void`: asserts no env value contains `token` and no `RT_GIT_*` key exists.

- [ ] **Step 1: Write the failing tests** in a new `describe("gitWithRtCredential")` in `git-credential.test.ts`:
  - `offer true on https github.com: helper pair for github.com, env unchanged, offered true`: `gitWithRtCredential(["fetch"], true, { A: "1" }, { remote: "https://github.com/acme/app.git", helper: "!stub" })` equals `{ argv: ["git", "-c", "credential.https://github.com.helper=", "-c", "credential.https://github.com.helper=!stub", "fetch"], env: { A: "1" }, offered: true }`.
  - Same for `https://gitlab.example.com/acme/app.git` (host `gitlab.example.com`) and `HTTPS://GitLab.Example.com/acme/app.git` (host `gitlab.example.com`, Review Focus 1) and `https://oauth2@gitlab.com/acme/app.git` (host `gitlab.com`).
  - `test.each` of ssh scp, `http://github.com/...`, a local path, `null`: `{ argv: ["git", "fetch"], env: { A: "1" }, offered: false }`.
  - `offer false on https: plain git, offered false`.
  - `the default helper is rt git credential from rt's CLI entry`: `rtHelperHost(gitWithRtCredential(["fetch"], true, {}, { remote: "https://github.com/a/b.git" }).argv)` is `"github.com"` and argv[4] ends with ` git credential` and contains `cli.ts` (source run).
  - Real git, no network (spec section 2, equivalence test 3), modelled on `commands/git/__tests__/credential.test.ts`'s first case: temp HOME, `GIT_CONFIG_GLOBAL` naming a logging helper for every host, `GIT_CONFIG_NOSYSTEM=1`, and `GIT_CONFIG_PARAMETERS="'credential.helper=<logger>'"`; a stub helper script printing `username=x-access-token` / `password=tok_rt`. With `helper: "!<stub path>"` on `https://gitlab.example.com/acme/app.git`: `git <argv> credential fill` with `protocol=https\nhost=gitlab.example.com\n\n` returns `password=tok_rt`; `git <argv> credential approve` with that answer leaves the logger's log empty; `fill` for `host=github.com` does not contain `tok_rt`; the child env passed holds no `tok_rt`. Repeat the fill for `github.com` as the remote.
  - `the guard pattern does not match the builder`: `/\bgitWithToken\s*\(/` does not match the string `gitWithRtCredential(`.

- [ ] **Step 2: Run** `bun test lib/team/__tests__/git-credential.test.ts`. Expected: FAIL, `gitWithRtCredential` not exported.

- [ ] **Step 3: Implement** `gitWithRtCredential` in `git-credential.ts` using the same `https` test and `hostFromRemote` as `gitWithToken`; move `rtSelfHelper`, `poolCredentialHelper`, `CLI_ENTRY` and the `shellQuote` and `rtSelfArgv` imports from `fetch-auth.ts`, which re-exports the two functions. Confirm no import cycle: `bun test lib/team/__tests__/git-credential.test.ts lib/__tests__/forge-token-for.test.ts lib/worktree/__tests__/fetch-auth.test.ts` and `bun run typecheck` pass; if `lib/herdr-launch.ts` pulls a cycle in, copy `shellQuote` into `git-credential.ts` as a private function instead and have `herdr-launch.ts` untouched.

- [ ] **Step 4: Run** `bun test lib/team/__tests__/git-credential.test.ts lib/worktree/__tests__/ commands/git/__tests__/ lib/__tests__/no-token-in-git-env.test.ts` and `bun run typecheck`. Expected: PASS. (The guard is unchanged: `git-credential.ts` still has its 3 lines.)

- [ ] **Step 5: Commit** `git add lib/team/git-credential.ts lib/worktree/fetch-auth.ts lib/team/__tests__/rt-credential-argv.ts lib/team/__tests__/git-credential.test.ts` with message `add gitWithRtCredential, move the rt git credential helper into git-credential.ts`.

### Task 2: Equivalence tests for reads and gates

**Files:**
- Create: `lib/team/__tests__/rt-credential-equivalence.test.ts`

**Interfaces:**
- Consumes: `gitCredentialReply(op, input, deps)` (`commands/git/credential.ts`), `forgeTokenLookup` / `tokenOrNull` / `mayOfferToken` / `mayOfferGitLabToken` / `storedTokenRefusal` / `tokenLookupRemoteForHost` (`lib/team/forge-token.ts`).

- [ ] **Step 1: Write the tests** (spec section 2, equivalence tests 1 and 2). These pin today's behaviour, so they pass on first run; a failure means the spec's claim is wrong: stop and report it, do not adjust the assertion.
  - Reads: a fake store, stage and gh session as `ForgeTokenSeams`. For each of {stored only, staged only, gh session only, none} x {`https://github.com/acme/app.git`, `https://gitlab.com/acme/app.git`}: the token from `tokenOrNull(await forgeTokenLookup(remote, seams))` (the S, F and P reads all reduce to this call with different seams; P passes `readStaged: () => null` over a presence that already folded the stage, so also run P's shape: `readStored` answering stored-then-staged, `readStaged: () => null`) equals the password in `gitCredentialReply("get", "protocol=https\nhost=<host>\n\n", { confirmedHost: () => null, lookupStored: async (r) => tokenOrNull(await forgeTokenLookup(r, seams)) })`, or both are empty. The gh-only GitLab row yields nothing on both sides.
  - Gates: a table over hosts {`github.com`, `gitlab.com`, `gitlab.acme.dev` confirmed, `gitlab.other.dev` unconfirmed (GitLab-shaped), `example.org` unrecognised} with confirmed host `gitlab.acme.dev`, plus the row "github.com remote while only a GitLab token is held". (A host must contain `gitlab.` for `forgeTokenKey` to name `gitlabToken`; a non-GitLab-shaped confirmed host would skip the GitLab path.) Each row's result is "the token reaches git": the site's gate passes AND `forgeTokenKey(remote)` names a key the fake store holds a token for (so an unrecognised host like `example.org` is "no offer" on every side, since no key exists). The helper side is a non-empty `gitCredentialReply` with a lookup over that same store. For each row the helper's result equals the F, P, join and init-exec sites' (`mayOfferToken(remote, confirmed)` plus the key rule) and S's (`storedTokenRefusal(remote, confirmed) === null` plus the key rule). The Fu row ("no gate" plus the key rule) disagrees only on `gitlab.other.dev`: assert that disagreement explicitly, with a comment-free test name `Fu offers to an unconfirmed GitLab-shaped host and the helper does not (section 4)`.

- [ ] **Step 2: Run** `bun test lib/team/__tests__/rt-credential-equivalence.test.ts`. Expected: PASS.

- [ ] **Step 3: Commit** `git add lib/team/__tests__/rt-credential-equivalence.test.ts` with message `pin that rt git credential reads and gates as every token call site does`.

### Task 3: Sites that read rt's stored token themselves

**Files:**
- Modify: `lib/team/trial-branch.ts:15,67,70,78,93,120`, `lib/team/data-branch-guard.ts:15,81,175`, `lib/team/org-pull.ts:14,63`, `lib/team/invite.ts:5,234`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop the four entries)
- Test: `lib/team/__tests__/trial-branch.test.ts`, `lib/team/__tests__/data-branch-guard.test.ts`, `lib/team/__tests__/org-pull.test.ts`, `lib/team/__tests__/invite.test.ts`

**Interfaces:**
- Consumes: `gitWithRtCredential`, `rtHelperHost`, `expectNoToken` (Task 1).

- [ ] **Step 1: Switch the tests first.** Every assertion that reads `env.RT_GIT_TOKEN` (or the inline helper) becomes: `rtHelperHost(argv)` equals the remote's host when the token seam returned a token, `null` when it returned null; `expectNoToken(env, <fake token>)`. Each file gains one GitLab case (`https://gitlab.com/acme/mattstack-team-acme.git`) beside its GitHub case if it has none. Tests that pass `readToken` / `forgeToken` / `token` keep doing so.
- [ ] **Step 2: Run** the four test files. Expected: FAIL on the helper assertions.
- [ ] **Step 3: Replace** each `gitWithToken(args, token, ENV, { remote })` with `gitWithRtCredential(args, token !== null, ENV, { remote })` (org-pull: `secret !== null`), keeping every lookup and gate above it. Drop the four exemption entries.
- [ ] **Step 4: Run** the four test files, `lib/__tests__/no-token-in-git-env.test.ts`, `commands/__tests__/team.test.ts`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the nine named files: `trial branch, data branch guard, org pull and invite name rt git credential`.

### Task 4: Helpers that take a token from their caller

**Files:**
- Modify: `lib/team/org-data-branch.ts:13,153,232,322,351`, `lib/team/main-pointer.ts:6,47,58`, `lib/team/remote-head.ts:2,10`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop three entries)
- Test: `lib/team/__tests__/org-data-branch.test.ts`, `lib/team/__tests__/main-pointer.test.ts`, `lib/daemon/__tests__/team-snapshots.test.ts` (run only, change only if it asserts the env), Create: `lib/team/__tests__/remote-head.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: unchanged signatures. `remoteHead(p, dir, target, ref, token: string | null, remote: string | null)`, `assertOriginTakesNewOrg(..., token, remote)` and `publishPointer(...)` keep `token: string | null`; the token is now only the offer signal. Task 5 relies on this.

- [ ] **Step 1: Tests first.** Switch existing env assertions as in Task 3. New `remote-head.test.ts` with a fake `p.exec` that records argv and env and answers `ls-remote` output: `a token on a GitHub remote names the helper for github.com`, `a token on a GitLab remote names the helper for gitlab.com`, `no token: plain ls-remote`, `the env holds no token` (`expectNoToken`), and the existing parse cases (`no row: sha null`, `two rows: not ok`, `a row for another ref: not ok`).
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Replace** each `gitWithToken(..., token, ...)` with `gitWithRtCredential(..., token !== null, ...)`. Drop three exemption entries.
- [ ] **Step 4: Run** the four test files above plus `lib/team/__tests__/publish.test.ts`, `lib/team/__tests__/join.test.ts`, the guard, `bun run typecheck`. Expected: PASS except `publish.test.ts` / `join.test.ts` cases that still read `RT_GIT_TOKEN` from these helpers' calls: switch those assertions here (helper host plus `expectNoToken`), not their production code.
- [ ] **Step 5: Commit** the named files: `org data branch, main pointer and remote head name rt git credential`.

### Task 5: The publish gate

**Files:**
- Modify: `lib/team/publish.ts:8,135,140,148,215`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop `lib/team/publish.ts`)
- Test: `lib/team/__tests__/publish.test.ts`, `commands/__tests__/team.test.ts`, `lib/team/__tests__/rt-credential-equivalence.test.ts`, `lib/setup/__tests__/steps-a.test.ts:568-590` (the setup create publish push test)

**Interfaces:**
- Consumes: Tasks 1 and 4; `confirmedForgeHost(p)` (`lib/team/stored-forge-token.ts`); `forgeTokenKey`, `mayOfferToken`, `mayOfferGitLabToken`, `hostFromRemote`.
- Produces: `export function withheldPublishHost(remote: string, token: string | null, confirmedHost: string | null): string | null` in `lib/team/publish.ts`: the lowercased host when `token !== null`, `remote` starts `https://` (case-insensitive), `forgeTokenKey(remote) === "gitlabToken"` and `!mayOfferGitLabToken(remote, confirmedHost)`; else null. Task 6 imports it.

- [ ] **Step 1: Tests first** in `publish.test.ts` (fake home via the probes, so `confirmedForgeHost(p)` reads the test's settings):
  - `withheldPublishHost` unit table: GitLab token on `https://gitlab.acme.dev/a/b.git` unconfirmed returns `"gitlab.acme.dev"`; same host confirmed returns null; `https://gitlab.com/...` null; `https://github.com/...` null; `http://gitlab.acme.dev/...` null; token null returns null.
  - `setup create's publish to an unconfirmed GitLab-shaped host is plain git` (section 4, Fu): `opts.token: "glpat_fake"`, `tokenRemote: "https://gitlab.acme.dev/acme/mattstack-team-acme.git"`, no confirmed host: the push, the `ls-remote` from `remoteHead`, and (when a pointer is pending) the pointer push all have `rtHelperHost(argv) === null`.
  - Same remote with `gitlab.acme.dev` confirmed: all of them name the helper for `gitlab.acme.dev`.
  - `a GitLab token with a github.com origin names github.com's helper` (section 4, org identity): `token: "glpat_fake"`, `tokenRemote: "https://github.com/acme/mattstack-team-acme.git"`: helper host `github.com` on every authed call.
  - `the reverse mismatch is plain git`: token held, `tokenRemote` on unconfirmed `gitlab.acme.dev` while the confirmed host is `git.acme.dev`: plain argv.
  - Existing cases that read `RT_GIT_TOKEN` switch to `rtHelperHost` plus `expectNoToken`; `commands/__tests__/team.test.ts` likewise; `steps-a.test.ts`'s `the push offers the staged forge token through an inline helper, never in argv` becomes `rtHelperHost(push.argv) === "github.com"` plus `expectNoToken(push.env, "ghp_staged")`, renamed to `the push names rt git credential for the staged forge token, never in argv or env`.
  - Equivalence test 2 gains a `publishTeam` row under the same "token reaches git" rule, with the token being the caller's (`opts.token`): it agrees with the helper on every host except "github.com remote while only a GitLab token is held" (the org identity edge). Assert that row as the section 4 difference, not agreement: `publishTeam` offers (helper pair named for github.com), and the helper answers with github.com's own token if the store holds one, else nothing; never the GitLab token.
- [ ] **Step 2: Run** `bun test lib/team/__tests__/publish.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** At the top of `publishTeam`, once `activeRemote` is known, build the gate from `withheldPublishHost` so gate and remedy cannot disagree: `const tokenRemote = opts.tokenRemote ?? activeRemote; const confirmed = confirmedForgeHost(p); const offerable = opts.token != null && withheldPublishHost(tokenRemote, opts.token, confirmed) === null && mayOfferToken(tokenRemote, confirmed); const token = offerable ? opts.token : null;` (`mayOfferToken` covers the GitHub key, `http://` and unrecognised hosts; `withheldPublishHost` covers the GitLab key, including never to github.com since a github.com remote is GitHub-keyed) and use `token` / `tokenRemote` in all four places (remoteHead line 135, assertOriginTakesNewOrg line 140, the push line 148 as `gitWithRtCredential(..., token !== null, ...)`, publishPointer line 215). Write `withheldPublishHost` beside it. Drop the exemption entry.
- [ ] **Step 4: Run** `publish.test.ts`, `commands/__tests__/team.test.ts`, `rt-credential-equivalence.test.ts`, `lib/team/__tests__/create.test.ts`, `lib/setup/__tests__/steps-a.test.ts`, the guard, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the named files: `publish offers rt's token only where rt git credential would answer`.

### Task 6: Setup create's remedy for a withheld host

**Files:**
- Modify: `lib/setup/steps/team.ts:83-93`
- Test: `lib/setup/__tests__/steps-a.test.ts` (beside the `push-denied -> failed with a credentials remedy` test at line 709)

**Interfaces:**
- Consumes: `withheldPublishHost` (Task 5), `confirmedForgeHost` (`lib/team/stored-forge-token.ts`), `forgeTokenFor` (already imported).

- [ ] **Step 1: Write the failing tests**, reusing `adminProbes`, `gitExecFor`, `makeCtx` and the create intent shape of the line 709 test, with `remote = "https://gitlab.acme.dev/acme/mattstack-team-acme.git"`, a staged or stored GitLab token `glpat_fake` reachable by `forgeTokenFor`, and git answering `{ code: 128, stderr: "remote: HTTP Basic: Access denied" }`:
  - `an unconfirmed GitLab host: push-denied names the connect command`: remedy is exactly `Confirm gitlab.acme.dev as your GitLab host, then Retry. Run rt setup gitlab connect --host gitlab.acme.dev`.
  - `an unconfirmed GitLab host: the ls-remote failure names the connect command too`: git fails the `ls-remote` call, so publish throws `team-pull-only`; same remedy, `detail` is that error's message unchanged.
  - `a confirmed GitLab host keeps today's remedy`: confirmed host `gitlab.acme.dev`, push-denied: remedy `Check your push access to the team repo, then Retry`.
  - `no GitLab token keeps today's remedy`: no token held, push-denied: same old remedy.
  - The line 709 github.com test stays unchanged and passing.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/steps-a.test.ts`. Expected: the two new-remedy tests FAIL, the rest PASS.
- [ ] **Step 3: Implement** in `teamCreateRun`: declare `let token: string | null = null;` above the `try` and assign `token = await forgeTokenFor(ctx, created.remote);` inside it (so a throw from the lookup still reaches the catch as today), pass it to `publishTeam`, and in the `UserActionableError` branch before the existing `push-denied` line: `const withheld = withheldPublishHost(created.remote, token, confirmedForgeHost(ctx.p)); if (withheld !== null && (err.code === "push-denied" || err.code === "team-pull-only")) return { state: "failed", detail: err.message, remedy: \`Confirm ${withheld} as your GitLab host, then Retry. Run rt setup gitlab connect --host ${withheld}\` };`. Everything else unchanged.
- [ ] **Step 4: Run** `steps-a.test.ts`, `lib/setup/__tests__/steps-team-log.test.ts`, `commands/__tests__/setup-copy.test.ts`, `bun run typecheck`. Expected: PASS with no snapshot update.
- [ ] **Step 5: Commit** `lib/setup/steps/team.ts lib/setup/__tests__/steps-a.test.ts`: `setup create names rt setup gitlab connect when publish withholds the token`.

### Task 7: Join and the repo access probe

**Files:**
- Modify: `lib/team/join.ts:40,637,654,660,694`, `lib/team/repo-access.ts:12,48`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop two entries)
- Test: `lib/team/__tests__/join.test.ts`, `lib/team/__tests__/repo-access.test.ts`, `lib/setup/__tests__/validators-access.test.ts`

- [ ] **Step 1: Tests first**, as in Task 3. `join.test.ts`: the `forgeToken` seam returning a token gives every one of the four calls the helper for the pointer's host (GitHub and a GitLab pointer); the seam returning null, or the pointer on an unconfirmed host, gives plain argv on all four. `repo-access` and `validators-access`: helper host iff the lookup is `{ kind: "token" }`, for github.com and gitlab.com.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Replace**: join's four calls take `token !== null`; repo-access takes `lookup.kind === "token"`. Drop the two entries.
- [ ] **Step 4: Run** the three files, `lib/setup/__tests__/steps-a.test.ts` (team.join cases), the guard, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the named files: `join and the repo access probe name rt git credential`.

### Task 8: Setup's home remote push and repo clone

**Files:**
- Modify: `lib/setup/home-remote.ts:10,120`, `lib/setup/steps/repos.ts:18,178`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop two entries)
- Test: `lib/setup/__tests__/home-remote.test.ts`, `lib/setup/__tests__/steps-a.test.ts`, `lib/__tests__/forge-token-for.test.ts`

- [ ] **Step 1: Tests first.** `home-remote.test.ts`: the REST-create path with the `githubToken` hook returning a token names the helper for github.com; a typed URL (no token) is plain; `expectNoToken`. `steps-a.test.ts` repos.clone cases: a trusted token (stored, and staged only) names the helper for github.com and for gitlab.com; an unconfirmed host is plain. Also assert the clone's resulting `.git/config` wiring through `rtCredentialHelper` is unchanged (existing tests).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Replace** with `gitWithRtCredential(..., pushToken !== null, ...)` and `(..., token !== null, ...)`. Drop the two entries.
- [ ] **Step 4: Run** the three files, the guard, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the named files: `setup's home push and repo clone name rt git credential`.

### Task 9: The home repo clone and the daemon's team pull

**Files:**
- Modify: `lib/home/init-exec.ts:14,96-108`, `lib/daemon/home-snapshot.ts:46,734`
- Modify: `lib/__tests__/token-env-exemptions.json` (drop two entries)
- Test: `lib/home/__tests__/init-exec.test.ts`, `lib/daemon/__tests__/home-snapshot.test.ts`

- [ ] **Step 1: Tests first.**
  - `init-exec.test.ts`: with `cloneToken` returning a token, the first clone names the helper for the URL's host (github.com and gitlab.com cases) with no token in env; the `gho_other_account` case (first clone fails) still runs a second plain `git clone -- <url> user` and logs `rt's GitHub token could not clone it, so trying git's own credentials`; with `cloneToken` null, exactly one plain clone (Review Focus 4).
  - `home-snapshot.test.ts`: with `readToken` returning a token, team pull and push argv name the helper for the origin's host, env carries no token; `readToken` null gives plain argv; the token read happens once per pull interval as today (existing cache test); and `after the token is revoked the cached offer still names the helper and never passes the old token` (Review Focus 3): change `readToken`'s answer inside the TTL and assert argv still names the helper and no env value equals either token.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.** init-exec: `const cmd = gitWithRtCredential(clone, ((await exec.cloneToken?.(step.url)) ?? null) !== null, {}, { remote: step.url });` and branch on `!cmd.offered` instead of `Object.keys(cmd.env).length === 0`. home-snapshot: `gitWithRtCredential(args, cachedToken.value !== null, { ...env, GIT_TERMINAL_PROMPT: "0" }, { remote: spec.originUrl ?? null })`, keeping the cache as the offer decision. Drop the two entries.
- [ ] **Step 4: Run** both files, `lib/daemon/__tests__/team-snapshots.test.ts`, the guard, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the named files: `home clone and daemon team pull name rt git credential`.

### Task 10: Delete gitWithToken, empty the exemptions, docs

**Files:**
- Modify: `lib/team/git-credential.ts` (delete `GitWithToken`, `HOST_HELPER`, `gitWithToken`; update the file header to describe `gitWithRtCredential`)
- Modify: `lib/team/__tests__/git-credential.test.ts` (delete the `describe("gitWithToken")` block; move its `no call site offers a token through an unscoped credential.helper` test under `gitWithRtCredential`)
- Modify: `lib/__tests__/token-env-exemptions.json` to `[]`
- Check: `sites/docs/docs/rt/reference/_partials/git/auth.mdx`, `sites/docs/docs/rt/reference/_partials/sync/index.mdx`, and any other `sites/docs/` page matching `RT_GIT_TOKEN|environment` near git auth

- [ ] **Step 1: Delete** the old builder and its tests; set exemptions to `[]`.
- [ ] **Step 2: Run** `bun test lib/__tests__/no-token-in-git-env.test.ts lib/team/__tests__/git-credential.test.ts lib/skills/__tests__/origin-git.test.ts` and `git grep -n "gitWithToken\|RT_GIT_TOKEN\|RT_GIT_HOST\|RT_GIT_USER" -- lib commands cli.ts`. Expected: tests PASS; grep prints only `lib/skills/__tests__/origin-git.test.ts` lines asserting undefined.
- [ ] **Step 3: Docs.** Invoke rt:docs. Edit a `sites/docs/` page only if it says rt passes the token through the environment; otherwise record "no docs change" for the report.
- [ ] **Step 4: Full targeted verification** from the worktree root: `bun test` over every test file named in Tasks 1 to 10 plus `lib/__tests__/no-raw-output.test.ts`, then `bun run typecheck` and `bun run purity`. Expected: all PASS. Paste the counts into the SDD ledger.
- [ ] **Step 5: Commit** the named files: `remove gitWithToken; no forge token reaches git through env`.
- [ ] **Step 6: Report notes** (for the controller's report and PR body, not code): add a `Notes` entry to `.superpowers/report-draft.md` naming the section 4 tightening and its new remedy, the org identity edge, the `branch_sync` preflight retry (outside the fence) and `originFetchAuth`'s `get-url` inheriting `GIT_DIR` (ruled out of scope; no test written here), and setup create's `creatorUsername` (`create.ts:102`) sending the ungated GitLab token to an unconfirmed host through `glab api user` (today's behaviour, outside git, worth its own ticket).
