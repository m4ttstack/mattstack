# Forge skills phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the GitLab paths of map-open-mrs, sync-open-mrs's map step and checkout's MR lookup onto the composite tools #844 shipped (`mr_map`, `mr_resolve_branch`).

**Architecture:** Skill text only. Each GitLab path makes one composite call instead of a list read plus a worktree read plus per-tree reads. GitHub paths, ticket and branch-name paths, gates, outcomes and reports stay as they are.

**Tech Stack:** mattstack plugin skills (Markdown plus `dot` digraphs), the mattstack MCP tools.

**Spec:** docs/superpowers/specs/2026-10-16-forge-skills-design.md, section "Phase 2: after #844 merges". Tool contracts: plugins/mattstack/attachments/mcp-tools/reference.md (`mr_map`, `mr_resolve_branch`).

## Global Constraints

- `mr_map {repoName, author: "me"}` returns `{rows, complete}`; each row `{ref, iid, title, author, sourceBranch, targetBranch, draft, stacked, worktree, dirty, mrState, ciStatus}`; `worktree` is null with no tree; `dirty` is null with no tree or on a git error; `complete: false` means only the first 200 open MRs are listed. GitLab only.
- `mr_resolve_branch {repoName, mrUrl or iid}` returns `{iid, state, title, author, sourceBranch, targetBranch, webUrl, trees: [{name, path}]}`; `trees` is the registered worktrees whose branch equals `sourceBranch` exactly, usually none or one. GitLab only. Works on opened, merged and closed MRs.
- Gates stay human decisions; outcomes and report wording unchanged. No em or en dashes; no stale prohibitions ("no longer", "used to").
- Every touched dot block passes `render.sh` and `check-dot.py`; a STOP guard for "tempted to use the GitLab CLI" stays on each GitLab call it guards today.
- Team fills attach by exact node text: renaming `mr_view {repoName, mrUrl or iid}` in checkout is allowed only if no team fill attaches to it (checked: none do); note any rename in the report.

## Review Focus

- `mr_map` row with `dirty: null` and a tree (git error): treat as not known clean; the plan step skips it the way a non-empty porcelain read did, saying why.
- `mr_map` `complete: false`: the plan sentence says the map was cut at 200, as a truncated `mr_list` did.
- `mr_resolve_branch` returning two trees: point at every path, never pick one silently.
- `mr_resolve_branch` on a merged or closed MR: same checkout, the report names the state.
- A GitLab error from either tool: quoted, into the gate the old read's error went to.

---

### Task 1: map-open-mrs and sync-open-mrs onto mr_map

**Files:**
- Modify: `plugins/mattstack/attachments/forge/map-open-mrs/SKILL.md`
- Modify: `plugins/mattstack/attachments/forge/sync-open-mrs/SKILL.md`

- [ ] **Step 1: map-open-mrs.** GitLab path of step 1 and step 2 becomes one `mr_map` call with `repoName` = the current checkout's absolute path and `author` `me`; each row already carries the join (`worktree`), so step 3's join is GitHub only. `complete: false` is said plainly, like a cut `mr_list`. GitHub path unchanged. The emitted table keeps its five columns (the downstream contract). Drop `mr_list` and `rt_verb worktree list` from the GitLab path; keep them only if the GitHub path uses them (it uses `gh pr list` and the worktree read).
- [ ] **Step 2: sync-open-mrs map step.** Replace the `"Follow map-open-mrs for the table"` box's single entry with: `git -C <checkout> remote get-url origin` (plaintext) -> `Forge?` (diamond) -> GitLab: `mr_map {repoName, author: me}` (plaintext) -> `mr_map result?` (diamond: rows -> `Plan the sweep`; a GitLab error -> the existing error/report path the map step uses today, quoted) ; GitHub: `Follow map-open-mrs for the table` (kept, unchanged text) -> `Plan the sweep`. Add a guard edge `tempted to use the GitLab CLI` from `Forge?` to a STOP that redirects to the `mr_map` node, per process-digraphs rule 5. Every incoming edge that pointed at `Follow map-open-mrs for the table` now points at `git -C <checkout> remote get-url origin`.
- [ ] **Step 3: sync-open-mrs sections.** `### Plan the sweep`: on GitLab, a row's `dirty` replaces the per-tree `status --porcelain` read (`true` or `null` with a tree: skipped up front, said why); on GitHub the porcelain read stays. `### Every listed branch selected?`: the "map complete" condition reads `mr_map`'s `complete` on GitLab. New `### mr_map result?` section (one short paragraph). `### Follow map-open-mrs for the table` says it is the GitHub path. allowed-tools adds `Bash(git -C * remote get-url:*)` if the read is written `git -C`, else `Bash(git remote get-url:*)`.
- [ ] **Step 4: Verify.** `render.sh` and `check-dot.py` exit 0 on sync-open-mrs; `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/forge/map-open-mrs/` and the same for sync-open-mrs pass.
- [ ] **Step 5: Commit** `map-open-mrs, sync-open-mrs: GitLab map through mr_map`.

### Task 2: checkout's MR lookup onto mr_resolve_branch

**Files:**
- Modify: `plugins/mattstack/attachments/forge/checkout/SKILL.md`

- [ ] **Step 1: Graph.** Replace `"mr_view {repoName, mrUrl or iid}"` with `"mr_resolve_branch {repoName, mrUrl or iid}"` (the GitLab edge of `MR forge host?` and the GitLab-CLI STOP's redirect both point at it). Add `"mr_resolve_branch result?"` (diamond): `a GitLab error: quoted in the gate's sentence` -> `Gate clarify: which branch`; `a tree on the branch: point there` -> `Report the path and whose branch it is`; `no tree` -> `worktree_provision {repoName, branch}`. The GitHub, ticket and branch-name paths, and every other node, stay as they are.
- [ ] **Step 2: Sections.** `### Pick the branch from the result`: drop the `mr_view` sentence (the GitLab MR path no longer passes through it). New `### mr_resolve_branch result?`: `branch` for provision is `sourceBranch`; several `trees` are all reported; `state` merged or closed is named in the report; `author` is whose branch it is. Keep the `git worktree list` read and `Branch already checked out?` for the other paths.
- [ ] **Step 3: Verify.** `render.sh` and `check-dot.py` exit 0; `certify.sh` on the checkout dir passes; `rg -n "mr_view" plugins/mattstack/attachments/forge/checkout/SKILL.md` returns nothing.
- [ ] **Step 4: Commit** `checkout: GitLab MR lookup through mr_resolve_branch`.

### Task 3: GREEN, bump, checks (controller-run)

- [ ] **Step 1: GREEN.** Add scenarios 10-12 to the scenario file (10: sync-open-mrs on GitLab, `mr_map` returns four rows, one `dirty: true`, `complete: true`, all selected; 11: checkout given `!42`, `mr_resolve_branch` returns `trees: []`; 12: checkout given an MR URL, `trees` has one path). Five fresh agents per skill (sonnet, low, describe-only). Pass: one `mr_map` / `mr_resolve_branch` call, no `mr_list`/`mr_view`/porcelain/worktree reads on those paths, routing as above. Record the rows in the spec's deviation table.
- [ ] **Step 2: Bump.** plugin.json `0.31.11` (main is 0.31.10 after #846) and `plugins/mattstack/pack/requires.json` `minEngine` `0.31.11`, one commit.
- [ ] **Step 3: Checks.** The phase 1 Task 5 static list, then `bun run purity`.
- [ ] **Step 4: Commit** `mattstack 0.31.11: forge skills on mr_map and mr_resolve_branch`.
