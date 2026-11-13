# MCP review and comment tools on GitHub: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish GitHub support in `mr_review_submit`, `mr_comment_inline`, `mr_posted_since`, `mr_map` and `respond_post_execute`, add the broad upload root notice and the upload guard refusal tests, and update the docs (RT-321, RT-557, RT-559).

**Architecture:** The MCP tools in `lib/mcp/` call daemon verbs typed in `packages/rt-client/src/commands.ts`. The head pin is a daemon-side read in the `mr:review-submit` handler. The token's GitHub login comes from a new `forge:self` verb over `resolveSelfUsername`. Nothing under `packages/glance` changes.

**Tech Stack:** Bun, TypeScript, `bun:test`, glance 0.31 (Octokit and gitbeaker).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-review-tools-github-design.md`

## Global Constraints

- Run every `bun test` from the worktree root, and only on the files a task touches. Never run the full suite.
- No live forge call in any test. Stub `command`, the provider, or `fetchFn`.
- Never run `rt`, the daemon or a built binary against the real HOME. The reference regen and the skills check run as `env -i HOME=<temp> PATH=<bun dir>:/usr/bin:/bin bun cli.ts ...`.
- Do not touch `MR_WRITE_TIMEOUT_MS`, `MR_ACTION_TIMEOUT_MS`, `DISCUSSIONS_TIMEOUT_MS` or `RT_VERB_TIMEOUT_MS`. Do not state a timeout figure in any tool description.
- GitLab replies and error strings stay byte for byte. The two allowed exceptions are the `mr_comment_inline` landing hint and the outcome validation text, which becomes `outcome must be comment, approve or request_changes`.
- Never write under `packages/glance`, `lib/mcp/shared.ts`, `lib/daemon-client.ts`, `lib/mcp/rt-verb.ts`, `lib/ci/`, `lib/mcp/ci-tools.ts`, `apps/`, `extensions/`, or any skill block.
- No em or en dashes in code, comments, tests or docs. Comments follow clean-code rules: a comment states only a constraint the code cannot show.
- Stage named files only. Never `git add -A`, and never bare `git stash`.
- After any edit to `packages/rt-client/src/`, run `bun run build` in `packages/rt-client`. Its `dist/` is gitignored, so never stage it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A short or uppercase `expectedHeadSha`.** A 7-character sha must be refused before any read. An uppercase full sha must match a lowercase head. Task 2 covers both.
2. **`mr_map` called with a GitHub PR URL in `mrUrl`.** The URL must name the repo, and the rows must carry `ref: "#<iid>"`, never `!<iid>`. Task 6 covers this.
3. **`respond_post_execute` on a GitHub PR from the same repo.** A fix row must still push. Only a fork PR holds the due push, and replies still post on a fork. A PR read with no `sourceProjectPath` (GitHub hides a deleted or private head repo) counts as a fork and holds: this is a deliberate choice. Task 7 covers all three cases.
4. **An upload root written as `~/` with a trailing slash, or as a symlink to HOME.** It still counts as HOME and gets the notice. A relative entry gets none. Task 8 covers this.
5. **`forge:self` on a GitLab repo.** `selfUsername` must never call it there, so GitLab keeps `forge:get "user"` byte for byte. Task 5 asserts which verb ran on each forge.

---

### Task 1: `request_changes` outcome

**Files:**
- Modify: `lib/daemon/review-submit.ts` (the `outcome` type and `parseReviewSubmit`)
- Modify: `packages/rt-client/src/commands.ts:1228` (the `mr:review-submit` payload `outcome`)
- Modify: `lib/mcp/tools.ts:488-537` (`mr_review_submit`: schema enum, handler check, description)
- Test: `lib/daemon/__tests__/review-submit.test.ts`, `lib/daemon/__tests__/discussions-review-submit.test.ts`, `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Produces: `ReviewSubmitInput["outcome"]` is `"comment" | "approve" | "request_changes"`. So is the payload's `outcome` in `Commands["mr:review-submit"]`.

- [ ] **Step 1: Write the failing tests**
  - `review-submit.test.ts`: `parseReviewSubmit({...valid, outcome: "request_changes"})` is `ok: true` with `input.outcome === "request_changes"`. `outcome: "reject"` fails with `outcome must be comment, approve or request_changes`.
  - `discussions-review-submit.test.ts:119`: change the refusal line to send `outcome: "reject"` and expect `{ ok: false, error: "outcome must be comment, approve or request_changes" }`. Add `"request_changes is passed to submitReview unchanged"`, using `stubProvider()` and `seams(stub)`, asserting `stub.sent().outcome === "request_changes"` and `res.ok === true`.
  - `tools.test.ts`: `mr_review_submit` with `outcome: "request_changes"` sends that outcome to `mr:review-submit` through `fakeDaemon`. `outcome: "reject"` returns `outcome must be comment, approve or request_changes` with no daemon call. The tool's `inputSchema.properties.outcome.enum` equals `["comment", "approve", "request_changes"]`.
- [ ] **Step 2: Run them and see them fail**

  Run: `bun test lib/daemon/__tests__/review-submit.test.ts lib/daemon/__tests__/discussions-review-submit.test.ts lib/mcp/__tests__/tools.test.ts`

  Expected: the new cases fail on the old message or the old enum.
- [ ] **Step 3: Implement**
  - Widen the type, the parser, the rt-client payload, the enum and the handler check.
  - Add one description sentence: `outcome "request_changes"` posts the review as changes requested and never approves. On GitHub that is a changes-requested review. On GitLab the reviewer shows as having requested changes.
  - The daemon passes the outcome straight through to `submitReview`.
  - Rebuild rt-client.
- [ ] **Step 4: Run the Step 2 command again.** Expected: PASS.
- [ ] **Step 5: Commit** the six files: `mr_review_submit: request_changes outcome on both forges`.

### Task 2: `expectedHeadSha` on review submit

**Files:**
- Modify: `lib/daemon/review-submit.ts`, `lib/daemon/handlers/discussions.ts:50-54` (`ThreadProvider`) and `:567-611` (the handler), `packages/rt-client/src/commands.ts:920` (`ReviewSubmitData`) and `:1228` (payload), `lib/mcp/tools.ts` (`mr_review_submit`)
- Test: `lib/daemon/__tests__/review-submit.test.ts`, `lib/daemon/__tests__/discussions-review-submit.test.ts`, `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: Task 1's widened types.
- Produces:
  - `ReviewSubmitInput.expectedHeadSha?: string`, and the same optional field on the payload.
  - `ThreadProvider` adds `& Partial<Pick<GitProvider, "fetchSingleMR">>`.
  - `ReviewSubmitData` adds the variant `{ published: false; reason: "head-moved"; expectedHeadSha: string; headSha: string; mrUrl: string }`.

- [ ] **Step 1: Write the failing tests**
  - Parser: a 40-hex and a 64-hex sha in either case are accepted and kept as given. `"abc1234"`, a 41-character string and a non-string all fail with `expectedHeadSha must be a full commit sha`. A missing field leaves `input.expectedHeadSha` undefined.
  - Handler. Extend `stubProvider` with an optional `head?: () => Promise<{ sha?: string } | null>` that becomes `fetchSingleMR(projectPath, iid, user)`; record each call in `calls`.
    - `"a matching head (any case) posts the review"`: head `"ABC..."` (40 chars), expected the lowercase form. `submitReview` is called, and the `fetchSingleMR` call precedes it with args `("g/sub/repo-tools", 7, null)`: the project path, never the numeric `writeRef` id. A second case uses a GitHub repoContext and asserts `("o/r", 7, null)`.
    - `"a moved head posts nothing and answers head-moved"`: `res` equals `{ ok: true, data: { published: false, reason: "head-moved", expectedHeadSha, headSha, mrUrl: MR_URL } }`, and no `submitReview` call is made.
    - `"an unreadable head posts nothing"`: three cases (the read throws `"boom"`, returns `null`, returns `{}`). Each gives `ok: false` with an error starting `could not read the MR's head to check expectedHeadSha; nothing was posted (`. No submit is made.
    - `"a provider without fetchSingleMR reads as an unreadable head"`.
    - `"an abort during the head read posts nothing"`: an `AbortController` aborted inside `head()` gives `{ ok: false, error: "request aborted before the review was posted" }`.
    - `"no expectedHeadSha never reads the head"`: no `fetchSingleMR` call is made.
  - Tool: `expectedHeadSha` is passed through to the daemon payload, and a `head-moved` reply is returned as `ok: true` with that data.
- [ ] **Step 2: Run them and see them fail** (same command as Task 1).
- [ ] **Step 3: Implement**
  - In the handler, after the diff anchoring and before `submitReview`, read the head with `fetchSingleMR(repoCtx.projectPath, iid, null)` when `input.expectedHeadSha` is set. Never pass `writeRef`: GitLab's `fetchSingleMR` queries GraphQL by full path and returns null for a numeric id.
  - The `(<reason>)` is `String(err)` for a throw, `no MR` for null, `no head sha` for a missing sha, and `the provider cannot read the MR` when `fetchSingleMR` is absent.
  - Check `signal?.aborted` after the read.
  - Do not forward `expectedHeadSha` into `submitReview`'s review object, since glance does not know it.
  - Add the schema property (string, "the full head sha you reviewed") and the description sentence from spec item 2.
  - Rebuild rt-client.
- [ ] **Step 4: Run again.** Expected: PASS. Also run `bun run typecheck`, which must be clean. The optional pick must keep other fakes compiling.
- [ ] **Step 5: Commit**: `mr_review_submit: expectedHeadSha refuses a moved head`.

### Task 3: `mr_comment_inline` landing hint

**Files:**
- Modify: `lib/mcp/tools.ts:429-464`
- Test: `lib/mcp/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing tests**, beside the `mr_comment` landing-hint tests (~466):
  - A timed-out `mr_comment_inline` gives an error containing `may still land` and `the MR's discussions`.
  - A daemon-unreachable error gets the same hint.
  - `"no gitlabToken in secrets"` passes through unchanged.
- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/tools.test.ts`. Expected: the first two fail.
- [ ] **Step 3: Implement**: `return withLandingHint(fromResponse(res), "the MR's discussions")`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `mr_comment_inline: landing hint on a timeout`.

### Task 4: `forge:self` daemon verb

**Files:**
- Modify: `packages/rt-client/src/commands.ts`. Add the catalog entry beside `forge:get` (~1312), and add `"forge:self"` after `"forge:get"` in `COMMAND_NAMES` (~1609).
- Modify: `lib/daemon/handlers/mr.ts`. Add the `MRHandlerOverrides.selfUsername` seam (~128), the return type member (~161), and the handler beside `"forge:get"` (~770).
- Create: `lib/daemon/__tests__/forge-self.test.ts`

**Interfaces:**
- Produces:
  - `Commands["forge:self"] = { payload: { repoName: string }; data: { username: string } }`.
  - `MRHandlerOverrides.selfUsername?: (repoName: string, repoPath: string) => Promise<string | null>`, which defaults to `resolveSelfUsername` from `lib/daemon/freshness.ts`.

- [ ] **Step 1: Write the failing tests** in `forge-self.test.ts`. Build them with `createMRHandlers(ctx, () => {}, { selfUsername })`, modelled on `forge-get-github.test.ts`, where `ctx.repoIndex()` maps the identity to `/repo`.
  - `"answers the login"`: the seam returns `"octo"`, giving `{ ok: true, data: { username: "octo" } }`. The seam got `(identity, "/repo")`.
  - `"null answers ok false"`: gives `{ ok: false, error: "could not read the token's own user for <identity>" }`. The repo is named the way `decodeIndexedRepo` names it.
  - `"a non-identity repoName is refused before the seam"`: `decodeIndexedRepo`'s error comes back, and the seam is not called.
  - `"a throwing seam answers ok false with its text"`.
  - The existing `lib/daemon/__tests__/rt-client-commands.test.ts` must still pass. It proves every `COMMAND_NAMES` entry has a handler.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/forge-self.test.ts lib/daemon/__tests__/rt-client-commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the handler. It decodes the payload with `decodeIndexedRepo`, takes `repoPath` from `ctx.repoIndex()`, and returns only the login. Rebuild rt-client.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `daemon: forge:self reads the token's own login`.

### Task 5: `selfUsername` by forge, and `mr_posted_since` on GitHub

**Files:**
- Modify: `lib/mcp/mr-composite-tools.ts:107-113` (`selfUsername`) and `:928-980` (the `mr_posted_since` handler, description and schema)
- Test: `lib/mcp/__tests__/mr-composite-tools.test.ts`. Rewrite the refusal test at ~211-223, update the description test at ~234 (it expects `toStartWith("GitLab only.")`), and delete the `mr_posted_since` line (~340) from the combined refusal test at ~337-342, leaving its `mr_map` line for Task 6.

**Interfaces:**
- Consumes: Task 4's `forge:self`.
- Produces: `selfUsername(deps, identity)`, with the signature unchanged. When `githubProjectOf(identity)` is set it calls `forge:self`, and an error goes through `explainError`. Otherwise it runs the current `forge:get "user"` code unchanged.

- [ ] **Step 1: Write the failing tests**
  - `"selfUsername reads forge:self on GitHub and forge:get user on GitLab"`: using `fake(answers)` with a GitHub identity and a GitLab identity, assert the verb names and payloads called.
  - Rewrite the refusal test as `"mr_posted_since matches a GitHub PR's notes by the token's login"`:
    - Input: `mrUrl: "https://github.com/acme/app/pull/5"`, `by: "me"`.
    - Use the test file's registered GitHub repo block (~315-328, `GH = remote:github.com%2Facme%2Fapp`), because `resolveRepoTarget` only turns a PR URL into a target for a registered repo. So the URL is `https://github.com/acme/app/pull/5`.
    - The fake answers `forge:self` with `{ username: "octo" }`, and `discussions:refresh` with one `gh-review-thread-11` discussion holding a note by `octo` (numeric id, ISO `createdAt` after `since`).
    - Expect `threads[0].posted === true` and `by === "octo"`.
  - `"mr_posted_since on GitHub with a named login skips forge:self"`.
  - A GitLab case keeps the `forge:get` path and its exact error strings.
  - Assert that `mr_posted_since`'s description contains `gh-review-thread-` and does not contain `GitLab only`.
- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/mr-composite-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Drop the two refusals, and resolve with `resolveMrTarget(input, { github: true })`.
  - Update the description and schema text as spec item 5 says.
  - The `"by" must be a GitLab username or "me"` error string stays.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `mr_posted_since: GitHub PRs, login through forge:self`.

### Task 6: `mr_map` on GitHub

**Files:**
- Modify: `lib/mcp/mr-composite-tools.ts:190-197` (`MR_MAP_GH_MOVE`, `defaultBranchOf`) and `:1040-1090` (the handler and description)
- Test: `lib/mcp/__tests__/mr-composite-tools.test.ts`. Rewrite what is left of the combined refusal test at ~337-342, the GitHub refusal test at ~515-524, and the description test at ~526-528 (it expects `toStartWith("GitLab only.")`).

- [ ] **Step 1: Write the failing tests**
  - `"mr_map lists a GitHub repo's PRs from a PR URL"`:
    - Input: `mrUrl: "https://github.com/acme/app/pull/5"`, in the registered GitHub repo block.
    - The fake answers `mr:list-live` with two PRs, `worktree:list` with one tree on PR 5's branch, and `forge:get` path `":repo"` with `{ body: { default_branch: "main" } }`.
    - Expect `mr:list-live`'s `repoName` to be the GitHub identity, rows to carry `ref` `"#5"` and `"#6"`, the tree joined to PR 5, and `forge:get` called with `path: ":repo"` (never `projects/:id`).
  - `"mr_map on GitHub degrades to stacked null when :repo fails"`.
  - A GitLab case still reads `projects/:id` and keeps `!<iid>` refs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - `defaultBranchOf` picks its path with `githubProjectOf(identity) ? ":repo" : "projects/:id"`.
  - Resolve with `resolveRepoTarget(targetInput, { github: true })`.
  - After `joinMrsToWorktrees` on GitHub, map each row's `ref` to `` `#${iid}` ``.
  - Delete `MR_MAP_GH_MOVE`.
  - Description and shellForms say "read live from the forge".
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `mr_map: GitHub PRs`.

### Task 7: `respond_post_execute` on GitHub

**Files:**
- Modify: `lib/mcp/mr-composite-tools.ts`:
  - `readMrUrl` (~550)
  - `expectedBranch` (~729)
  - `executeRespondPost` (~739-870)
  - the default `resolveMr` dep (~45), and the `deps.resolveMr ?? resolveMrTarget` fallback (~768)
  - the description (~983)
  - `RESPOND_POST_GH_MOVE` (~311); delete it if nothing else uses it
- Test:
  - `lib/mcp/__tests__/respond-post-execute.test.ts`: rewrite ~299, and the description test at ~776, which expects `toStartWith("GitLab only.")`.
  - `lib/mcp/__tests__/respond-post-plan.test.ts`: rewrite the `readMrUrl` GitHub refusal at ~494-497 so that a GitHub `mr` field plans normally.

**Interfaces:**
- Consumes: Task 5's `selfUsername`.
- Produces:
  - `ExpectedBranch` gains `fork: string | null`. It is set from `sourceInRepo(t.identity, r.data.mr)` to `the PR's branch lives in another repository, so this tool will not push it`.
  - The default `resolveMr`, and the fallback at ~768, both become `(input) => resolveMrTarget(input, { github: true })`. The seam type is unchanged.
  - A missing or non-string `sourceProjectPath` reads as a fork, because `sourceInRepo` already returns false for it.

- [ ] **Step 1: Write the failing tests.** Let `fake(w)` take the identity and MR URL, which today are hard-wired to `ID` and `MR`, and let it map that identity in `guard.repoIndex` so a fix row passes `checkRegisteredTree`. Use a GitHub `mr` field (`https://github.com/acme/app/pull/5`), the identity `remote:github.com%2Facme%2Fapp`, and an `mr:get` reply carrying `sourceProjectPath: "acme/app"` unless a case says otherwise.
  - `"posts and resolves review threads on a GitHub PR"`: `forge:self` answers `octo`. The replies and resolves go to `discussions:reply` and `discussions:resolve` with `gh-review-thread-*` ids, and `posted` and `resolved` list them.
  - `"a fix row on a same-repo GitHub PR pushes once"`: `sourceProjectPath: "acme/app"`, giving `pushed: { branch }` and exactly one git push.
  - `"a GitHub PR read with no sourceProjectPath holds the fix row as a fork"`.
  - `"a fix row on a fork PR is held as push and nothing is pushed"`:
    - `mr:get` answers `sourceProjectPath: "someone/r"`.
    - `held` equals `[{ threadId, kind: "push", error: "the PR's branch lives in another repository, so this tool will not push it" }]`.
    - No git push call is made.
    - Non-fix rows still post.
  - `"a fork PR with no fix row posts normally"`.
  - `"a reply the daemon refuses on gh-issue-comment lands in held through the write-failure path"`: `discussions:reply` answers `ok: false` with the daemon text, and the held row carries that text.
  - The description test at ~776 becomes `"its description states the four rules in order and names GitHub's held outcomes"`. The description lacks `GitLab only` and `On GitHub it refuses`, and contains `held`.
- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/respond-post-execute.test.ts lib/mcp/__tests__/respond-post-plan.test.ts lib/mcp/__tests__/mr-composite-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Drop the three refusals.
  - Put `branch.fork` first in the `if (branch?.notOpen) ... else if (treePath !== null && branch !== null)` chain, as `if (branch?.fork)`. A non-null value holds each fix row with kind `"push"` and the fork text, and skips the push. So a merged fork PR reports the fork reason.
  - The `GitLab no longer returns thread ...` string stays for GitLab. On GitHub, say `GitHub no longer returns thread ...`.
  - Description per spec item 7.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `respond_post_execute: GitHub PRs, fork push held`.

### Task 8: broad upload roots notice

Load the `rt:settings` skill before editing.

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts`, beside the `mattstack.directory` block (~208)
- Test: `packages/rt-client/src/settings/__tests__/write.test.ts`

**Interfaces:**
- Produces: a module-private `broadUploadRoots(entries: string[], home: string): string[]`, which returns the entries that need the notice.

- [ ] **Step 1: Write the failing tests.** Capture through `setSettingsNoticeSink`, as the directory-notice test at ~251 does. Set `HOME` to a temp dir that has a symlink to itself inside.
  - Writing `rt.mcp.uploadRoots` as `["/", HOME, HOME + "/", dirname(HOME), symlinkToHome, HOME + "/shots", "relative/dir"]` gives exactly one notice for each of the first five. Each reads `<entry> is a very broad folder: mr_upload and evidence_attach may send any image or video under it off this Mac. Name a narrower folder.` The last two get none.
  - The write still lands: `getSetting` reads the value back.
  - A non-existent absolute path under HOME gets no notice. A non-existent ancestor is resolved with `path.resolve`.
- [ ] **Step 2: Run** `bun test packages/rt-client/src/settings/__tests__/write.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Resolve each absolute entry with `realpathSync`, falling back to `path.resolve`.
  - Compare it with `realpathSync(process.env.HOME)`, read at call time.
  - An entry is broad when it equals `/`, equals home, or home starts with `entry + sep`.
  - Rebuild rt-client.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `settings: warn on a very broad rt.mcp.uploadRoots entry`.

### Task 9: upload guard refusal tests

**Files:**
- Modify: `lib/daemon/upload-guard.ts:155-200` (`readVerified`), `:204` (`AdmitOpts`), `:226-275` (pass-through)
- Test: `lib/daemon/__tests__/upload-guard.test.ts`, `lib/daemon/__tests__/mr-upload.test.ts`

**Interfaces:**
- Produces: `type GuardFs = Pick<typeof import("fs"), "openSync" | "fstatSync" | "readSync" | "closeSync">`. Both `checkUploadPath`'s and `checkTextPath`'s `opts` gain `fs?: GuardFs`, which defaults to the real module. No production caller passes it.

- [ ] **Step 1: Write the failing tests** in `upload-guard.test.ts`. Use a real PNG in an admitted temp root, and wrap the real fs so that only the named call is faked.
  - Identity mismatch: `fstatSync` reports `ino + 1`, giving `file changed identity between check and read`.
  - Swap: `openSync` opens a different real file with the same size, giving the same text.
  - Short read: `readSync` returns 0 on its first call, giving `file read short of its reported size`.
  - Grew: the probe `readSync` (the call with length 1 at offset size) returns 1, giving `file grew during read`.
  - Run each case through `checkUploadPath`, and run one of them through `checkTextPath` too. Assert that `closeSync` ran in every case.
- [ ] **Step 2: Write the handler test** in `mr-upload.test.ts`: `"the upload sends the verified bytes even when the file is swapped after the check"`.
  - The `repoContext` seam overwrites the file with different bytes of the same type, then returns the usual fake context.
  - Assert that the multipart body captured by `fetchFn` contains the original bytes and none of the new ones.
- [ ] **Step 3: Run** `bun test lib/daemon/__tests__/upload-guard.test.ts lib/daemon/__tests__/mr-upload.test.ts`. Expected: the guard tests fail on the missing `fs` option. The handler test may already pass, and it stays as a regression pin.
- [ ] **Step 4: Implement** the `fs` seam. `readVerified` takes the fs as a parameter, and the two exports pass `opts.fs ?? realFs`.
- [ ] **Step 5: Run again.** Expected: PASS.
- [ ] **Step 6: Commit**: `upload guard: tests for the rare read refusals`.

### Task 10: docs and rules

Load the `rt:docs` skill before editing `mcp.mdx`.

**Files:**
- Modify: `sites/docs/docs/skills/mcp.mdx`, `.claude/rules/mcp-and-gates.md`

- [ ] **Step 1: Edit `mcp.mdx`.**
  - For each row marked GitLab only, read the tool's handler in `lib/mcp/` before changing it.
  - Drop "(GitLab only)" where the code works on both forges. That covers each `mr_*` write except `mr_upload`, the reads except the ones the code still limits, and the three composites.
  - Rewrite the line that says every `mr_*` tool is GitLab only (~315) to name what is still GitLab only.
- [ ] **Step 2: Edit `mcp-and-gates.md`.**
  - The composites now cover both forges.
  - `forge:self` is the login read, and it never widens `forge:get`.
  - `mr_review_submit` takes `request_changes` and `expectedHeadSha`.
- [ ] **Step 3: Run** `bun run docs:check`. Expected: exit 0.
- [ ] **Step 4: Commit** both files: `docs: MCP review and composite tools on GitHub`.

### Task 11: reference, plugin version, verification

**Files:**
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md`, `plugins/mattstack/.claude-plugin/plugin.json`, and any compiled plugin output the skills check names

- [ ] **Step 1: Regenerate the reference** under an isolated HOME:

  `T=$(mktemp -d) && env -i HOME=$T PATH=$(dirname $(command -v bun)):/usr/bin:/bin bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`

  Expected: the diff shows only the changed tools.
- [ ] **Step 2: Run the reference test** with a shim `rt` on PATH:
  - Create `$T/bin/rt`, which runs `exec bun <worktree>/cli.ts "$@"`.
  - Run `env -i HOME=$T PATH=$T/bin:<bun dir>:/usr/bin:/bin sh plugins/mattstack/tests/test-mcp-tools-reference.sh`.
  - Expected: `ok   mcp-tools-reference`.
- [ ] **Step 3: Run the strict skills check**: `mkdir -p $T/ms && env -i HOME=$T PATH=<bun dir>:/usr/bin:/bin bun cli.ts skills check --pack-dir $PWD/plugins/mattstack --mattstack-dir $T/ms --strict`.
  - Expected: clean.
  - If it reports compile drift, run `bun cli.ts skills compile --pack-dir $PWD/plugins/mattstack --mattstack-dir $T/ms` the same way, then re-check.
- [ ] **Step 4: Run** `bun run typecheck`, `bun run purity`, `bun run docs:check`, and `bun test` on every test file Tasks 1 to 9 touched. Expected: all green.
- [ ] **Step 5: Bump the plugin version.** Run `git fetch origin main`, read `origin/main:plugins/mattstack/.claude-plugin/plugin.json`, and set this branch's version one patch past it.
- [ ] **Step 6: Commit** the reference, `plugin.json` and any recompiled output: `mattstack plugin: regenerate MCP reference, bump version`.
- [ ] **Step 7: Note for the PR body and the report.** This is not a code step.
  - The PR body carries an engine-floor line, because MCP tool schemas and descriptions changed.
  - It names `request_changes` as new GitLab behaviour.
  - It names the follow-up for another lane: the review skill's `compose-review` block still maps `request_changes` to `comment` and does not pass `expectedHeadSha`.
