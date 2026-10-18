An org release: an org's shared data moves onto its own branch, with org owners above admins, so publishing never needs write access to `main` and each Mac checks out only the teams its role reaches. Pipeline skills now run on typed rt tools instead of shell lines, a team can add its own pipeline for one kind of work, and browser evidence becomes one capability every pack shares. Gates can take your own words, the board shows who is already reviewing an MR and can ask a code owner on another team, and first-run setup becomes one page per group, with a Your repos page that puts each repo where you choose.

Nothing changes for an org until its admin converts it: this app reads both the current org layout and the new data branch layout, and the conversion is a separate step an org admin runs after updating. Macs on an older app hold at the last commit they can read and show one row asking to update.

### Org and teams

- an org's data can live on its own branch (`mattstack` by default), with only a pointer on `main`; this app reads layouts 3 and 4 (#832)
- once an org's data moves, each Mac moves its copy to the data branch in place, from the daemon, `rt setup update` or `rt team pull`, carrying unpushed org commits across (#832)
- a copy that can't move yet (local changes, a detached checkout) is held, and setup says why and what to do (#832)
- joining again moves a copy left on `main` by an older app onto the data branch, so a Mac that joined before updating recovers (#870)
- the data branch move's next steps start with `rt team pull`, so forge access and membership read the moved copy (#870)
- each Mac checks out only the team folders its role reaches; a folder you have left stays until its changes are published or discarded (#832)
- `rt team branch use <name>` lets an org admin try a change on a trial branch while members stay on the data branch (#832)
- org owners sit above admins; with no owners listed, the admins are the owners, so existing orgs need no change (#824)
- a team owner can change who is on their own team without write access to the rest of the org, and every org store change goes through one guard (#824)
- `rt team rename` is for org owners only (#824)
- team owners add and drop their own members with `rt team members add` and `rt team members drop` (#824)
- the switchboard admin token moves into an org file only the org's owners and admins can open, and rt keeps it locked to exactly them as roles change; a Mac still holding its own copy keeps working (#829)
- `rt team admin-secrets` shares this Mac's token with the org's owners and admins, or replaces it, and setup shows a row when they can't use it yet (#829)
- the org's roles drive who can reach the org repo on GitHub or GitLab and who can push its data branch; `rt team forge-access` shows the plan and `--apply` makes it so (#828)
- once an org admin turns it on, setup keeps forge access in step with the roles on every update, only ever adding access (#828)
- `rt team status` names the data branch and a recorded trial branch as such (#828)
- `rt skills sync` reaches an https org clone with rt's forge token when your own git has no credential for it (#841)

### Pipelines and skills

- a team can add a specialized pipeline for one kind of work, run by its own `work-<kind>` verb, with its own fills for the stages it overrides (#852, #863)
- `rt skills bind --pipeline <name>` binds a fill for one pipeline, `--unset` removes that override, and a plugin-prefixed stage name such as `mattstack:stage-evidence` is accepted (#855, #863)
- a pipeline name that carries overrides, or a work verb's pipeline, can't contain `--`; `rt skills compile --json` reports the stage copies it removed (#857)
- the work, review, respond, ship, CI and evidence skills run on rt's typed tools instead of shell lines, with the same steps and gates (#849, #854, #856, #858, #859, #860, #862, #867)
- browser evidence is one shared capability: the browser driver captures and composes a labelled board, its redactions are confirmed before anything uploads, and a pack supplies only a Browser target section of facts (#822)
- a ticket's own image never uploads as a screenshot, and its recorded size and sha256 keep a copy refused after the file is gone (#822, #869)
- the extending-a-pack and editing-skills skills say where a team member makes pack edits, and their specialized-pipeline recipe works as written (#863, #865)
- every session's start names the Agent effort rule, so a spawn names both model and effort (#840)
- every digraph in the mattstack plugin uses short node ids with the sentence as its label; team packs may use either form (#866)

### MCP

- a run engine: `run_enter`, `run_next`, `run_resolve`, `run_hold`, `run_close` and `run_budget` walk a pipeline from its manifest (#843)
- gate tools: `gate_open`, `gate_record` and `gate_reconcile`, and `gate_ask` and `gate_answer` know the run they belong to (#846)
- herd tools: respawn a job, spawn into a registered tree, answer a shepherd gate, diagnose, nudge, lanes, and budgets that survive a restart (#845)
- CI tools: `ci_triage` classifies a failed pipeline by the team's `ci.triage.*` patterns, `pipeline_jobs` lists its jobs, and `ci_watch` can attend a pipeline (#847, #862)
- git tools: a per-branch stack check, trees named by a subdirectory, a structured `branch_sync` result, and `branch_sync_sweep` for every open MR branch with a tree (#842)
- MR tools: `respond_post_execute`, `mr_posted_since` and `mr_resolve_branch`; `mr_map` reads live, `mr_create` hands back an open MR, and `mr_rebase` can wait for the rebase (#844)
- evidence tools: `evidence_record`, `evidence_attach` and `dev_endpoints`, and `mr_upload` takes several files at once (#851)
- `worktree_provision` can return refusal codes, check before it provisions, reuse a tree already on the branch, and record the tree on a run (#850)
- `run_field_set` can compare before it sets, and an MR evidence section never shows a local path (#853)
- `ci_watch` reports progress on every poll, so a long watch is no longer cut off mid-call, and its wait caps at 1500 seconds (#831)
- `checkReadRootPath` refuses a hard link before checking the root (#834)

### Gates

- a gate question can accept a written answer instead of a pick (#827)
- a stage gate's next question opens with Proceed already selected (#827)

### Console

- a strip above a run's header lists the gates waiting on you from other runs; Answer next, or `g`, opens the oldest (#826)
- the Runs rail badge leaves out gates whose run is not listed (#830)
- each run names its pipeline, and the runs list, its title and the timeline follow a pipeline filter (#852, #857)
- the rebind drawer picks the default or one pipeline, and Use default removes a pipeline's override (#855)
- Health shows stale stage copies (#857)
- the Now card shows the current stage's answered gates
- the runs list keeps its data and filter when you come back from a run, and the run page breadcrumb moves into the top bar
- live updates survive a dropped socket, and an answered gate clears at once
- the evidence modal steps through cases with the arrow keys
- every settings key shows what you get with nothing set, and keys no store sets sit in a "Not set" block (#802, #803, #804, #806)
- a progress card with an elapsed timer shows while skills sync runs (#801)

### Board

- the board shows when a teammate is already reviewing an MR, and starting a second review asks first (#819)
- ask someone on another team for a review, starting with the teams that own a Code Owner section on the MR (#816, #818)
- the re-review ask sits on the row menu's top level, and goes through the reviewer's latch thread when the switchboard can't reach them (#820, #821)
- a review finding's kind shows as a pill on the structured sheet (#815)
- board triggers run the board from the running app, so switching between the prod and dev apps no longer leaves them on the wrong board (#800)

### Setup

- first-run setup shows one page per group and ends on the summary; a warning mark means you have to do something, and optional rows no longer read as blockers (#817)
- the setup checklist groups rows in a sidebar, folds settled rows, and shows Re-check running (#812, #813)
- a Your repos page puts each tracked repo in a new checkout or your current one, and `rt setup repo place` does the same from the terminal; a linked worktree is never taken for a repo's checkout (#861, #864)
- each repo's clone shows git's progress under its step (#861)
- the GitLab token link asks for the read_user, repository and ai_features scopes (#861)
- the app starts herdr after launch, and an agent launch starts it first when it isn't running (#861)
- the dev login sheet asks you to confirm the password instead of the host (#861)

### Setup after updating

- the active team's pack is turned on, once, for a Mac that joined before this release left it off (#861)
- setup shows a row when your board took team settings (projects, members and the rest) from its old file, with the steps for a team admin to set them (#835)
- a repo's `branch-naming.json` and the StrongDM `enrichment.jsonc` labels are no longer read; if your org's settings don't hold them yet, rt names the `rt settings set` command an org admin or team owner runs to move them (#803)

### Chat

- each agent keeps one look across rooms, with distinct hues, and DM rows always carry both avatars

### Deck

- managed apps no longer offer remove, relink or unlink
- go live takes a play icon, and a live app shows a filled green button
- deck hands mattstack apps the flavor of the app running them

### Glitter

- the worktree foldout pins the main checkout, and `W` switches to it (#811)
- copy, stash, provision, switches and sync confirm with a toast above the keybar, and the `f` key is labelled with the action it will run

### Fixes

- a pane spawned through cswap no longer starts with a stray prompt that swallowed the one rt sent (#825)
- event-loop lag alone no longer marks the daemon degraded
- `isLoopbackIP` rejects an address with an octet above 255 (#809)

### Release tooling

- the clean-room VM harness reads the setup wizard's button through the accessibility API, so the walkthrough presses Continue and Install on macOS 26 (#836)
- the update leg's walkthrough presses Install on the previous release's one-list checklist (#837)
- the solo walkthrough starts from a reset team repo (#839)
- the marketplace publish says when it skips its version check, and orders prerelease versions (#799)

### Bundled tools

- Fast Browser 0.1.15, with its marketplace entry at the same release (#833, #822, #868)
- mattstack plugin 0.32.1
- bun 1.4.3, glab 1.123.0, node 24.22.0, cloudflared 2026.10.1, portless 0.15.8 (#838)
- deck keeps waiting for a restarting deck under bun 1.4.3, which names a refused connection differently (#838)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.24.0...v2.25.0
