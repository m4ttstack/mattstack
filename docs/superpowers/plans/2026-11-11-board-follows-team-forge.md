# The Board Follows the Team's Forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board a forge-neutral reader of the daemon's stores, so a team whose one forge is GitHub reaches the board and sees its PRs, with GitLab teams unchanged.

**Architecture:** One `forge` value on `BoardConfig` replaces `gitlabHost`. The URL parser takes the forge and project list and returns one canonical project spelling. Every GitLab client construction goes through a `gitlabOnly` accessor that refuses on a GitHub team, and the client hides GitLab-only menu items on GitHub rows.

**Tech Stack:** Bun, TypeScript, React (board client), `bun:test`, `@mattstack/glance`, `@mattstack/rt-client`.

**Spec:** `docs/superpowers/specs/2026-11-11-board-follows-team-forge-design.md`

## Global Constraints

- GitLab behaviour must not change: same settings, identities, parsed URLs, requests and error strings for every GitLab input.
- No new poll, no interval change, no new forge request from the board. No `state.db` schema change.
- No live forge calls in any test: stub the provider or the daemon; a fake GitHub host is `github.test` (never resolves).
- Write only under `apps/board/` (not `apps/board/skills-src/` or the generated skills folder), `packages/rt-client/src/settings/registry-defs.ts`, `docs/superpowers/`, `.superpowers/sdd/`.
- Board tests run from `apps/board` (`bun test <file>`); rt-client tests run from the worktree root.
- No em or en dashes in anything written. No dot separators and no coloured border with a border radius in UI.
- Stage named files only. Never print a token. Never run rt, the daemon or a built binary against the real HOME. Never touch the live board, deck or the dev app.
- Exact copy (rt:ui-copy):
  - Refusal sentence: `Not available on GitHub yet`
  - Identity error: `${projectPath}: could not derive its rt repo identity from the team's forge host`
  - Menu forge words: `github` / `gitlab` (lowercase, as today), `open in github`, `open this comment in github`, `open in github ↗`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A GitHub team forge stored as `https://GitHub.com/` (scheme, capitals, trailing slash): the board still resolves `https://github.com` and keeps rows. Pinned in Task 1.
2. A GitLab team whose org repo is on GitHub (`mattstack.integrations.forge` says github AND `board.gitlabHost` is set): stays exactly GitLab. Pinned in Task 1.
3. GitHub URLs with a tail (`/files`, `#discussion_r12`, `?w=1`) or dotted names (`my.org/repo-name.js`): parse to the repo. Pinned in Task 2.
4. A bulk selection of GitHub rows: the bulk menu offers no merge, rebase, auto-merge or draft entry. Pinned in Task 6.
5. A held doctor draft on a GitHub row reached by deep link: the server refuses the post with the sentence even though the client hides the control. Pinned in Task 4.

---

### Task 1: The forge value replaces `gitlabHost`

**Files:**
- Modify: `apps/board/src/config.ts` (`BoardConfig`, `parseConfig` ~271-400, `loadConfig` ~711-775, `deriveRtRepos`, `codeownerSlackOn`, `resolveLaunchRepo`)
- Modify (mechanical `config.gitlabHost` to `config.forge.host`): `apps/board/src/server.ts`, `apps/board/src/manifest-bindings.ts`, `apps/board/src/peer/launch-ask.ts`, `apps/board/src/run-owner-io.ts` callers, `apps/board/bin/triage.ts`, any other hit of `grep -rn gitlabHost apps/board/src apps/board/bin`
- Test: `apps/board/src/__tests__/config-store.test.ts`, `apps/board/src/__tests__/config.test.ts`

**Interfaces:**
- Produces: `export type BoardForge = { kind: 'gitlab' | 'github'; host: string }`; `BoardConfig.forge: BoardForge` (the `gitlabHost` field is gone); `export function normalizeForgeHost(host: string): string` (strips a scheme and trailing slashes, lowercases, prefixes `https://`).
- `parseConfig(raw, source)` accepts `gitlabHost?: string` and `forge?: { provider: string; host: string }` in the raw JSON.

- [ ] **Step 1: Write the failing tests** in `config-store.test.ts` (use the file's `fakeResolve` and `TEAM`):

```ts
const GH = {
  'board.projects': ['acme/widgets'],
  'mattstack.roster': [{ username: 'dev1' }],
  'mattstack.integrations': { forge: { provider: 'github', host: 'github.com' } },
};
test('a GitHub team forge with no board.gitlabHost resolves to github', () => {
  const cfg = loadConfig(fakeResolve(GH));
  expect(cfg.forge).toEqual({ kind: 'github', host: 'https://github.com' });
  expect(cfg.rtRepos).toEqual({ 'acme/widgets': 'github.com/acme/widgets' });
  expect(boardConfigured(fakeResolve(GH))).toBe(true);
});
test('a forge host stored with a scheme, capitals or a trailing slash normalizes', () => {
  const cfg = loadConfig(fakeResolve({ ...GH, 'mattstack.integrations': { forge: { provider: 'github', host: 'https://GitHub.com/' } } }));
  expect(cfg.forge.host).toBe('https://github.com');
});
test('board.gitlabHost wins over a GitHub team forge', () => {
  const cfg = loadConfig(fakeResolve({ ...TEAM, 'mattstack.integrations': GH['mattstack.integrations'] }));
  expect(cfg.forge).toEqual({ kind: 'gitlab', host: 'gitlab.example.com' });
});
test('a GitLab team forge with no board.gitlabHost is not configured', () => {
  const r = fakeResolve({ ...GH, 'mattstack.integrations': { forge: { provider: 'gitlab', host: 'gitlab.example.com' } } });
  expect(boardConfigured(r)).toBe(false);
});
```

Also add `expect(cfg.forge).toEqual({ kind: 'gitlab', host: 'gitlab.example.com' })` to the existing "with only the team keys set" test, and in `config.test.ts`: `parseConfig` with `{forge: {provider: 'github', host: 'github.com'}, projects, members}` gives a github forge; with neither field it throws `/missing required field "gitlabHost"/`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/__tests__/config-store.test.ts src/__tests__/config.test.ts`
Expected: FAIL (`forge` undefined).

- [ ] **Step 3: Implement** in `config.ts`:
  - `parseConfig`: a non-empty `gitlabHost` gives `{kind: 'gitlab', host: <verbatim>}` with today's type validation and messages; else `forge.provider === 'github'` with a non-empty string `host` gives `{kind: 'github', host: normalizeForgeHost(host)}`; else throw today's `missing required field "gitlabHost"` message. `projects` and `members` stay required. `rtRepos: deriveRtRepos(forge.host, projects)`.
  - `loadConfig`: add `forge: read<{forge?: unknown}>('mattstack.integrations')?.forge ?? undefined` to `merged` (keep `gitlabHost` there).
  - `codeownerSlackOn(config: Pick<BoardConfig, 'forge'>, ...)` uses `config.forge.host`; `resolveLaunchRepo`'s second parameter becomes `forgeHost: string` (its warning names `forgeHost`).
  - Every `.gitlabHost` read in the files above becomes `.forge.host`. The three "could not derive its rt repo identity from board.gitlabHost" strings in `server.ts` become the identity error from Global Constraints. Leave `projectPathFromWebUrl`'s signature alone in this task (callers pass `config.forge.host`).

- [ ] **Step 4: Run the tests and the type check**

Run: `cd apps/board && bun test src/__tests__/config-store.test.ts src/__tests__/config.test.ts src/__tests__/board.test.ts src/__tests__/launch-ask.test.ts src/__tests__/manifest-bindings.test.ts && bun run typecheck`
Expected: PASS, no type errors. Update test fixtures that build a `BoardConfig` literal with `gitlabHost` to `forge: { kind: 'gitlab', host: ... }`, values unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/server.ts apps/board/src/manifest-bindings.ts apps/board/src/peer/launch-ask.ts apps/board/bin/triage.ts apps/board/src/__tests__/config-store.test.ts apps/board/src/__tests__/config.test.ts <each other touched file>
git commit -m "board: one forge value replaces gitlabHost (BOARD-59)"
```

---

### Task 2: GitHub URLs and one canonical project spelling

**Files:**
- Modify: `apps/board/src/data.ts:107-115` (`projectPathFromWebUrl`), `data.ts` `buildBoard` (~198)
- Modify: callers in `apps/board/src/manifest-bindings.ts:178`, `apps/board/src/run-owner-io.ts:23-46`, `apps/board/src/peer/launch-ask.ts:19-31`, `apps/board/bin/triage.ts:226-229,260`, `apps/board/src/server.ts` (637, 961, 1317, 1393, 2258, 2777, 2987, 3186, 3578, 3881, 5626, 5672)
- Modify: `apps/board/src/triage/stack.ts:26-34` (`projectKeyOf`)
- Create: `apps/board/src/__tests__/forge-url.test.ts`
- Test: `apps/board/src/__tests__/board.test.ts`, `launch-ask.test.ts`, `triage-stack.test.ts`

**Interfaces:**
- Consumes: `BoardForge`, `BoardConfig.forge` (Task 1).
- Produces: `projectPathFromWebUrl(webUrl: string, config: Pick<BoardConfig, 'forge' | 'projects'>): string | null`; `daemonOwnerIo(config: Pick<BoardConfig, 'forge' | 'projects'>): OwnerIo`. `boardRepoSlug(host, project)` keeps its signature.

- [ ] **Step 1: Write the failing tests** in `forge-url.test.ts`:

```ts
const GH = { forge: { kind: 'github', host: 'https://github.com' }, projects: ['acme/widgets'] } as const;
const GL = { forge: { kind: 'gitlab', host: 'https://gitlab.example.com' }, projects: ['g/p'] } as const;
test('a GitHub PR URL parses to owner/repo, with or without a tail', () => {
  for (const tail of ['', '/files', '#discussion_r12', '?w=1'])
    expect(projectPathFromWebUrl(`https://github.com/acme/widgets/pull/7${tail}`, GH)).toBe('acme/widgets');
});
test('a case-different GitHub URL returns the configured spelling', () => {
  expect(projectPathFromWebUrl('https://github.com/Acme/Widgets/pull/7', GH)).toBe('acme/widgets');
  expect(projectPathFromWebUrl('https://github.com/Acme/Widgets/pull/7', { ...GH, projects: [] })).toBe('Acme/Widgets');
});
test('dotted and dashed GitHub names parse', () => {
  expect(projectPathFromWebUrl('https://github.com/my.org/repo-name.js/pull/3', GH)).toBe('my.org/repo-name.js');
});
test('the wrong forge or a non-PR URL returns null', () => {
  expect(projectPathFromWebUrl('https://gitlab.example.com/g/p/-/merge_requests/1', GH)).toBeNull();
  expect(projectPathFromWebUrl('https://github.com/acme/widgets/pull/7', GL)).toBeNull();
  expect(projectPathFromWebUrl('https://github.com/acme/widgets/issues/7', GH)).toBeNull();
});
test('GitLab parsing is unchanged', () => {
  expect(projectPathFromWebUrl('https://gitlab.example.com/g/p/-/merge_requests/1', GL)).toBe('g/p');
  expect(projectPathFromWebUrl('https://gitlab.example.com/G/P/-/merge_requests/1', GL)).toBe('G/P');
});
test('daemonOwnerIo slugs a GitHub MR by the configured spelling', () => {
  expect(daemonOwnerIo(GH).repoSlugForMr('https://github.com/Acme/Widgets/pull/7')).toBe('github.com-acme-widgets');
});
```

In `board.test.ts` (reuse its PullRequest helper, with `provider: 'github'`, `repositoryId: 'github:1'`, a `https://github.com/acme/widgets/pull/<n>` `webUrl`, `divergedCommitsCount: null`, no tags): `buildBoard keeps a GitHub row` (row's `rtRepo` is `github.com/acme/widgets`), `keeps a GitHub row whose URL differs in case from board.projects`, `drops a GitHub row outside board.projects`, `matches a GitHub author exactly` (author `Dev1` with roster `dev1` is dropped). In `launch-ask.test.ts`: `makeRepoForMrUrl(<GitHub config>)('https://github.com/Acme/Widgets/pull/7')` is `remote:github.com%2Facme%2Fwidgets`. In `triage-stack.test.ts`: `projectKeyOf` gives `/acme/widgets` for `.../pull/7` and `.../pull/9`; GitLab keys unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/__tests__/forge-url.test.ts src/__tests__/board.test.ts src/__tests__/launch-ask.test.ts src/__tests__/triage-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `projectPathFromWebUrl`: GitLab branch is today's body against `config.forge.host`, project list unused. GitHub branch: the URL must start with `config.forge.host`; match the rest with `^/?([^/?#]+)/([^/?#]+)/pull/\d+(?:[/?#].*)?$`; return the `config.projects` entry equal to `owner/repo` ignoring case, else `owner/repo` as written.
  - Every caller passes the config (`config`, `cfg`, `boardConfig`); `daemonOwnerIo(config)` passes `config.forge.host` to `boardRepoSlug`. `buildBoard` keeps its exact `projects.has(path)` and exact author check.
  - `projectKeyOf`: also cut a GitHub pathname at `/pull/<n>` so it returns `/owner/repo`; GitLab input gives today's result.

- [ ] **Step 4: Run tests and type check**

Run: `cd apps/board && bun test src/__tests__/forge-url.test.ts src/__tests__/board.test.ts src/__tests__/launch-ask.test.ts src/__tests__/triage-stack.test.ts src/__tests__/manifest-bindings.test.ts src/__tests__/run-owner.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/data.ts apps/board/src/manifest-bindings.ts apps/board/src/run-owner-io.ts apps/board/src/peer/launch-ask.ts apps/board/bin/triage.ts apps/board/src/server.ts apps/board/src/triage/stack.ts apps/board/src/__tests__/forge-url.test.ts apps/board/src/__tests__/board.test.ts apps/board/src/__tests__/launch-ask.test.ts apps/board/src/__tests__/triage-stack.test.ts
git commit -m "board: parse GitHub PR URLs with one canonical project spelling (BOARD-59)"
```

---

### Task 3: Codeowner demand and scope on GitHub

**Files:**
- Modify: `apps/board/src/data.ts:256-270` (`boardDemand`), `data.ts:328-373` (`aggregateSyncScope`), `apps/board/src/server.ts:~933` (the `aggregateSyncScope(reads)` call in `fetchTeamMRs`)
- Test: `apps/board/src/__tests__/board.test.ts`

**Interfaces:**
- Consumes: `BoardConfig.forge` (Task 1).
- Produces: `aggregateSyncScope(reads: SyncScopeRead[], forge: BoardForge['kind'] = 'gitlab')`; `boardDemand(config, port)` keeps its signature.

- [ ] **Step 1: Write the failing tests** in `board.test.ts`:
  - `boardDemand sends no codeownerSections on a GitHub team`: a GitHub config with a codeowners tab gives a demand with no `codeownerSections` key; the same config on GitLab still carries them.
  - `aggregateSyncScope ignores section scope on GitHub`: reads whose scope has `uncoveredSections: ['A']` and `knownSections: ['A']` give `scopeUncoveredSections: []` and `scopeKnownSections: null` with `'github'`, and today's values with no second argument.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/__tests__/board.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** both in `data.ts`, and pass `config.forge.kind` from `fetchTeamMRs`.

- [ ] **Step 4: Run tests and type check**

Run: `cd apps/board && bun test src/__tests__/board.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/data.ts apps/board/src/server.ts apps/board/src/__tests__/board.test.ts
git commit -m "board: no codeowner demand or section scope on GitHub (BOARD-59)"
```

---

### Task 4: The one GitLab door, server refusals and triage skip

**Files:**
- Modify: `apps/board/src/config.ts` (accessor and refusal)
- Modify: `apps/board/src/server.ts`: `gitlab()` 618-623, token getter ~591, `approval_state` read ~1317-1334, `/drafts` post 3456-3530, `/draft` 3532+, `/mr/action` 3841-3888, latch step ~5575-5680
- Modify: `apps/board/bin/triage.ts` (170-183 identity, 236-265 doctor pass, 276-300 nudge pass, 340-390 latch pass)
- Create: `apps/board/src/triage/forge-skip.ts`
- Create: `apps/board/src/__tests__/forge-door.test.ts`, `apps/board/src/__tests__/no-hardcoded-forge.test.ts`, `apps/board/src/__tests__/server-github-team.test.ts`
- Test: `apps/board/src/__tests__/gates-run-mr.test.ts`

**Interfaces:**
- Consumes: `BoardConfig.forge` (Task 1), `projectPathFromWebUrl(webUrl, config)` (Task 2), `onGitHub(mr)` from `apps/board/src/mr-ref.ts`.
- Produces: `export const FORGE_NOT_YET = 'Not available on GitHub yet'`; `export class ForgeNotSupported extends Error` (message `FORGE_NOT_YET`); `export function gitlabOnly(config: Pick<BoardConfig, 'forge'>): string` (the GitLab host, or throws `ForgeNotSupported`), all in `config.ts`. `export function triageForgeSkip(config: Pick<BoardConfig, 'forge'>): string | null` in `src/triage/forge-skip.ts`, returning `'triage: auto-doctor, respond asks and the re-review latch skip GitHub teams for now'` on GitHub, else null.

- [ ] **Step 1: Write the failing unit tests**
  - `forge-door.test.ts`: `gitlabOnly` returns the host for a GitLab forge and throws `ForgeNotSupported` with message `Not available on GitHub yet` for GitHub; `triageForgeSkip` returns the line on GitHub and null on GitLab.
  - `no-hardcoded-forge.test.ts`: reads every `.ts` file under `apps/board/src` and `apps/board/bin` except `__tests__` and `src/latch/gateway.ts`; for each `new GitLabProvider(`, `new NoteMutator(`, `new MRDetailFetcher(` and `latchGateway(` call (its text up to the matching close paren), the arguments contain `gitlabOnly(`. Name: `no board code builds a GitLab client from a hard-coded forge`.
  - `gates-run-mr.test.ts`: a run recording a GitHub PR URL resolves to that URL.

- [ ] **Step 2: Write the failing server test** `server-github-team.test.ts`, copying `boot()` from `server-own-mr.test.ts` (temp HOME, org store, fake rt daemon) with these changes: the org store has `mattstack.integrations: {forge: {provider: 'github', host: 'github.test'}}`, `board.projects: ['o/r']`, no `board.gitlabHost`, roster `alice`, `bob`; the seat is `alice`; the fake daemon answers `project-mrs:read` with two opened GitHub PRs (`provider: 'github'`, `repositoryId: 'github:9'`, `webUrl: 'https://github.test/o/r/pull/<n>'`, alice's #7 and bob's #20) and the gate list with one open `review-post` gate on `mr:https://github.test/o/r/pull/20`. Tests:
  - `a GitHub team boots the real board, not the setup page`: `/healthz` does not report `configured: false`.
  - `/data.json lists the GitHub PRs with their gate`: both rows, `provider` `github`, the gate on #20.
  - `merge, draft and held-draft post refuse a GitHub PR`: POST `/mr/action` (`action: 'merge'`, #7), `/draft` (#7, `draft: true`) and `/drafts` (`action: 'post'` on a held draft seeded with `writeDraft` for #7) each answer 400 with body `Not available on GitHub yet`, and the fake daemon saw no write verb.

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/board && bun test src/__tests__/forge-door.test.ts src/__tests__/no-hardcoded-forge.test.ts src/__tests__/gates-run-mr.test.ts src/__tests__/server-github-team.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**
  - `config.ts`: the three exports above.
  - `server.ts`: `gitlab()`, the `/drafts` `NoteMutator`, the latch `MRDetailFetcher` and `latchGateway` take `gitlabOnly(config)` as host. The GitLab token getter resolves null on a GitHub team, checked per call outside the memo (so the roster name lookup falls to its existing no-token branch). `/mr/action`, `/draft` and the `/drafts` post return `400 FORGE_NOT_YET` when `config.forge.kind === 'github'`, placed after the method, locality and JSON checks and before the token check; after each route's row lookup, `onGitHub(mr)` returns the same 400 (the backstop for a GitHub row on a GitLab board). The latch step after a review signal returns early on a GitHub team, with no log. The `approval_state` read returns its empty result on a GitHub team without calling `forge:get`. The manual doctor launch needs no change: `resolveDispatchIdentity` already turns the thrown refusal into a null identity.
  - `bin/triage.ts`: the identity `GitLabProvider`, `latchGateway` and `MRDetailFetcher` take `gitlabOnly(boardConfig)`. In a non-peer run, when `triageForgeSkip(boardConfig)` returns a line, log it once with `console.log` and skip `resolveUsername`, the doctor pass, the nudge pass and the latch pass; everything else in the run is unchanged. Peer mode is unchanged: its `resolveUsername` throws through `gitlabOnly` into the existing catch, so respond asks wait.

- [ ] **Step 5: Run tests and type check**

Run: `cd apps/board && bun test src/__tests__/forge-door.test.ts src/__tests__/no-hardcoded-forge.test.ts src/__tests__/gates-run-mr.test.ts src/__tests__/server-github-team.test.ts src/__tests__/server-own-mr.test.ts src/__tests__/server-note.test.ts && bun run typecheck`
Expected: PASS; `server-own-mr.test.ts` and `server-note.test.ts` (GitLab) unchanged and green.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/server.ts apps/board/bin/triage.ts apps/board/src/triage/forge-skip.ts apps/board/src/__tests__/forge-door.test.ts apps/board/src/__tests__/no-hardcoded-forge.test.ts apps/board/src/__tests__/gates-run-mr.test.ts apps/board/src/__tests__/server-github-team.test.ts
git commit -m "board: one GitLab door; GitHub teams refuse GitLab-only writes (BOARD-59)"
```

---

### Task 5: Settings wording and the setup page

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:534-549`
- Modify: `apps/board/src/unconfigured.ts:25-27`
- Test: `apps/board/src/__tests__/unconfigured.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** in `unconfigured.test.ts`: the setup page text contains `open merge requests and pull requests`, contains `board.projects`, contains `board.gitlabHost too on a GitLab team`, and does not contain `open GitLab merge requests`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/board && bun test src/__tests__/unconfigured.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - Setup page, first paragraph: `Board lists your team's open merge requests and pull requests. It starts on its own once your team's board settings exist.` Second paragraph keeps the invite and join sentence, then: `To set them up yourself, set <code>board.projects</code> with <code>rt settings</code>, and <code>board.gitlabHost</code> too on a GitLab team.`
  - `board.gitlabHost`: `defaultNote: "Required on a GitLab team."`, `description: "The team's GitLab host, for a team on GitLab, shared by the whole team."`
  - `board.projects`: `description: "Repos the board tracks, as paths on the team's forge (group/project or owner/repo), shared by the whole team."`
  - Then rebuild rt-client's dist: `cd packages/rt-client && bun run build`.

- [ ] **Step 4: Run tests**

Run: `cd apps/board && bun test src/__tests__/unconfigured.test.ts src/__tests__/registry-defaults.test.ts` then, from the worktree root, `bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/registry-defs.ts apps/board/src/unconfigured.ts apps/board/src/__tests__/unconfigured.test.ts
git commit -m "board: forge-neutral setup page and settings wording (BOARD-59)"
```

---

### Task 6: The client on GitHub rows

**Files:**
- Modify: `apps/board/src/client/board/row-actions.ts:600-725` (the forge section), `ActionMenu.tsx:26-45,427` (section headings), `DraftModal.tsx` (post control), `CommentsDrawer.tsx:105,610`, `ReviewDraftCard.tsx:288`
- Modify: `apps/board/src/mr-ref.ts` (a lowercase forge word helper)
- Test: `apps/board/src/client/board/__tests__/row-actions.test.ts`, `menu-fixtures.ts`, `bulk-menu-dom.test.tsx`, `draft-modal-dom.test.tsx`, `comments-drawer-dom.test.tsx`, `review-question-dom.test.tsx` (renders `ReviewDraftCard`)

**Interfaces:**
- Consumes: `onGitHub(mr)` in `apps/board/src/mr-ref.ts`.
- Produces: `export function forgeWord(mr?: MrLinkTarget): 'github' | 'gitlab'` in `mr-ref.ts`. Action keys (`open-gitlab`, the `gitlab` section id) stay as they are; only labels change.

- [ ] **Step 1: Write the failing tests**
  - `menu-fixtures.ts`: `ghOwnIdle = mrx(7, { webUrl: 'https://github.com/acme/webapp/pull/7', provider: 'github', behindTarget: null, ...ownIdle's other overrides })`.
  - `row-actions.test.ts`: `a GitHub own MR keeps only open in github in its forge section` (sections contain `gitlab:open-gitlab` labelled `open in github`, and none of `merge`, `rebase`, `setAutoMerge`, `cancelAutoMerge`, `mark-draft`, `mark-ready`, `refresh-mr`); `auto-merge never leads the menu on a GitHub MR` (approved, CI running, auto-merge visible: no `top:setAutoMerge`); `bulk actions over GitHub rows offer no merge, rebase, auto-merge or draft entry`. The existing GitLab `ownIdle` test stays unchanged.
  - `bulk-menu-dom.test.tsx` (or the row menu DOM test): a GitHub row's forge heading reads `github`; a GitLab row's reads `gitlab`.
  - `draft-modal-dom.test.tsx`: a held draft on a GitHub row shows dismiss and no post control.
  - `comments-drawer-dom.test.tsx`: a GitHub MR's comment link reads `open in github ↗`.
  - `review-question-dom.test.tsx`: a GitHub MR's `ReviewDraftCard` diff link is `<pr url>/files` and names GitHub; a GitLab MR's stays `<mr url>/diffs`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts src/client/board/__tests__/bulk-menu-dom.test.tsx src/client/board/__tests__/draft-modal-dom.test.tsx src/client/board/__tests__/comments-drawer-dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** with `onGitHub` and `forgeWord`: skip the merge, rebase, auto-merge, draft and refresh items on a GitHub row (auto-merge cannot lead `top` there); label the open item `open in ${forgeWord(mr)}`; the forge heading in the row menu and the bulk menu uses `forgeWord` of the menu's MR (the bulk menu's first MR); `DraftModal` renders no post control on a GitHub row; `CommentsDrawer` and `ReviewDraftCard` follow the row's forge. GitLab rows render exactly as today.

- [ ] **Step 4: Run tests and type check**

Run: `cd apps/board && bun test src/client/board/__tests__/ && bun run typecheck`
Expected: PASS, including `menu-key-baseline.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/mr-ref.ts apps/board/src/client/board/row-actions.ts apps/board/src/client/board/ActionMenu.tsx apps/board/src/client/board/DraftModal.tsx apps/board/src/client/board/CommentsDrawer.tsx apps/board/src/client/board/ReviewDraftCard.tsx <each touched test file>
git commit -m "board: GitHub rows offer only what works and name their forge (BOARD-59)"
```

---

### Task 7: A GitHub fixture team and the visual check

**Files:**
- Create: `apps/board/tests/fixture-github/config.json`, `data.json`, `discussions.json`, `meta.json`, `flock-menu.json`, `README.md`
- Create: `apps/board/src/__tests__/fixture-github.test.ts`

**Interfaces:**
- Consumes: `parseConfig` with `forge` (Task 1).

- [ ] **Step 1: Write the failing test** `fixture-github.test.ts`: `parseConfig` of `tests/fixture-github/config.json` gives a github forge; every `data.json` row has `provider: 'github'` and a `webUrl` starting `https://github.com/acme/webapp/pull/`; at least one row has `behindTarget: null`; no row carries `codeownerSections`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/board && bun test src/__tests__/fixture-github.test.ts`
Expected: FAIL (no fixture).

- [ ] **Step 3: Build the fixture** from `tests/fixture/` as the shape reference: `config.json` with `"forge": {"provider": "github", "host": "github.com"}`, `"projects": ["acme/webapp"]`, invented members and `defaultMember` set to one of them; `data.json` with five invented rows (an approved PR, a draft own PR, a PR with an open structured review-post gate, a PR with threads in `discussions.json`, a row with `behindTarget: null`), all with GitHub URLs, `provider: "github"`, `rtRepo` `github.com/acme/webapp`, no `codeownerSections`; `meta.json`'s `now`; `flock-menu.json` copied; a `README.md` saying what each row carries and that everything is invented. Nothing pasted from a real board.

- [ ] **Step 4: Run tests and purity**

Run: `cd apps/board && bun test src/__tests__/fixture-github.test.ts src/__tests__/fixture-mode.test.ts`, then from the worktree root `bun run purity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/tests/fixture-github apps/board/src/__tests__/fixture-github.test.ts
git commit -m "board: a GitHub fixture team (BOARD-59)"
```

- [ ] **Step 6 (controller): Render and look.** From `apps/board`, start `PORT=<free port> BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts` in the background, then in Fast Browser at `http://localhost:<port>`: screenshot the board in light and in dark; open the right-click menu on a GitHub own row and on a teammate's row and screenshot each; open the review gate on the gated row. Do the same light and dark pair for `tests/fixture` (GitLab) to confirm it is unchanged. Say plainly what looks wrong, fix it in the owning task's files, and stop the server by its PID.

---

## Final verification (before the PR)

- `cd apps/board && bun test` (the whole board suite) and `bun run typecheck`
- From the worktree root: `bun run purity` and `bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts packages/rt-client/test/dist-freshness.test.ts`
- Final whole-branch review on `opus` at `xhigh`.
