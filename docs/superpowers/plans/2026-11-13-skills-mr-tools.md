# Forge skills on the mr tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mattstack plugin's forge skills and the shepherdr job template off `gh pr list/view/create` onto `mr_map`, `mr_resolve_branch`, `mr_list` and `mr_create`, with forge-aware copy (RT-569).

**Architecture:** Skill sources are block trees under `plugins/mattstack/attachments/` (an `index.block.md` with a Mermaid graph, one `*.block.md` per section or judgment node). Edits go to sources only; compiled output is regenerated. Each skill change is proven by a RED transcript (baseline compiled skill) and a GREEN transcript (edited compiled skill) from a fresh agent given fixture tool results.

**Tech Stack:** Markdown block trees, Mermaid/dot graphs, `bun cli.ts skills compile|check`, `tests/certify.sh`, `check-dot.py`.

**Spec:** `docs/superpowers/specs/2026-11-13-skills-mr-tools-design.md`

## Global Constraints

- Write only under `plugins/mattstack/` (never `attachments/pipeline/watch-ci/` or `attachments/pipeline/stage-watch-ci/`), `docs/superpowers/plans/`, `docs/superpowers/specs/`, `.superpowers/`.
- Every GitLab tool call and its arguments stay; GitLab reaches the same tools, gates and terminals in the same order. Allowed GitLab-side graph changes: delete checkout's `mr_forge_host` and `ticket_forge_host`, sync-open-mrs's `forge_host` and `git_remote_url`; relabel STOP and error edges forge-neutral.
- Copy: PR and `#12` on GitHub, MR and `!12` on GitLab, "MR or PR" where unknown. Internal names (verb names, tool names, node ids) stay.
- No em or en dashes anywhere. Skills cite other skills by name, never by repo path. No stale prohibitions.
- Graph node ids are short snake_case ids (certify requires them).
- Never run `rt`, the daemon or a built binary against the real HOME; every `bun cli.ts` call runs under `env -i HOME=$SCRATCH/home PATH="$PATH" TMPDIR=$SCRATCH`.
- No live forge calls. Scenarios use fixture tool results.
- Stage named files only; commit after each task.
- Never touch `~/Documents/GitHub/repo-tools`, the installed plugin cache, or `packages/glance/harness_credentials.json`.

### Commands every task uses

`$WT` = `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/beorn`; `$SCRATCH` = the session scratchpad (`/private/tmp/claude-501/-Users-matt--mattstack-rt-worktrees-gh-m4ttstack-mattstack-beorn/1280045d-f2d6-42a9-879d-0dca0790cf21/scratchpad`).

**Engine compile (CI's way), from `$WT`:**

```bash
S=$SCRATCH/new && rm -rf $S && mkdir -p $S/home $S/ms/plugins $S/pack/pack $S/pack/.claude-plugin
cp -R plugins/mattstack $S/ms/plugins/mattstack
cp plugins/mattstack/tests/graph-roster.jsonc $S/pack/pack/stubs.jsonc
cp plugins/mattstack/tests/graph-skills.jsonc $S/pack/pack/skills.jsonc
echo '{"name": "widgets", "version": "0.1.0"}' > $S/pack/.claude-plugin/plugin.json
env -i HOME=$S/home PATH="$PATH" TMPDIR=$S bun cli.ts skills compile --pack-dir $S/pack --mattstack-dir $S/ms
python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids $S/pack/skills/<verb>/SKILL.md
```

Expected: `[ok] Compiled <verb>` and check-dot exits 0 with no warnings. The baseline (pre-change) compile already sits at `$SCRATCH/base/pack/skills/<verb>/SKILL.md`; never overwrite `$SCRATCH/base`.

**Certify a source folder, from `$WT/plugins/mattstack`:** `sh tests/certify.sh attachments/forge/<skill>/` (or `attachments/orchestration/shepherdr/`). Expected: no `FAIL` line.

**RED/GREEN transcript:** dispatch a fresh agent (Agent tool, `model: sonnet`, `effort: medium`, `subagent_type: general-purpose`) with this prompt, filling the two paths:

> Read the skill at `<compiled SKILL.md>` and follow it for the scenario in `<scenario file>`. Do not run any command or tool: the scenario gives every tool result you need. Reply with the ordered list of calls you would make (tool or shell command, with arguments), what you would do with each result, and the final report you would give. Stop at the skill's end node.

RED uses `$SCRATCH/base/pack/skills/<verb>/SKILL.md`, GREEN uses `$SCRATCH/new/pack/skills/<verb>/SKILL.md` (for the job template, the `references/job-template.md` beside the compiled shepherdr). Save each reply verbatim to `plugins/mattstack/docs/superpowers/tests/2026-11-13-skills-mr-tools/<red|green>-<scenario id>.md`, with a first line `# <RED|GREEN> <scenario id>: <verdict>`. If the implementer cannot spawn agents, it reports DONE_WITH_CONCERNS naming the transcripts left, and the controller runs them.

A GREEN passes when the calls match the scenario's **Expected** line and no shell command a tool covers appears (`gh pr`, `glab`, `git worktree list` where the tool joins, `git push`).

## Review Focus

1. A GitLab MR link given to checkout must never take the fork edge: a GitLab `mr_resolve_branch` result has no `sourceProjectPath`, and only a github.com origin makes a result a GitHub one. Pinned by scenario C7 (Task 4).
2. A GitHub PR whose `sourceProjectPath` is absent (token cannot see the head repo) or null (deleted fork) counts as a fork, not a same-repo PR. Pinned by scenarios C2b and C2c (Task 4).
3. A ticket search on GitHub whose single matching row is a fork PR must stop at the fork terminal, not provision. Pinned by scenario C3b (Task 4).
4. sync-open-mrs on GitHub with a `dirty: null` row that has a worktree skips that tree up front and says why. Pinned by scenario S1 (Task 3).
5. The job template on a GitLab origin still produces today's `mr_create` node with no `draft` argument. Pinned by scenario J2 (Task 5).

---

### Task 1: Scenarios and RED baselines

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-11-13-skills-mr-tools/scenarios.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-11-13-skills-mr-tools/red-<id>.md` (one per scenario)

**Interfaces:**
- Produces: scenario ids used by Tasks 2 to 5: M1, M2, S1, S2, C1, C2, C2b, C2c, C3, C3b, C3c, C7, J1, J2.

Every `mr_resolve_branch` fixture carries `webUrl` (the fork rule compares `sourceProjectPath` with the `<owner>/<repo>` in it); every GitHub fixture's `webUrl` is under `https://github.com/acme/app/pull/<n>`.

- [ ] **Step 1: Write `scenarios.md`**, one `## <id>` section per scenario, each with **Given** (the user's request, cwd `/work/acme` and its origin URL), **Fixtures** (every tool result as JSON), and **Expected** (the calls and end node after the change):
  - M1 map-open-mrs, origin `git@github.com:acme/app.git`. Fixture `mr_map` returns two rows (`#12` branch `feat-a` with worktree `/work/acme-feat-a`, `#15` branch `feat-b` worktree null), `complete: true`. Expected: one `mr_map {repoName: "/work/acme", author: "me"}`, table with `#12` paired and `#15` NONE; no `gh`, no `git worktree list`.
  - M2 map-open-mrs, origin `git@gitlab.com:acme/app.git`, same rows with `!12`/`!15`. Expected: identical call; table as today.
  - S1 sync-open-mrs, GitHub origin. `run_enter` returns started; `mr_map` returns `#12` `feat-a` worktree `/work/a` `dirty: false`, `#15` `feat-b` worktree `/work/b` `dirty: null`, `#18` `feat-c` worktree null, `complete: true`. Expected: `mr_map {repoName, author: "me"}` with no `git remote get-url` before it; the plan sentence rebases `feat-a`, skips `feat-b` (dirty read failed, not known clean) and `feat-c` (NONE); no `gh`, no `git status --porcelain`. Stop at the sweep gate.
  - S2 sync-open-mrs, GitLab origin, same rows with `!`. Expected: same calls and plan as today's GitLab walk (the RED shows today's walk; GREEN must match it, minus the `git remote get-url` read).
  - C1 checkout `https://github.com/acme/app/pull/12`. `mr_resolve_branch` returns `{iid: 12, state: "opened", author: "dana", sourceBranch: "fix-x", webUrl: "https://github.com/acme/app/pull/12", sourceProjectPath: "acme/app", trees: []}`; `worktree_provision` returns `{path: "/work/acme-fix-x"}`. Expected: `mr_resolve_branch {repoName, mrUrl}`, `worktree_provision {repoName, branch: "fix-x"}`, report the path; no `gh`.
  - C2 checkout `#40` on GitHub; `mr_resolve_branch` returns `sourceProjectPath: "someone/app-fork"`, `sourceBranch: "main"`, `trees: []`. Expected: ends at **Fork PR: reported**; no `worktree_provision`.
  - C2b as C2 but `sourceProjectPath` is absent from the result. Expected: same as C2.
  - C2c as C2 but `sourceProjectPath: null` (deleted fork). Expected: same as C2.
  - C3 checkout ticket `RT-77` on GitHub. `mr_list {search: "RT-77", state: "all", limit: 200}` returns one row `{iid: 31, title: "RT-77: tidy", sourceBranch: "rt-77-tidy", state: "merged"}`, `truncated: false`; `mr_resolve_branch {iid: 31}` returns same-repo `sourceProjectPath: "acme/app"`, `trees: []`; `worktree_provision` returns a path. Expected: `mr_list` with those args, then `mr_resolve_branch {repoName, iid: 31}`, then `worktree_provision {branch: "rt-77-tidy"}`; report names state merged.
  - C3b as C3 but `mr_resolve_branch {iid: 31}` returns `sourceProjectPath: "someone/app-fork"`. Expected: ends at **Fork PR: reported**.
  - C3c checkout ticket `RT-88` on GitHub. `mr_list {search: "RT-88", state: "all", limit: 200}` returns 200 rows (described in a sentence, not listed), none carrying `RT-88` in `title` or `sourceBranch`, `truncated: true`; the second read `mr_list {state: "all", limit: 200}` also returns 200 rows with none carrying it, `truncated: true`. Expected: both reads, then the clarify gate with a sentence saying the search was cut at 200 rows; no `worktree_provision`.
  - C7 checkout `https://gitlab.com/acme/app/-/merge_requests/9`, origin on gitlab.com. `mr_resolve_branch` returns `{iid: 9, state: "opened", sourceBranch: "fix-y", trees: []}` with no `sourceProjectPath`. Expected: `mr_resolve_branch`, `worktree_provision {branch: "fix-y"}`; never the fork terminal.
  - J1 a herd worker with the job template's graph, GitHub origin, goal says open a PR, `git_push` ok. Expected: `mr_create {repoName, sourceBranch, targetBranch, title, description, draft: false}`; no `gh pr create`.
  - J2 the same on a GitLab origin. Expected: `mr_create {repoName, sourceBranch, targetBranch, title, description}` with no `draft` argument.

- [ ] **Step 2: Run RED for every scenario** against the baseline compiled skills (`map-open-mrs`, `sync-open-mrs`, `checkout`, and `$SCRATCH/base/pack/skills/shepherdr/references/job-template.md` for J1 and J2). Save each `red-<id>.md`. Expected: M1, S1, C1, C2, C2b, C2c, C3, C3b, C3c and J1 show a `gh` call (or the wrong provision for C2/C2b/C2c/C3b; `gh pr list --search` for C3c); M2, S2, C7 and J2 record today's GitLab walk, which GREEN must reproduce.

- [ ] **Step 3: Commit**

```bash
git add plugins/mattstack/docs/superpowers/tests/2026-11-13-skills-mr-tools/
git commit -m "skills-mr-tools: scenarios and RED baselines (RT-569)"
```

### Task 2: map-open-mrs on mr_map for both forges

**Files:**
- Modify: `plugins/mattstack/attachments/forge/map-open-mrs/index.block.md`
- Modify: `plugins/mattstack/attachments/forge/map-open-mrs/1-gitlab-one-mr-map-call.block.md` (content only; keep the filename so block ids stay stable)
- Modify: `plugins/mattstack/attachments/forge/map-open-mrs/4-emit.block.md` (`order: 2`)
- Delete: `plugins/mattstack/attachments/forge/map-open-mrs/2-github-list-the-open-prs.block.md`, `3-github-list-local-worktrees-and-join.block.md`
- Modify: `plugins/mattstack/tests/graph-roster.jsonc` (map-open-mrs description: `"CI graph roster: map-open-mrs"`)

**Interfaces:**
- Consumes: scenarios M1, M2 and their RED transcripts from Task 1.

- [ ] **Step 1: Edit the sources.**
  - index: `allowed-tools` drops `Bash(gh pr list:*)` and `Bash(git worktree list:*)` (leave the key out if the list is empty); the description drops "The discovery step of sync-open-mrs." and stays a "Use when" listing trigger; the body's "so a downstream sweep knows what it's touching before it acts" becomes "so you can see what each open MR or PR has checked out locally".
  - block 1: `label: Map call`, title `# 1. One \`mr_map\` call`; text applies to both forges; the cut sentence says "cut at 200 open MRs" on GitLab, "200 open PRs" on GitHub, told apart by the rows' `ref` marker (`!` or `#`); "A forge error is the whole result, quoted, with no table." "Then go to step 2."
  - Emit: title `# 2. Emit`; header first column `MR or PR ref`; drop the "contract a caller downstream ... reads" sentence.
- [ ] **Step 2: Engine compile and check-dot** (Commands). Expected: `[ok] Compiled map-open-mrs`, check-dot clean.
- [ ] **Step 3: GREEN for M1 and M2.** Expected per scenarios; save `green-M1.md`, `green-M2.md`.
- [ ] **Step 4: Certify** `attachments/forge/map-open-mrs/`. Expected: no `FAIL`.
- [ ] **Step 5: Commit** the named files with message `map-open-mrs: one mr_map call on both forges (RT-569)`.

### Task 3: sync-open-mrs on mr_map for both forges

**Files:**
- Modify: `plugins/mattstack/attachments/forge/sync-open-mrs/index.block.md`
- Modify: `.../sync-open-mrs/plan-sweep.block.md`, `all-selected.block.md`, `mr-map-result.block.md`, `report-branch-buckets.block.md`
- Delete: `.../sync-open-mrs/follow-map-open-mrs.block.md`
- Modify: `plugins/mattstack/README.md:243-251` (map-open-mrs and sync-open-mrs rows)
- Modify: `plugins/mattstack/attachments/forge/rebase-worktree/index.block.md`, `gate-push.block.md` (copy only)

**Interfaces:**
- Consumes: scenarios S1, S2.

- [ ] **Step 1: Edit the graph** in `index.block.md`: delete nodes `git_remote_url`, `forge_host`, `follow_map_open_mrs` and their edges; `run_enter_mode -->|started|`, `inherit_run -->` and `keep_recorded_answers -->` now point at `mr_map`. Rename `stop_gitlab_mr_read` to `stop_shell_mr_read` labelled `STOP: MR and PR reads go through mr_map`; hang its "tempted to list MRs or PRs with the GitLab CLI or gh" edge from `run_enter_mode` (a decision node) and return it to `mr_map`. `mr_map_result`'s error edge label becomes `forge error: quoted`. Intro prose: "The sweep covers the open MRs or PRs `mr_map` returns." `allowed-tools` drops `Bash(gh pr list:*)`, `Bash(git worktree list:*)`, `Bash(git -C * status:*)`, `Bash(git -C * remote get-url:*)`; keeps `Bash(git -C * log:*)`.
- [ ] **Step 2: Edit the blocks.** `plan-sweep` and `all-selected`: keep only the `mr_map` rules (`dirty` true or null with a tree skips; `complete: false` means cut at 200 open MRs or PRs); remove every `gh pr list` and porcelain clause. `mr-map-result` and `report-branch-buckets`: "GitLab error" becomes "the forge's error". The report's MR/PR noun follows the rows' `ref` marker.
- [ ] **Step 3: README rows:** map-open-mrs "pair every one of the user's open MRs or PRs with the local worktree holding its branch, in one `mr_map` call"; sync-open-mrs "it maps with `mr_map` on both forges, then syncs with ...".
- [ ] **Step 3b: rebase-worktree copy** (`plugins/mattstack/attachments/forge/rebase-worktree/index.block.md` description "a stale MR branch" becomes "a stale MR or PR branch"; `gate-push.block.md` "an open MR others may have pulled" becomes "an open MR or PR others may have pulled" on both lines it appears, 15 and 31). Copy only; no graph change. Certify `attachments/forge/rebase-worktree/` in Step 6 too.
- [ ] **Step 4: Engine compile and check-dot.** Expected: `[ok] Compiled sync-open-mrs` and `rebase-worktree`, check-dot clean, and `grep -c 'follow-map-open-mrs\|map-open-mrs' $S/pack/skills/sync-open-mrs/SKILL.md` prints 0.
- [ ] **Step 5: GREEN for S1 and S2.** S1 must skip `feat-b` saying its dirty read failed (Review Focus 4). Save transcripts.
- [ ] **Step 6: Certify** `attachments/forge/sync-open-mrs/` and `attachments/forge/rebase-worktree/`.
- [ ] **Step 7: Commit** with message `sync-open-mrs: mr_map on both forges (RT-569)`.

### Task 4: checkout on the read tools, with the fork stop

**Files:**
- Modify: `plugins/mattstack/attachments/forge/checkout/index.block.md`
- Modify: `.../checkout/mr-resolve-result.block.md`, `pick-branch.block.md`, `gate-which-branch.block.md`, `reading-gitlab-facts.block.md`
- Create: `.../checkout/picked-github-row.block.md` (`node: picked_github_row`)
- Modify: `plugins/mattstack/attachments/forge/checkout-and-open/index.block.md`, `1-check-it-out.block.md`

**Interfaces:**
- Consumes: scenarios C1, C2, C2b, C2c, C3, C3b, C3c, C7.

- [ ] **Step 1: Edit the graph** in `checkout/index.block.md`:
  - Delete `mr_forge_host`, `ticket_forge_host`, `gh_pr_view`, `gh_pr_list_search` and their edges.
  - `what_given -->|an MR or PR link, !iid, #number, or number| mr_resolve_branch`; `what_given -->|a ticket id| mr_list_search`.
  - Replace the two STOP nodes with `stop_shell_mr_read[STOP: MR and PR reads go through the read tools]:::stop` (edge `what_given -->|tempted to read the MR or PR with the GitLab CLI or gh| stop_shell_mr_read`, then `--> mr_resolve_branch`) and `stop_shell_ticket_search[STOP: ticket searches go through the read tools]:::stop` (edge `what_given -->|tempted to search with the GitLab CLI or gh| ...`, then `--> mr_list_search`).
  - New `picked_github_row{A GitHub PR row picked?}`: `one_branch -->|yes| picked_github_row` and `branch_answer -->|a candidate| picked_github_row`; `picked_github_row -->|yes| mr_resolve_row` where `mr_resolve_row[/"mr_resolve_branch {repoName, iid: <row iid>}"/]` goes `--> mr_resolve_result`; `picked_github_row -->|no: GitLab, or a branch name| git_worktree_list`.
  - `mr_resolve_result -->|a GitHub PR whose branch lives in a fork| fork_pr` with terminal `fork_pr(((Fork PR: reported)))`. Error edges read `a forge error: quoted in the gate's sentence`; `one_branch`'s no edge reads `no: several, none, a forge error, or a truncated read`.
  - `allowed-tools` drops `Bash(gh pr view:*)` and `Bash(gh pr list:*)`.
- [ ] **Step 2: Edit the blocks.**
  - `mr-resolve-result`: add the fork rule. A result is a GitHub one when `git_remote_origin`'s URL is on github.com. On GitHub, the PR's branch is this repo's only when `sourceProjectPath` equals the `<owner>/<repo>` in its `webUrl`; when it differs, is null (deleted fork) or is absent (head repo unreadable), the result is a fork PR: never call `worktree_provision`, end at **Fork PR: reported** with one sentence: `#<n>`'s branch `<sourceBranch>` lives in a fork (`<sourceProjectPath>`, or "a repository this token cannot see"), not on origin, so nothing was checked out. A GitLab result has no `sourceProjectPath` and is never a fork. Errors: "the forge's error ... quoted". Copy says MR or PR. The sentence saying `git worktree list` and `Branch already checked out?` "stay for a branch name, a ticket id and GitHub" becomes "stay for a branch name and a GitLab ticket pick".
  - `picked-github-row` (new, `node: picked_github_row`, `# A GitHub PR row picked?`): yes when the pick came from an `mr_list` row on a github.com origin; resolve it by its `iid` so it gets the fork check and its trees; a branch name given verbatim, or any GitLab pick, is no.
  - `pick-branch`: the `mr_list` reads are the same on both forges. Every GitLab-only phrase changes:
    - "The GitLab tools and `worktree_provision` take" becomes "The read tools and `worktree_provision` take".
    - "asks GitLab for every MR whose title or description carries it" becomes "asks the forge for every MR or PR whose title or description (on GitHub, also a comment) carries it".
    - "GitLab's `search` never looks at the source branch" becomes "The forge's search never looks at the source branch".
    - "GitLab held more rows" becomes "the forge held more rows".
    - "usually GitLab's" becomes "usually the forge's".
    - "none of the rows GitLab returned" becomes "none of the rows the forge returned"; "not that no MR exists" becomes "not that no MR or PR exists".
    - Drop "(GitHub: head branch)".
    - The cross-reference "Reading a GitLab fact no read tool returns" becomes "Reading a forge fact no read tool returns", matching the renamed section.
  - `gate-which-branch`: "quoting the forge's error".
  - `reading-gitlab-facts`: title `# Reading a forge fact no read tool returns`; `gitlab_get` takes `path` with `:id` for this project on GitLab, or under `:repo/` on GitHub; the branch-search example stays as the GitLab example; errors quoted as the forge wrote them.
  - checkout-and-open: `allowed-tools` drops `Bash(gh pr view:*)`; description says "open this MR or PR locally"; step 1 says "MR or PR link".
- [ ] **Step 3: Engine compile and check-dot** for `checkout` and `checkout-and-open`. Expected: both compile, check-dot clean, `grep -c 'gh pr' $S/pack/skills/checkout/SKILL.md` prints 0.
- [ ] **Step 4: GREEN for C1, C2, C2b, C2c, C3, C3b, C3c, C7.** C2, C2b, C2c and C3b end at **Fork PR: reported** with no `worktree_provision`; C3c reaches the clarify gate naming the cut; C7 walks today's GitLab calls (Review Focus 1 to 3).
- [ ] **Step 5: Certify** `attachments/forge/checkout/` and `attachments/forge/checkout-and-open/`.
- [ ] **Step 6: Commit** with message `checkout: read tools on both forges, stop on a fork PR (RT-569)`.

### Task 5: shepherdr job template on mr_create

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md:56-96,220-224`

**Interfaces:**
- Consumes: scenarios J1, J2.

- [ ] **Step 1: Edit.** Replace node `gh_pr_create` with `mr_create_github [label="mr_create {repoName, sourceBranch, targetBranch, title, description, draft: false}" shape=plaintext];`; `forge_host -> mr_create_github [label="GitHub"]; mr_create_github -> work_method;`. The GitLab node and edges stay byte for byte. Git section: "then `mr_create` on a GitLab origin, or `mr_create` with `draft: false` on a GitHub origin, so the PR opens ready."
- [ ] **Step 2: Compile the pack's own verbs** from `$WT`: `env -i HOME=$SCRATCH/new/home PATH="$PATH" TMPDIR=$SCRATCH bun cli.ts skills compile --pack mattstack --pack-dir $WT/plugins/mattstack`. Expected: `skills/shepherdr/references/job-template.md` matches the source; then `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py --short-ids plugins/mattstack/skills/shepherdr/SKILL.md` clean.
- [ ] **Step 3: GREEN for J1 and J2** (use `plugins/mattstack/skills/shepherdr/references/job-template.md`). J2 must show no `draft` argument (Review Focus 5).
- [ ] **Step 4: Certify** `attachments/orchestration/shepherdr/`.
- [ ] **Step 5: Commit** the source and the recompiled `plugins/mattstack/skills/shepherdr/` with message `shepherdr: job template opens GitHub PRs with mr_create (RT-569)`.

### Task 6: Version, floor, regenerated output and full verification

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version one past `origin/main`'s)
- Modify: `plugins/mattstack/pack/requires.json` (`minEngine` = that version)
- Modify: recompiled `plugins/mattstack/skills/**`, `plugins/mattstack/pack/compiled.lock.json`, `plugins/mattstack/attachments/mcp-tools/reference.md` if regeneration changes it

- [ ] **Step 1:** `git fetch origin main`; if `origin/main` moved past the branch base, `git merge origin/main` and resolve. Read `origin/main`'s plugin version; set ours one past it; set `minEngine` to the same string.
- [ ] **Step 2: Recompile the pack's own verbs** (Task 5 Step 2 command) and regenerate the reference from `$WT`: `env -i HOME=$SCRATCH/new/home PATH="$PATH" RT_SKIP_SETUP=1 RT_BATCH=1 bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- [ ] **Step 3: Run every check.** Expected: each passes.
  - `env -i HOME=$SCRATCH/new/home PATH="$PATH" TMPDIR=$SCRATCH bun cli.ts skills check --pack-dir $WT/plugins/mattstack --mattstack-dir $SCRATCH/ms-empty --strict` (create `$SCRATCH/ms-empty` first)
  - `sh plugins/mattstack/tests/test-mcp-tools-reference.sh`
  - Engine compile (Commands) plus `bun scripts/ci/block-graphs-compiled.ts plugins/mattstack/attachments $S/pack` and check-dot on every compiled `SKILL.md` holding a graph
  - From `plugins/mattstack`: `bash plugin/skills/process-digraphs/test-check-dot.sh`, and the certify loop from `checks.yml`'s "Certify every skill and attachment dir" step
  - From `$WT`: `bun run docs:check`, `bun run typecheck`, `bun run purity`
  - `grep -rn 'gh pr' plugins/mattstack/attachments plugins/mattstack/skills plugins/mattstack/plugin` prints only `ci-forge-contract.md` lines, `reference.md` prose, and the lint fixtures at `plugin/skills/process-digraphs/test-check-dot.sh:75,96`
  - `env -i HOME=$SCRATCH/new/home PATH="$PATH" TMPDIR=$SCRATCH bun cli.ts skills compile --dry-run --pack-dir $WT/plugins/mattstack --mattstack-dir $SCRATCH/ms-empty`
  - From `plugins/mattstack`: `bun test tests/desc-test.spec.ts`; and `claude plugin validate plugins/mattstack` from `$WT` if `claude` is on PATH (it reads only the folder)
  - `grep -rnP '[\x{2013}\x{2014}]'` over every file this branch changed prints nothing
- [ ] **Step 4: Commit** with message `mattstack <version>: forge skills on the mr tools, engine floor <version> (RT-569)`.

## Self-Review

- Spec coverage: inventory rows 1 to 5 map to Tasks 2, 3, 4, 4, 5; B1 Task 4, B2 Task 4, B3 Task 2, B4 Task 3; README, roster and stale caller text Tasks 2 and 3; version, floor, reference Task 6; verification scenarios 1 to 9 are M1, M2, S1, S2, C1 to C7, J1, J2.
- Node ids introduced: `stop_shell_mr_read` (Tasks 3 and 4, separate graphs), `stop_shell_ticket_search`, `picked_github_row`, `mr_resolve_row`, `fork_pr`, `mr_create_github`.
