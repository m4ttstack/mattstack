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
- A PR that belongs to another repo never shows.

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
  websocket event re-renders the status bar then. No daemon change, no
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
- `prBelongsToRemote(webUrl, remoteUrl): boolean`: true when the PR URL's
  origin and path start with the remote's origin and project path plus
  `/`, compared case-insensitively. `https://github.com/o/r/pull/7`
  belongs to `git@github.com:o/r.git`; `https://github.com/o/r2/pull/7`
  does not.
- `branchDataFromDaemonEntry(entry, remoteUrl): CachedBranchData | null`:
  maps a daemon cache entry to the extension's `CachedBranchData` (the
  mapping `statusBar.ts` and `branchSwitcher.ts` each do inline today).
  Returns null, a miss, when `entry.mr.provider === 'github'` and the PR
  does not belong to `remoteUrl`, or when `remoteUrl` is unknown for such
  an entry. A GitLab entry, or an entry with no `mr`, maps exactly as today.

### Wiring

- `statusBar.ts`:
  - Resolve the repo's remote URL and forge once per status-bar update.
  - `fetchBranchData(context, branch, remoteUrl)` maps the daemon entry
    through `branchDataFromDaemonEntry`; a null result falls through to
    the direct fallback as a miss does today.
  - The direct fallback skips the GitLab token read and MR lookup when the
    forge is `github`. It still fetches the Linear ticket named in the
    branch, as it does today. GitLab and unknown hosts run unchanged.
  - The tooltip line reads `PR: <url>` on GitHub, `MR: <url>` otherwise.
  - Keep the current forge in module state with a getter
    (`getCurrentForge()`) for `extension.ts`, like `getCurrentMrUrl()`.
  - Set the `rtContext.forge` context key (`setContext`) to `github`,
    `gitlab` or `none` whenever the forge is resolved.
- `branchSwitcher.ts`: map each `/api/cache` entry through
  `branchDataFromDaemonEntry`; a rejected entry is not a hit and is not
  cached. Labels come from `forgeWords(forge)`. The direct batch lookup
  skips the GitLab token and MR batch on GitHub, as the status bar does.
- `worktreePicker.ts`: labels from `forgeWords`. Its data already comes
  through `fetchBranchData`, so it gets the guard for free; it passes the
  remote URL it already reads.
- `extension.ts`: the status bar action reads "Open GitHub Pull Request"
  on GitHub and keeps "Open GitLab Merge Request" otherwise, matching its
  sibling actions' title case ("Open Linear Ticket").
- `package.json`: a `menus.commandPalette` entry hides
  `rtContext.setGitlabToken` when `rtContext.forge == 'github'`. One forge
  per team, so a GitHub user never needs it. No GitHub token command: the
  daemon owns GitHub access.
- `README.md`: say that on GitHub the PR link comes from the rt daemon,
  which reads GitHub through `rt setup github connect --use-gh`, and that
  the GitLab token command is for GitLab repos.

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

- `src/__tests__/forge.test.ts`: `forgeOfRemote` (github.com over ssh and
  https, gitlab.com, a confirmed host, an unconfirmed host, garbage),
  `forgeWords`, `prBelongsToRemote` (own repo, another repo, a prefix
  repo name like `o/r` vs `o/r2`, case), `branchDataFromDaemonEntry` (own
  GitHub PR kept, another repo's GitHub PR rejected, GitLab entry kept
  untouched, entry with no `mr` kept, PR-title ticket id carried).
- A `package.json` test: the palette hides the GitLab token command on
  GitHub.
- Existing suites stay green: `bun test src/__tests__`,
  `bunx tsc --noEmit -p .` in the extension, `bun run build` (the
  bundle-load test reads `dist/`), root `bun run typecheck` and
  `bun run purity`.
- No live forge calls. The extension is not installed into Matt's VS Code;
  a look in a real VS Code window is left to Matt after merge.

## Left to the builder

- Whether `fetchBranchData` takes the remote URL as a parameter or reads it
  itself (the worktree picker calls it for other worktrees of the same
  repo, which share the remote).
- Test file layout and helper names.
