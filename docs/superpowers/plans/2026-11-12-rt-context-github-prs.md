# rt-context GitHub PR links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a GitHub repo, rt-context shows the branch's PR link from the daemon cache, never shows another repo's PR or MR, and names the forge in every label, with GitLab behaviour unchanged.

**Architecture:** A pure `src/forge.ts` holds the forge rules (which forge a remote is, its words, whether a PR URL belongs to the remote, and the daemon-entry and local-cache guards). The vscode-facing files (`statusBar.ts`, `branchSwitcher.ts`, `worktreePicker.ts`, `extension.ts`) resolve the repo's forge once and route every daemon entry and local cache read through the guards. No daemon change, no new request.

**Tech Stack:** TypeScript, VS Code extension API, bun test, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-12-rt-context-github-prs-design.md`

## Global Constraints

- Write only under `extensions/vscode/rt-context/` (plus this plan and `.superpowers/`).
- On a GitLab repo or an unrecognised host (`forge` is `gitlab` or null): same requests, same token gate, same words, same data shown as on main.
- No new request of any kind; no daemon change; no GitHub token in the extension.
- No token is ever logged.
- GitHub copy: `GitHub`, `PR`, `pull request`, `Pull Request`. GitLab copy stays: `GitLab`, `MR`, `merge request`, `Merge Request`.
- No em or en dashes in anything written. Comments only for a constraint the code cannot show.
- Tests: `cd extensions/vscode/rt-context && bun test src/__tests__`; typecheck: `cd extensions/vscode/rt-context && bunx tsc --noEmit -p .`. Never install the extension or run rt, the daemon or a built binary.
- Stage named files only.

## Review Focus

1. A remote whose owner or repo differs in case from the PR URL (`git@github.com:M4ttstack/Mattstack.git` vs `https://github.com/m4ttstack/mattstack/pull/7`): belongs. Test in Task 1.
2. A repo name that is a prefix of another (`o/r` vs `https://github.com/o/r2/pull/7` or `https://github.com/o/r.evil/pull/1`): does not belong. Test in Task 1.
3. An ssh alias remote (`git@work-github:o/r.git`) or no remote at all: forge null, so the extension behaves exactly as on main (no guard, GitLab words). Test in Task 1.
4. A GitHub repo whose daemon entry has an `mr` with no `webUrl`: rejected, since its PR-title ticket id may belong to another repo. Test in Task 1.
5. A local cache entry written before this change by a GitLab window for the same branch name: a miss on the GitHub window, still shown on the GitLab window. Test in Task 1 (`ownBranchData`); wiring in Tasks 2 and 3.
6. A quick branch switch on GitHub while the old branch's background fetch is still waiting on Linear: the late result must not repaint the status bar with the old branch. No unit test reaches it (vscode-bound); the Task 2 Step 4 guard is checked in task review.

---

### Task 1: Pure forge rules

**Files:**
- Create: `extensions/vscode/rt-context/src/forge.ts`
- Test: `extensions/vscode/rt-context/src/__tests__/forge.test.ts`

**Interfaces:**
- Consumes: `parseRemoteUrl` (`src/branchParser.ts`, returns `{ host: origin, projectPath }`), `mayOfferGitLabTokenToHost(host, confirmedHost)` from `@mattstack/rt-client`, `CachedBranchData` (`src/types.ts`, type-only import).
- Produces:
  - `export type Forge = 'github' | 'gitlab'`
  - `export interface ForgeWords { site: string; short: string; long: string; title: string }`
  - `export interface DaemonCacheEntry { ticket?: LinearTicket | null; mr?: { webUrl?: string | null; provider?: string } | null; linearId?: string | null; fetchedAt?: number }`
  - `forgeOfRemote(remoteUrl: string | null, confirmedHost: unknown): Forge | null`
  - `forgeWords(forge: Forge | null): ForgeWords`
  - `prBelongsToRemote(webUrl: string, remoteUrl: string): boolean`
  - `branchDataFromDaemonEntry(entry: DaemonCacheEntry, forge: Forge | null, remoteUrl: string | null, now?: number): CachedBranchData | null`
  - `ownBranchData(data: CachedBranchData | null | undefined, forge: Forge | null, remoteUrl: string | null): CachedBranchData | null`

- [ ] **Step 1: Write the failing tests** in `src/__tests__/forge.test.ts`:

```ts
describe('forgeOfRemote', () => {
  test('github.com over ssh and https is github', () => {
    expect(forgeOfRemote('git@github.com:o/r.git', null)).toBe('github');
    expect(forgeOfRemote('https://github.com/o/r', null)).toBe('github');
  });
  test('gitlab.com and the confirmed host are gitlab', () => {
    expect(forgeOfRemote('git@gitlab.com:g/p.git', null)).toBe('gitlab');
    expect(forgeOfRemote('https://gitlab.corp.example/g/p.git', 'gitlab.corp.example')).toBe('gitlab');
  });
  test('an unconfirmed host, an ssh alias, garbage and no remote are null', () => {
    expect(forgeOfRemote('https://gitlab.corp.example/g/p.git', null)).toBeNull();
    expect(forgeOfRemote('git@work-github:o/r.git', null)).toBeNull();
    expect(forgeOfRemote('not a url', null)).toBeNull();
    expect(forgeOfRemote(null, null)).toBeNull();
  });
});

describe('forgeWords', () => {
  test('github', () => expect(forgeWords('github')).toEqual({ site: 'GitHub', short: 'PR', long: 'pull request', title: 'Pull Request' }));
  test('gitlab and null keep the GitLab words', () => {
    const gl = { site: 'GitLab', short: 'MR', long: 'merge request', title: 'Merge Request' };
    expect(forgeWords('gitlab')).toEqual(gl);
    expect(forgeWords(null)).toEqual(gl);
  });
});

describe('prBelongsToRemote', () => {
  test('own repo, any case', () => {
    expect(prBelongsToRemote('https://github.com/o/r/pull/7', 'git@github.com:o/r.git')).toBe(true);
    expect(prBelongsToRemote('https://github.com/m4ttstack/mattstack/pull/7', 'git@github.com:M4ttstack/Mattstack.git')).toBe(true);
  });
  test('another repo, a prefix repo, another host, garbage', () => {
    expect(prBelongsToRemote('https://github.com/o/r2/pull/7', 'git@github.com:o/r.git')).toBe(false);
    expect(prBelongsToRemote('https://github.com/o/r.evil/pull/1', 'https://github.com/o/r')).toBe(false);
    expect(prBelongsToRemote('https://gitlab.com/o/r/-/merge_requests/1', 'git@github.com:o/r.git')).toBe(false);
    expect(prBelongsToRemote('nonsense', 'git@github.com:o/r.git')).toBe(false);
  });
});
```

Plus `branchDataFromDaemonEntry` and `ownBranchData` cases, with `REMOTE = 'git@github.com:o/r.git'` and a `ticket` fixture:
- github, own PR (`mr: { webUrl: 'https://github.com/o/r/pull/7', provider: 'github' }`, `linearId: 'RT-1'`, `fetchedAt: 5`) maps to `{ ticket, mrUrl: 'https://github.com/o/r/pull/7', linearId: 'RT-1', fetchedAt: 5 }`.
- github, another repo's GitHub PR (`https://github.com/o/other/pull/3`): null.
- github, another repo's GitLab MR (`https://gitlab.com/g/p/-/merge_requests/9`, provider `gitlab`): null.
- github, `mr: { provider: 'github' }` with no `webUrl`: null.
- github, `mr: null`, `linearId: 'RT-2'`: kept, `mrUrl` null.
- github with `remoteUrl` null and an `mr`: null.
- gitlab and null forge: the foreign GitHub PR entry maps unchanged (`mrUrl` is that URL).
- `linearId: ''` maps to `null`; missing `fetchedAt` maps to the `now` argument.
- `ownBranchData`: on github, `{ mrUrl: 'https://gitlab.com/g/p/-/merge_requests/9', ... }` is null; own `mrUrl` and `mrUrl: null` are returned as the same object; on gitlab and null the foreign one is returned as the same object; `undefined` in gives null.

- [ ] **Step 2: Run to verify they fail**

Run: `cd extensions/vscode/rt-context && bun test src/__tests__/forge.test.ts`
Expected: FAIL, cannot find module `../forge`.

- [ ] **Step 3: Implement `src/forge.ts`**

`forgeOfRemote`: `parseRemoteUrl`, then host = `new URL(origin).host.toLowerCase()`; `github.com` is github; `mayOfferGitLabTokenToHost(host, confirmedHost)` is gitlab; else null. `prBelongsToRemote`: parse `webUrl` with `new URL` (false on throw), compare `(origin + pathname).toLowerCase()` starts with `(remote.host + '/' + remote.projectPath + '/').toLowerCase()`. `branchDataFromDaemonEntry` maps `ticket ?? null`, `mr?.webUrl ?? null`, `linearId || null`, `fetchedAt ?? now` (default `Date.now()`); on github an entry with a non-null `mr` is rejected unless `remoteUrl` and `mr.webUrl` are set and `prBelongsToRemote` holds. `ownBranchData` on github returns null when `data.mrUrl` is set and does not belong (or `remoteUrl` is null); otherwise returns `data ?? null`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd extensions/vscode/rt-context && bun test src/__tests__/forge.test.ts && bunx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/rt-context/src/forge.ts extensions/vscode/rt-context/src/__tests__/forge.test.ts
git commit -m "rt-context: add forge rules and PR ownership guard"
```

---

### Task 2: Status bar, actions and the GitLab token command

**Files:**
- Create: `extensions/vscode/rt-context/src/repoForge.ts`
- Modify: `extensions/vscode/rt-context/src/statusBar.ts`, `src/extension.ts`, `package.json`, `README.md`
- Test: `extensions/vscode/rt-context/src/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: Task 1's `Forge`, `forgeOfRemote`, `forgeWords`, `branchDataFromDaemonEntry`, `ownBranchData`; `confirmedForgeHost()` (`src/gitlab.ts`); `getRemoteUrl(repo)` (`src/git.ts`).
- Produces:
  - `repoForge.ts`: `export interface RepoForge { remoteUrl: string | null; forge: Forge | null }` and `resolveRepoForge(repo: GitRepository | null): RepoForge` (`forgeOfRemote(getRemoteUrl(repo), confirmedForgeHost())`; `{ remoteUrl: null, forge: null }` for no repo).
  - `statusBar.ts`: `fetchBranchData(context, branch, repoForge: RepoForge): Promise<CachedBranchData | null>` (new third parameter) and `getCurrentForge(): Forge | null`.

- [ ] **Step 1: Write the failing manifest test** in `src/__tests__/manifest.test.ts`: read `package.json` with `readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')` and `JSON.parse` (a JSON import breaks tsc: `rootDir` is `src`), assert `contributes.menus.commandPalette` contains `{ command: 'rtContext.setGitlabToken', when: "rtContext.forge != 'github'" }`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd extensions/vscode/rt-context && bun test src/__tests__/manifest.test.ts`
Expected: FAIL, `menus` undefined.

- [ ] **Step 3: Add the palette entry** to `package.json` under `contributes.menus.commandPalette` with exactly that `command` and `when`.

- [ ] **Step 4: Wire `statusBar.ts`** (no unit test; vscode-bound):
  - In `updateStatusBar`, after the repo is found, `const repoForge = resolveRepoForge(repo)`; store `repoForge.forge` in a module `currentForge`; `vscode.commands.executeCommand('setContext', 'rtContext.forge', repoForge.forge ?? 'none')`. The no-repo branch sets `currentForge = null` and the context key to `none`.
  - `const cached = ownBranchData(branchCache.get(branch), repoForge.forge, repoForge.remoteUrl) ?? undefined` replaces the raw read.
  - `fetchBranchData` maps the daemon entry with `branchDataFromDaemonEntry(entry, repoForge.forge, repoForge.remoteUrl)`; null falls through to `fetchBranchDataDirect`.
  - `fetchBranchDataDirect(context, branch, repoForge)`: when `repoForge.forge === 'github'`, skip the GitLab token read and `fetchMRInfo` entirely; otherwise unchanged except that it uses `repoForge.remoteUrl` instead of a second `findWorkspaceRepo` lookup (same value).
  - Fresh-cache path: when `repoForge.forge === 'github'` and the background result's `mrUrl` or `linearId` differs from `cached`'s, call `renderFinalState` with the fresh data, but only while `branch` is still the branch the status bar shows: keep a module-level `renderedBranch` set by every render (or an update counter bumped per `updateStatusBar`) and skip the repaint when it no longer matches. A late result from a branch already switched away from must never repaint. GitLab keeps cache-only.
  - Tooltip: `` `${forgeWords(currentForge).short}: ${mrUrl}` `` replaces `` `MR: ${mrUrl}` ``.
- [ ] **Step 5: Wire `extension.ts`**: the action label is `` `$(git-merge) Open ${w.site} ${w.title}` `` with `w = forgeWords(getCurrentForge())`, which reads `Open GitLab Merge Request` on GitLab exactly as today.
- [ ] **Step 6: README**: replace the "GitLab MR fallback" section with a short section saying the PR or MR link comes from the rt daemon; on GitHub the daemon reads PRs once GitHub is connected (`rt setup github connect --use-gh`), and a new branch's link appears after the daemon's next refresh; on GitLab the extension can also look the MR up itself with the GitLab token. Note the GitLab token command shows only on GitLab and other hosts.
- [ ] **Step 7: Verify**

Run: `cd extensions/vscode/rt-context && bun test src/__tests__ && bunx tsc --noEmit -p .`
Expected: all pass (the bundle-load test builds `dist/`), tsc clean.

- [ ] **Step 8: Commit**

```bash
git add extensions/vscode/rt-context/src/repoForge.ts extensions/vscode/rt-context/src/statusBar.ts extensions/vscode/rt-context/src/extension.ts extensions/vscode/rt-context/package.json extensions/vscode/rt-context/README.md extensions/vscode/rt-context/src/__tests__/manifest.test.ts
git commit -m "rt-context: GitHub PR links and forge words in the status bar"
```

---

### Task 3: Branch switcher and worktree picker

**Files:**
- Modify: `extensions/vscode/rt-context/src/branchSwitcher.ts`, `src/worktreePicker.ts`, `src/cache.ts`

**Interfaces:**
- Consumes: Task 1's guards and `forgeWords`; Task 2's `resolveRepoForge(repo)` and `fetchBranchData(context, branch, repoForge)`.
- Produces: `PersistedCache.delete(key: string): void` (removes and persists).

- [ ] **Step 1: `cache.ts`**: add `delete(key)` next to `set`, persisting the same way.
- [ ] **Step 2: `branchSwitcher.ts`**:
  - `const repoForge = resolveRepoForge(repo)` and `const w = forgeWords(repoForge.forge)` at picker open.
  - `/api/cache` loop: `const data = branchDataFromDaemonEntry(entry, repoForge.forge, repoForge.remoteUrl)`; when non-null, `branchCache.set` and count a hit; when null and the forge is `github`, `branchCache.delete(branch)` if `ownBranchData(branchCache.get(branch), ...)` is null.
  - `buildBranchItem` and the step-8 `existing` read go through `ownBranchData(branchCache.get(branch), repoForge.forge, repoForge.remoteUrl)`.
  - The direct batch: when the forge is `github`, skip `getSecret(context, 'gitlabToken')` and `fetchMRInfoBatch`; otherwise unchanged.
  - Copy: button tooltip `` `Open ${w.site} ${w.long}` ``; detail `` `$(git-pull-request) ${w.short}` ``.
- [ ] **Step 3: `worktreePicker.ts`**: `showAllWorktrees` already resolves `repo` and returns early without one; right after that guard, `const repoForge = resolveRepoForge(repo)` (no second lookup); `buildPickItem` reads through `ownBranchData`; its `fetchBranchData` calls pass `repoForge`; same tooltip and detail copy as Step 2.
- [ ] **Step 4: Verify**

Run: `cd extensions/vscode/rt-context && bun test src/__tests__ && bunx tsc --noEmit -p . && grep -rnE "GitLab merge request|GitLab Merge Request|\) MR\b|MR: " src '--include=*.ts' | grep -v __tests__`
Expected: tests pass, tsc clean, grep prints nothing (every label goes through `forgeWords`). The quotes on `'--include=*.ts'` matter: unquoted, zsh fails the glob before grep runs and the check passes vacuously. On main this grep lists 5 lines (worktreePicker.ts:128, :168, branchSwitcher.ts:84, :115, statusBar.ts:402) plus extension.ts:47.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/rt-context/src/branchSwitcher.ts extensions/vscode/rt-context/src/worktreePicker.ts extensions/vscode/rt-context/src/cache.ts
git commit -m "rt-context: guard and forge words in the branch and worktree pickers"
```

---

### Task 4: Whole-repo gates

- [ ] **Step 1:** From the worktree root: `bun run typecheck` and `bun run purity`. Expected: both exit 0.
- [ ] **Step 2:** No added line carries an em or en dash: `git diff main -- extensions/vscode/rt-context | grep '^+' | perl -CSD -ne 'print if /\x{2013}|\x{2014}/'` prints nothing.
