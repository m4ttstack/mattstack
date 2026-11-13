# rt-context on GitHub: PR links and forge-aware copy

Ticket: RT-548 (project P-RT-28, GitHub parity). Size: a small change, all
inside `extensions/vscode/rt-context/`.

## Intent

The rt-context VS Code extension shows the worktree, branch, Linear ticket
and the branch's merge request in the status bar, the branch switcher and
the worktree picker. It was written for GitLab. On a GitHub repo it should
show the branch's pull request and the ticket a PR title names, and every
label should say PR or pull request, never MR or GitLab.

PR #1099 already landed the token half: the GitLab token goes only to
gitlab.com or the confirmed host, and the extension sends no request to any
other origin host. This change is the other half.

## What is true on main today (checked 2026-11-12)

- Every lookup asks the daemon first: `fetchBranchData` reads
  `GET /api/cache/:branch`, the branch switcher reads `GET /api/cache`.
- The daemon's cache refresh already enriches GitHub repos
  (`lib/enrich.ts`, `GitHubProvider`, token from the gh session). The live
  cache held 1021 entries, 489 of them with a github.com PR URL, each with
  `mr.provider: "github"`, `mr.webUrl`, `mr.title` and the PR-title ticket
  id in `linearId`. So a cached GitHub branch's PR link and ticket already
  reach the extension.
- What is broken on GitHub:
  1. Copy names only GitLab: "Open GitLab Merge Request" (status bar
     actions), "Open GitLab merge request" (branch switcher and worktree
     picker buttons), "MR" (picker detail), "MR: <url>" (status bar
     tooltip), and the "RT Context: Set GitLab Token" command shows on
     every repo.
  2. The daemon looks a bare branch name up across every repo
     (`getByBranch` suffix match; `/api/cache` output is bare-branch keyed).
     A GitHub branch name that another repo also uses can show that repo's
     PR. The REST door cannot scope by repo today: `branches` arrives as a
     string, not an array.
  3. On a cache miss the extension falls back to its own GitLab lookup,
     which on github.com only fetches the GitLab token from the daemon to
     be refused (a console line) and adds nothing.

## Goals

- A GitHub branch the daemon has cached shows its PR link, and its ticket
  when only the PR title names one.
- Every user-facing label names the repo's forge: PR, pull request and
  GitHub on GitHub; MR, merge request and GitLab on GitLab.
- On a GitHub repo, a PR or MR that belongs to another repo never shows,
  whether it came from the daemon or from the extension's own local cache.

Known limit of approach A: the daemon cannot scope a lookup by repo over
REST, so when two repos share a branch name it may answer with the other
repo's entry. On GitHub the guard strips that entry's PR, and nothing
falls back, so this repo's own PR does not show for that branch name.
Accepted: it needs a daemon change this ticket does not make.

## Non-goals

- No GitHub token in the extension. `secrets:read` stays as it is.
- No daemon change, no new REST route, no new request of any kind.
- No GitHub Enterprise or other host support: the daemon reads only
  github.com today.

## Anti-goals

- Any change to what the extension does on a GitLab repo: same requests,
  same token gate, same words.
- Any new poll or request.

## Approaches

- **A, chosen: daemon cache only.** Read the PR link and PR-title ticket id
  from the daemon's branch cache, reject an entry whose PR is not this
  repo's, skip the GitLab direct fallback on GitHub, name the forge in all
  copy. A branch the cache has not reached shows no link until the
  daemon's next refresh (5 minutes at most); the existing `status`
  websocket event then starts a status-bar update, and on GitHub a
  background fetch whose result differs from what is shown re-renders
  (see Wiring). No daemon change, no
  token, zero new requests. Picked by the shepherd (gate 8335c630).
- B: A plus an on-demand `branch:enrich` call through a new daemon REST
  route on a cache miss. Faster first link, costs a daemon route and 1 to
  10 GitHub reads per hour. Not picked.
- C: give the extension a GitHub token through `secrets:read`. Works with
  the daemon down, but adds a second GitHub token holder and duplicates the
  daemon's polling. Not picked.

## Design

### A pure forge module: `src/forge.ts`

No `vscode` import, so `bun test` can load it.

- `type Forge = 'github' | 'gitlab'`.
- `forgeOfRemote(remoteUrl, confirmedHost): Forge | null`: `github` when
  the origin host is github.com; `gitlab` when the host may take the GitLab
  token (`mayOfferGitLabTokenToHost`, the same rule PR #1099 uses);
  otherwise null.
- `forgeWords(forge)`: the words for labels.
  - github: `GitHub`, `PR`, `pull request`, `Pull Request`.
  - gitlab and null: `GitLab`, `MR`, `merge request`, `Merge Request`.
    Null keeps today's words, so an unrecognised host reads exactly as it
    does now.
- `repoIdentityOfRemote(remoteUrl): string | null`: the serialized repo
  identity, `serializeIdentity(identityFromRemote(remoteUrl))` from
  rt-client, the key the daemon stores each cache entry under (`repoName`),
  or null when the remote yields none. Its own normalisation covers ssh,
  `ssh://`, `git+ssh://`, https with or without `.git`, a trailing slash
  and a mixed-case host. (Gate 78d7aebb.)
- `prBelongsToRemote(webUrl, remoteUrl): boolean`: the fallback rule for
  an entry that carries no identity. True when the PR URL's host and path
  start with the remote's normalised `host/path` (rt-client's
  `normalizeRemote`) plus `/`, compared case-insensitively.
  `https://github.com/o/r/pull/7` belongs to `git@github.com:o/r.git`;
  `https://github.com/o/r2/pull/7` does not.
- An entry belongs to this repo when its repo identity equals
  `repoIdentityOfRemote(remoteUrl)`. Only an entry with no identity (a
  daemon entry with no `repoName`, a local entry written before this
  change) falls back to `prBelongsToRemote` on its PR URL. Matching on
  identity keeps a renamed or transferred repo's own PRs, whose URLs name
  the new path while the local remote still names the old one.
- `branchDataFromDaemonEntry(entry, forge, remoteUrl, branch): CachedBranchData`:
  maps a daemon cache entry to the extension's `CachedBranchData` (the
  mapping `statusBar.ts` and `branchSwitcher.ts` each do inline today).
  The guard keys on the repo's forge, not the entry's provider: when
  `forge === 'github'` and the entry has an `mr` but does not belong to
  this repo (whatever its `provider`, so another repo's GitLab MR is
  rejected too), the entry is stripped, not dropped: it maps to this
  branch's data with no PR link (`mrUrl` null), no PR-title ticket id
  (`linearId` null), and its Linear ticket kept only when the ticket's
  identifier is the one named in the branch itself
  (`extractLinearId(branch)`), else null. It is a hit, never a miss, so
  nothing falls back to the extension's own lookup and the extension makes
  no request main did not make. (Gate 78d7aebb.) A mapped entry records
  the daemon entry's `repoName` as its repo identity. An entry with no
  `mr` maps as today. When `forge` is `gitlab` or null, every entry maps
  exactly as today: no guard, so nothing changes on GitLab.
- `ownBranchData(data, forge, remoteUrl): CachedBranchData | null`: the
  same rule for an entry read back from the extension's local
  `branchCache` (shared by every window through `globalState`, keyed by
  bare branch name, and holding entries written before this change). On
  GitHub, a cached entry with an `mrUrl` that does not belong to this repo
  (by its stored identity, or by `prBelongsToRemote` when it has none)
  reads as null, a miss; otherwise it is returned unchanged. On GitLab and
  null it is the identity.
- `CachedBranchData` gains an optional `repoIdentity`, written with every
  entry the extension stores on a GitHub repo.

### Wiring

- `statusBar.ts`:
  - Resolve the repo's remote URL and forge per status-bar update, but
    reuse the confirmed forge host and call `setContext` only when the
    forge changes.
  - The cached entry read at the top of the update goes through
    `ownBranchData` before the fresh-cache check, so a foreign local entry
    is a miss and is never rendered.
  - `fetchBranchData(context, branch, remoteUrl, forge)` maps the daemon
    entry through `branchDataFromDaemonEntry`; a stripped entry is a hit,
    and only a daemon miss (no entry, or the daemon down) falls through to
    the direct fallback as today.
  - When the daemon is unreachable on GitHub, the fallback result keeps
    the own `mrUrl` and `linearId` already cached for this branch, so a
    daemon blip does not drop a PR link that was showing.
  - On GitHub only, when the silent background fetch on the fresh-cache
    path returns a different `mrUrl` or `linearId` from what was rendered,
    render again from the fresh data. GitLab keeps today's
    update-the-cache-only behaviour. No new request: the fetch already
    runs today.
  - The direct fallback skips the GitLab token read and MR lookup when the
    forge is `github`. It still fetches the Linear ticket named in the
    branch, as it does today. GitLab and unknown hosts run unchanged.
  - The tooltip line reads `PR: <url>` on GitHub, `MR: <url>` otherwise.
  - Keep the current forge in module state with a getter
    (`getCurrentForge()`) for `extension.ts`, like `getCurrentMrUrl()`.
  - Set the `rtContext.forge` context key (`setContext`) to `github`,
    `gitlab` or `none` whenever the forge is resolved.
- `branchSwitcher.ts`: resolve the remote URL and forge once when the
  picker opens. Map each `/api/cache` entry through
  `branchDataFromDaemonEntry` and write the result, a stripped entry
  included, so a foreign local entry for that branch is overwritten and
  cannot linger. `buildBranchItem` reads the local cache through
  `ownBranchData`. Labels come from `forgeWords(forge)`. The direct batch
  lookup skips the GitLab token and MR batch on GitHub, as the status bar
  does, and the `existing` entry it carries forward is read through
  `ownBranchData`.
- `worktreePicker.ts`: labels from `forgeWords`. `buildPickItem` reads the
  local cache through `ownBranchData`. It resolves the repo's remote URL
  and forge itself (it imports `getRemoteUrl` today but does not call it;
  the builder adds the call through `getGitApi`/`findWorkspaceRepo`) and
  passes them to `fetchBranchData`. Every worktree of one repo shares
  that remote.
- `cache.ts`: `PersistedCache` gains `delete(key)` (it has get, set and
  clear today), for the switcher's cleanup above.
- `extension.ts`: the status bar action reads "Open GitHub Pull Request"
  on GitHub and keeps "Open GitLab Merge Request" otherwise, matching its
  sibling actions' title case ("Open Linear Ticket").
- `package.json`: a `menus.commandPalette` entry hides
  `rtContext.setGitlabToken` when `rtContext.forge == 'github'`. One forge
  per team, so a GitHub user never needs it. No GitHub token command: the
  daemon owns GitHub access.
- `README.md`: say that on GitHub the PR link comes from the rt daemon,
  which reads GitHub through `rt setup github connect --use-gh`, that the
  GitLab token command is for GitLab repos, and the known limit above
  (a branch name another repo also uses may show no PR link).

### Copy

| Where | GitHub | GitLab (unchanged) |
| --- | --- | --- |
| Status bar action | Open GitHub Pull Request | Open GitLab Merge Request |
| Picker button tooltip | Open GitHub pull request | Open GitLab merge request |
| Picker detail | `$(git-pull-request) PR` | `$(git-pull-request) MR` |
| Status bar tooltip | `PR: <url>` | `MR: <url>` |

Internal names (`mrUrl`, `fetchMRInfo`, `gitlab.ts`) stay.

## Constraints

- Write only under `extensions/vscode/rt-context/`.
- No token is ever logged; the GitLab token never goes to a non-GitLab host
  (unchanged code path).
- No em or en dashes in new copy.

## Testing

- `src/__tests__/forge.test.ts`: `forgeOfRemote` (github.com over ssh,
  `ssh://`, https with and without `.git`, a mixed-case host, gitlab.com,
  a confirmed host, an unconfirmed host, garbage), `repoIdentityOfRemote`,
  identity match (a renamed repo's own PR kept by identity, a foreign
  identity stripped, no identity falls back to the URL rule, a trailing
  slash remote),
  `forgeWords`, `prBelongsToRemote` (own repo, another repo, a prefix
  repo name like `o/r` vs `o/r2`, case), `branchDataFromDaemonEntry` (on
  a GitHub repo: own PR kept, another repo's GitHub PR stripped, another
  repo's GitLab MR stripped, a stripped entry keeps only the branch-named
  ticket, entry with no `mr` kept, PR-title ticket id carried; on a GitLab repo and an unknown host: every entry kept
  untouched, including a foreign one), `ownBranchData` (on GitHub a local
  entry with a foreign `mrUrl` is a miss, an own or empty one is kept; on
  GitLab it is the identity).
- A `package.json` test: the palette hides the GitLab token command on
  GitHub.
- Existing suites stay green: `bun test src/__tests__`,
  `bunx tsc --noEmit -p .` in the extension, `bun run build` (the
  bundle-load test reads `dist/`), root `bun run typecheck` and
  `bun run purity`.
- No live forge calls. The extension is not installed into Matt's VS Code;
  a look in a real VS Code window is left to Matt after merge.

## Left to the builder

- Test file layout and helper names.
