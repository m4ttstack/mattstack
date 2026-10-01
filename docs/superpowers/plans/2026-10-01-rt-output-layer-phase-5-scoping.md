# rt Output Layer, Phase 5 (Visible Verbs): Scoping and Split

Ticket: RT-369. Date: 2026-10-01. Base: main at `5bc69f231` (phases 1 and 2 merged).

This is not a plan. It splits the spec's phase 5 into six slices, one PR each, so one planner per slice can write one plan each and the slices can run in parallel worktrees without touching the same files.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`, "Phases" item 5. **Rulings:** `.superpowers/sdd/cross-phase-rulings.md` (12 items) binds every slice. **Planner brief:** `.superpowers/sdd/planner-brief.md` (its worktree path is stale; use the tree the planner is given).

## How the numbers were made

- **Guard lines:** `rg -c` per file with the four patterns of `lib/__tests__/no-raw-output.test.ts` (`console.log|error|warn|info(`, `process.stdout|stderr` beyond the read-only members, a color import, a raw escape). It counts matching lines, so a call spread over several lines counts once and an import line counts once. Rough by design.
- **Seam lines:** several files print through an injected `print`, `log` or `deps.print` and show almost nothing to the guard (`commands/team.ts` has 2 guard lines and 30 seam calls). Counted with `rg -c` on `(deps|d|io|opts|ctx).(print|printError|log|warn|...)(` and bare `print(`, `log(`, `say(` at line start. These are print sites too and each planner audits them.
- **Visible versus guard-only:** every guard and seam line was then sorted by `classify.ts` (scratchpad). Guard-only means the edit changes nothing a person sees: a color import, a comment, a `--json` envelope moving to `out.json`, a payload moving to `out.payload`, a stream swap around a picker, an escape constant or a cursor move. Everything else is a visible site: a line of human text that will read differently after conversion. The classifier matches seam calls in lib files too, so its totals (763 visible, 175 guard-only) run a little above the 803 + 120 raw count.
- **Flags** (`--json`, `agentSafe`, `omitBehavior`) come from a dump of `TREE` in `lib/command-tree-def.ts`, not from reading the handlers.
- The scripts are in the session scratchpad (`inv.sh`, `seams.sh`, `tree.ts`); rerun them from the repo root after phases 3 and 4 merge, since the allowlist will have shrunk.

The allowlist holds 110 files today. 58 are behind phase 5's verbs and each appears in exactly one slice below. 14 belong to phases 3 and 4. The other 38 are phase 6 or non-goals and are listed at the end so nobody adopts one by accident.

## 1. Inventory

Columns: guard lines / seam lines; `json` = the verb declares `--json`; `spin` = `withInlineSpinner` or the `\r` line; `steps` = `createStepRunner` or `withSpinner`; `pick` = an rt-ui picker; `child` = a child process given the terminal; `payload` = stdout is read by a program.

### What rt-ui already draws (ruled 2026-10-01: a verb already on rt-ui is not converted)

rt-ui draws four things today: pickers (`rt-ui pick`, through `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts`, `lib/navigate.ts`), prompts (`lib/ui/prompts.ts`), steps (`rt-ui steps`, through `lib/ui/steps.ts`) and session views (`runner`, `glitter`, neither in phase 5). None of those surfaces is touched by any slice. The guard counts above never included them: a picker, prompt or step is not a `console.log`. What the slices convert is only the raw text printed beside them.

"Yes" means the verb's whole screen is an rt-ui view and a person sees no change. "Partly" means rt-ui draws the choosing or the progress and raw lines print the result. "No" means the verb never reaches rt-ui.

| Verb | Already on rt-ui | What rt-ui draws today | Left for the layer |
|---|---|---|---|
| `nav` | **yes** | the whole navigator (`lib/navigate.ts`) | **no visible change.** `commands/nav.ts` stays in 5c for 4 guard-only lines (the stdout swap at 404 to 429) and two stray stderr lines (Quick Look, 359 and 366), which keep their words |
| `cd` | **yes** on the everyday path | the worktree picker | **no visible change when the shell wrapper is installed.** 10 guard-only lines (the stdout swap, a cursor erase). 14 visible lines only on the rare paths: 12 shell-wrapper install and upgrade notes, 2 refusals |
| `git credential` | n/a (payload) | nothing | **no visible change**: 1 guard-only line (the reply moves to `out.payload`) |
| `code` | partly | the editor and target pickers, the confirm | 8 visible lines (opened, failed, no editor found) |
| `code extension` | partly | the editor multiselect | 12 visible lines |
| `port` | partly | the kill picker | 18 visible lines (the port list, kill results); the inline spinner |
| `hooks` | partly | the confirm | 22 visible lines (status and toggles) |
| `worktree` | partly | every leaf picker (6 wrappers, 13 calls) | 77 visible lines; 15 guard-only (`--json`) |
| `git rebase`, `git reset`, `sync` | partly | the fetch step (`withSpinner`, `createStepRunner`), the branch picker, the confirms | the result lines beside the steps (22, 22, 23 visible); `lib/ui/steps.ts`'s static lines |
| `git backup`, `git diff`, `git stash`, `git tag`, `git push` | partly | the leaf pickers and the force-push confirm | result lines |
| `git status`, `git log`, `git branches`, `git pull`, `git amend`, `git undo` | no | | all of their human output |
| `repos` | partly | the register and locate pickers, a confirm | 21 visible lines in `repos.ts`, 5 in `repos-reidentify.ts` |
| `skills` | partly | the pack, surface and bind pickers (`skills.ts`), the `init` and `writing-style` prompts | 59 visible lines in `skills.ts`; `audit`, `expand`, `link`, `sync` never reach rt-ui |
| `plugin` | partly | the `new` name prompt | 19 visible lines |
| `tools`, `deps` | partly | the tool and dep pickers | 4 and 11 visible lines |
| `intercept` | no | | 18 visible lines |
| `team` | partly | the member picker, the name and code prompts | 22 visible lines, 14 more in `lib/team` |
| `home` | partly | the claim and release pickers, confirms, the secret prompt | 68 visible lines |
| `release` | partly | one confirm | 9 visible lines |
| `sdm` | partly | the resource picker (`lib/sdm/picker.ts` through `lib/navigate.ts`), the duration and reason prompts | 49 visible lines; the inline spinner. `lib/sdm/picker.ts` and `lib/navigate.ts` are **guard-only**: the row colors become roles and the picker looks the same |
| `chat` | partly | the verb picker | 39 visible lines; 22 guard-only (`--json`) |
| `runs` | partly | the run picker | 8 visible lines |
| the dispatcher (`lib/command-tree.ts`, `lib/arg-collector.ts`) | partly | the subcommand and argument pickers | 22 visible lines (help, usage, unknown command, refusals); the two screen clears are guard-only |
| `lib/repo.ts` | partly | the repo and worktree pickers (14 calls) | 11 visible refusals |

Files that are guard-only from end to end, kept in a slice only so they leave the allowlist: `commands/git/credential.ts` (5b), `lib/arg-collector.ts` (5a), `lib/navigate.ts` and `lib/sdm/picker.ts` (5f). `commands/nav.ts` is the same but for its two Quick Look lines, and `lib/pickers.ts` (5c) is a stream choice plus one refusal line.

### git

| File | Guard | Seam | Verbs | json | steps | pick | child | payload |
|---|---|---|---|---|---|---|---|---|
| `commands/git/backup.ts` | 9 | 0 | `backup`, `restore` | no | no | yes | no | no |
| `commands/git/credential.ts` | 1 | 0 | `credential` (hidden) | no | no | no | no | **yes, all of stdout (git reads it)** |
| `commands/git/inspect.ts` | 14 | 0 | `status`, `diff`, `log`, `branches` | yes; `status`, `log`, `branches` are agent-safe | no | yes (`diff`) | no | no |
| `commands/git/mutate.ts` | 28 | 0 | `amend`, `undo`, `stash *`, `tag *` | yes | no | yes | no | no |
| `commands/git/pull.ts` | 7 | 0 | `pull` | no | no | no | **`git pull`, inherit** | no |
| `commands/git/push.ts` | 17 | 0 | `push`, `push force`, `upstream` | no | no | no | **`git push`, inherit** | no |
| `commands/git/rebase.ts` | 6 | 18 | `rebase`, `rebase onto` | yes | `withSpinner` | yes | `git rebase`, inherit unless quiet | no |
| `commands/git/reset.ts` | 7 | 16 | `reset origin`, `reset soft`, `reset hard` | no | `withSpinner` | no | no | no |
| `lib/rebase-escalation.ts` | 21 | 0 | behind `sync` and `git rebase` | prints a JSON bundle at line 202 | no | no | reads a herdr pane and prints it | no |

`commands/git/inspect.ts` holds the phase's only diff printer (`diffCommand`, line 95). `failPlain` is defined twice (`inspect.ts:4`, `mutate.ts:9`) and a third time in `commands/repos.ts:404`.

### sync

| File | Guard | Seam | Verbs | json | steps | child | payload |
|---|---|---|---|---|---|---|---|
| `commands/sync.ts` | 25 | 0 | `sync`, `sync all` | `sync` yes, `sync all` no | `createStepRunner` (line 188) | no | no |
| `lib/ui/steps.ts` (exempt from the guard, not on the allowlist) | 5 stream writes, 10 lines with an escape | n/a | static `log()` lines and the plain fallback for `sync`, `git rebase`, `git reset` | n/a | it is the runner | no | no |

### worktree

| File | Guard | Seam | Verbs | json | spin | pick | child | payload |
|---|---|---|---|---|---|---|---|---|
| `commands/worktree.ts` | 91 | 1 | `provision`, `create`, `dispose`, `restore`, `ready-approve`, `list`, `triage`, `freshen`, `await-ready`, `adopt`, `each`, `hydrate-clone` (hidden) | all but `each`; `list`, `triage`, `await-ready` agent-safe | via `lib/enrich.ts` | yes (6 picker imports) | **`each` runs `sh -c` with inherit (line 930)** | no |
| `lib/enrich.ts` | 5 | 0 | branch enrichment for `worktree`, `run`, `daemon`, the pickers | n/a | **the `\r` line (507, 601), on stderr** | no | no | no |
| `lib/herdr-launch.ts` | 4 | 0 | the "running sequentially" fallback for `worktree`, `chat`, `run` | n/a | no | no | inherit | no |
| `lib/worktree/config.ts` | 3 | 0 | three `console.warn("rt: ignoring ...")` lines under any verb that reads worktree config | n/a | no | no | no | no |
| `lib/worktree-each.ts` (not allowlisted) | 0 | 0 | `formatSummary`, a string printer behind `worktree each` | n/a | | | | |

`commands/worktree-hook.ts` (11 guard lines: `worktree hook *`, `claude-hook`, `announce-relocation`) is a spec non-goal and stays out of phase 5.

### cd, nav, code, extension

| File | Guard | Seam | Verbs | json | pick | child | payload |
|---|---|---|---|---|---|---|---|
| `commands/cd.ts` | 25 | 0 | `cd` | no | yes | no | **the path on stdout; the shell wrapper `rt()` in `SHELL_FUNCTION` (cd.ts:40) reads it** |
| `commands/nav.ts` | 6 | 0 | `nav` | no | yes | a shell and an opener, inherit; Quick Look | **the path on stdout, same wrapper** |
| `commands/code.ts` | 9 | 0 | `code` | no | yes | the editor CLI, inherit | no |
| `commands/extension.ts` | 13 | 0 | `code extension` | no | yes | no | no |
| `lib/pickers.ts` | 1 | 0 | the "no worktree found matching branch" refusal for `cd`, `code`, `worktree` (line 412; it picks stdout or stderr) | n/a | it is the picker glue | no | no |

`cd.ts` and `nav.ts` both swap `process.stdout.write` for stderr while a picker runs (cd.ts:89, 226; nav.ts:404). That swap, not the notes, is most of their `process.std` count.

### port

| File | Guard | Seam | Verbs | json | spin | pick | child |
|---|---|---|---|---|---|---|---|
| `commands/port.ts` | 19 | 0 | `port` | no | **`withInlineSpinner` (27, 38)** | yes (kill picker) | no |

### repos

| File | Guard | Seam | Verbs | json | pick |
|---|---|---|---|---|---|
| `commands/repos.ts` | 8 | 21 | `register`, `prune`, `locate`, `status` | yes; `status` agent-safe | yes |
| `commands/repos-reidentify.ts` (not allowlisted; prints through a seam) | 0 | 6 | `reidentify` | yes | no |
| `lib/repo-index.ts` | 10 | 0 | nine `console.warn("rt: ...")` migration and config lines, under any verb | n/a | no |
| `lib/repo-tracking.ts` | 6 | 0 | six `console.warn` lines, under any verb | n/a | no |

### hooks, intercept

| File | Guard | Seam | Verbs | json | child |
|---|---|---|---|---|---|
| `commands/hooks.ts` | 23 | 0 | `hooks` | no | no |
| `commands/intercept.ts` | 22 | 0 | `status`, `install`, `uninstall`, `run` (hidden) | `status` (agent-safe), `install`, `uninstall` | **`intercept run` execs the real tool with inherit (line 161); it is the shim's hot path** |

### skills

| File | Guard | Seam | Verbs | json | pick | payload |
|---|---|---|---|---|---|---|
| `commands/skills.ts` (2,518 lines) | 72 | 0 | `materialize`, `compile`, `check`, `surface`, `packs`, `composition`, `bind` | all; `compile`, `check`, `surface`, `bind` agent-safe | yes | **`compile --preview` prints the compiled body** |
| `commands/skills-audit.ts` | 5 | 0 | `audit` | yes | no | no |
| `commands/skills-expand.ts` | 7 | 4 | `expand` | yes | no | no |
| `commands/skills-init.ts` | 11 | 0 | `init` | yes | no | no |
| `commands/skills-link.ts` | 7 | 1 | `link` | yes | no | no |
| `commands/skills-sync.ts` | 10 | 3 | `sync` | yes, agent-safe | no | no |
| `commands/skills-writing-style.ts` | 1 | 9 | `writing-style show`, `list`, `use`, `new` | yes; `show` agent-safe | yes | no |
| `lib/skills/sources.ts` | 1 | 0 | one `console.error("rt: skipping plugin ...")` | n/a | | |

`lib/skills/` (20 files, about 4,100 lines) is unaudited: about 18 literal detail strings and 64 `throw new Error(...)` sites whose messages reach a person.

### plugin, tools, deps

| File | Guard | Seam | Verbs | json | pick | child |
|---|---|---|---|---|---|---|
| `commands/plugin.ts` | 20 | 0 | `new`, `list`, `validate` | **no** | no | the package manager install, inherit |
| `lib/plugins.ts` | 2 | 0 | the plugin loader's warn line; line 346 is a template string for a scaffolded plugin, not a print | n/a | | a plugin's own command, inherit (line 214) |
| `lib/plugin-api.ts` | 1 | 0 | one warn line | n/a | | |
| `commands/tools.ts` | 6 | 0 | `install`, `setup` | yes | yes | no |
| `commands/deps.ts` | 14 | 1 | `resolve`, `link`, `unlink`, `reconcile` | yes | yes | no |

### team

| File | Guard | Seam | Verbs | json | pick |
|---|---|---|---|---|---|
| `commands/team.ts` | 2 | 30 | `create`, `publish`, `invite`, `manage-membership`, `join`, `members sync`, `members remove`, `status`, `pull` | all; `status` agent-safe | yes; prompts through `lib/prompt-secret.ts` |
| `lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/members.ts` | 1 each | 0 | a default `console.error(message)` warn sink each | n/a | |

`lib/team/` (18 files, about 3,100 lines) is unaudited: about 19 literal detail strings and 40 throw sites. `team invite` prints the invite code, which a person copies (a `copy` block, never wrapped).

### home

| File | Guard | Seam | Verbs | json | pick | payload |
|---|---|---|---|---|---|---|
| `commands/home.ts` (1,163 lines) | 69 | 0 | `init`, `key export`, `key import`, `snapshot`, `claim`, `release` | none of these (`home remote set` is `commands/setup.ts`, phase 3) | yes | **`key export` prints the age private key (line 819)** |
| `lib/home/age-key.ts` | 1 | 0 | a `CLI_DEBUG` trace line | n/a | | |
| `lib/prompt-secret.ts` | 1 | 0 | the secret prompt's default writer; callers are `home`, `team`, and phase 3's `logins`, `secrets`, `setup` | n/a | | |

`lib/home/` (8 files, about 1,400 lines) is unaudited.

### release

| File | Guard | Seam | Verbs | json |
|---|---|---|---|---|
| `commands/release.ts` | 14 | 0 | `preflight`, `verify`, `update-machine`, `apps` | all four |

`lib/release/` (7 files, about 2,700 lines) is unaudited: about 52 literal detail strings and 42 throw sites (`renderNotes`, `formatStep` in `release-app.ts`). `update-machine`'s `log` seam already sends progress to stderr under `--json` (release.ts:234).

### sdm

| File | Guard | Seam | Verbs | json | spin | pick | child |
|---|---|---|---|---|---|---|---|
| `commands/sdm.ts` | 59 | 0 | `connect`, `connections`, `status`, `login`, `refresh`, `enrichment` (`set-email` is `commands/settings.ts`, phase 4) | `connect`, `connections`, `status` | **`withInlineSpinner` (207)** | yes | `sdm` itself, inherit (`lib/sdm/core.ts:399`); `streamLine` writes child lines to stderr (line 62) |
| `lib/sdm/enrichment.ts` | 2 | 0 | two `console.warn` lines | n/a | | | |
| `lib/sdm/picker.ts` | 5 | 0 | five raw SGR constants (tier colors) fed to `lib/navigate.ts`'s `color` | n/a | | | |
| `lib/navigate.ts` | 1 | 0 | a comment quoting an escape; its `color?: string` field takes a raw SGR | n/a | | | |

Nearly every human line in `commands/sdm.ts` goes to stderr today (23 `console.error`), including plain progress. The production confirm is the spec's one `banner`.

### chat, runs

| File | Guard | Seam | Verbs | json | pick |
|---|---|---|---|---|---|
| `commands/chat.ts` (1,357 lines) | 53 | 8 | one leaf, `chat <verb>`: human verbs (rooms, read, buddies, who, sign-in typed by a person) and agent verbs in one file | yes | yes |
| `lib/chat-viewer-url.ts` | 1 | 0 | one `console.warn` | n/a | |
| `commands/runs.ts` | 9 | 2 | `runs`, `runs show`, `runs abandon` | `show` (agent-safe); `runs` list takes `--json` in code | yes |

`commands/runs-find.ts` and `commands/runs-write.ts` are spec non-goals.

### The dispatcher and shared refusals (behind every verb)

| File | Guard | What it prints |
|---|---|---|
| `cli.ts` | 6 | two state-migration notices, two plugin-migration notices, the first-run hint; all on stderr before dispatch |
| `lib/command-tree.ts` | 26 | unknown command, "requires an interactive terminal", the repo-resolution refusals, the picker breadcrumb and screen clear on stderr, `--help` and usage on stdout |
| `lib/arg-collector.ts` | 1 | a screen clear on stderr before the argument picker; only importer is `lib/command-tree.ts` |
| `lib/daemon-client.ts` | 2 | "rt daemon is installed but not running", on stderr, under 20 command files |
| `lib/repo.ts` | 11 | "not in a git repo", "could not identify repo", the missing-repo refusal; imported by `sync`, `cd`, `code`, `worktree`, `chat` and three phase 6 files |

### Totals

803 guard lines and 120 seam lines across 58 allowlisted files, plus `lib/ui/steps.ts`, `lib/tui/inline-spinner.ts`, `commands/repos-reidentify.ts` and `lib/worktree-each.ts`, which the guard does not list.

Sorted by what a person sees: about 763 visible sites and 175 guard-only edits.

| Slice | Files | Visible sites | Guard-only sites |
|---|---|---|---|
| 5a | 5 | 40 | 4 |
| 5b | 10 | 141 | 26 |
| 5c | 9 | 121 | 35 |
| 5d | 15 | 183 | 40 |
| 5e | 11 (+ `repos-reidentify.ts`) | 161 | 28 |
| 5f | 8 | 117 | 42 |

Leaving out what rt-ui already draws moved almost nothing between slices, because pickers, prompts and steps were never counted as print sites. The one verb that drops out as a visible change is `nav` (and `cd` on its everyday path), which takes 6 to 30 lines off 5c's visible work and leaves 5c at 121. No slice became small enough to fold into another, so the six slices stand.

Phase 4's whole plan covers 90 guard lines. Five conversion PRs of 117 to 183 visible sites each is the floor for this phase, and 5d and 5e will pass 2,500 changed lines; section 3 names a second cut inside each slice for the planner who finds that.

## 2. Shared work

Each item has exactly one owner. "Transparent" means no slice calls anything new: the renderer just draws better, so the other slices depend on it only for their screenshots.

| # | Item | Owner | What the others see |
|---|---|---|---|
| 1 | **Stderr note primitive.** `out.note(...blocks: Block[]): void` in `lib/ui/out.ts`: writes to stderr, styled when stderr is a TTY and plain otherwise, and does not move `humanStream` the way `payloadOnStdout()` does. Needed by `cli.ts`'s pre-dispatch notices (they run before the verb is known, so stdout may be a payload or an envelope), by `lib/daemon-client.ts`, and by the `console.warn("rt: ...")` lines deep in `lib/` that fire under any verb. Ruled: each of those roughly 35 warnings is decided on its own. 5a's plan carries a table of every one (file, line, text today, new copy, and either show on stderr and log, or log only) for Matt to skim, the way phase 3 did for copy. The slice that owns the file applies its rows. | 5a | 5c, 5d, 5e, 5f call `out.note` from their own lib warn lines. `cd` and `nav` do not need it: they call `out.payloadOnStdout()` and `out.print`. |
| 2 | **Spinner merge.** `withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T>` in a new `lib/ui/transient-step.ts`: a Go step that leaves no line when the task ends. `lib/tui/inline-spinner.ts` becomes a one-line re-export of it (the guard does not flag that import path) and is deleted in phase 6 with the color modules. Ruled: a spinner leaves nothing on screen, so the `steps` verb gains an erasing ending and 5a owns that wire change (`ui/`, `lib/ui/protocol.ts`, `lib/ui/spawn.ts`, the shared fixture). | 5a builds it | 5f repoints `port` and `sdm`; 5c moves `lib/enrich.ts`'s `\r` line onto it. |
| 3 | **`lib/ui/steps.ts` static lines.** `log()`, `plainLine`, `fallback` and `warn` move onto `out.print` and `out.note`; the palette import and `RESET` go. | 5b (its three callers are all 5b's) | Nobody else imports the runner. Phase 3 does not edit this file. |
| 4 | **Diff tints on light terminals.** `ui/internal/render/blocks_text.go:76` paints `DiffAddBg` and `DiffDelBg`, which are blended toward the dark `Bg` in `ui/internal/theme/theme.go:168`. | 5a (Go) | Transparent. 5b's `git diff` is the first caller and carries the light and dark screenshots. |
| 5 | **Bidi and zero-width stripping.** `Clean` in `ui/internal/render/style.go:70` and `one`/`lines` in `lib/ui/out-plain.ts:25` drop escapes and C0/C1 controls only. Add the bidi controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) and the zero-width set (U+200B to U+200D, U+2060, U+FEFF) on both sides, with the shared fixture extended. | 5a | Transparent. 5b, 5c and 5e print branch names and each pin one test with a hostile branch name. |
| 6 | **`line` blocks with a hint wrap on a narrow pane.** `lineRun` in `ui/internal/render/blocks_basic.go:17` does not go through `wrapCell`. The phase 3 plan does not take it (no mention of `lineRun`, `wrapCell` or any file under `ui/`), so it is phase 5's. | 5a | Transparent. |
| 7 | **Hyphen break points and combining marks in `ui/internal/textwrap`.** Opt-in through an options argument or a second entry point, so `ui/internal/views/mission/diff_wrap.go:11` keeps calling `Spans` unchanged; `wrapCell` opts in. | 5a | Transparent. |
| 8 | **Usage strings out of failure titles.** A helper `usageFailure(title: string, usage: string, why?: string): FailureInput` in a new `lib/ui/usage.ts`: the title is a plain sentence ("Which branch?"), the usage line is the `next` command. Under `--json` the existing `error` string, usage text included, stays byte for byte. 5a also converts the dispatcher's own usage and help in `lib/command-tree.ts`. | 5a builds it | Every slice uses it at its own sites: `chat` 12, `git/mutate` 8, `deps` 4, `repos` 3, `tools` 2, `team` 2, `skills-writing-style` 2, `runs` 2, and one each in `worktree`, `release`, `plugin`, `intercept`, `git/rebase`, `git/inspect`, `repos-reidentify` (lines containing `usage:`, by `rg -c`). |
| 9 | **Table rule and tree tone on dark.** `theme.Rule` (`#2A2340`) and the tree rail read too faint on a dark terminal. | 5a (Go) | Transparent. |
| 10 | **Ruling 12 at `lib/team/join.ts`** (the warn path near line 426 that flattens a `UserActionableError`): carry `err.next`, call `logFailureDetail(err)`. | 5e | |
| 12 | **Picker wrappers take a stream.** Ruled: `cd` and `nav` stop swapping `process.stdout.write`; the wrappers in `lib/pick-wrappers.ts` and `lib/ui/pick.ts` (and `lib/pickers.ts`, `lib/navigate.ts` where they pass through) take the stream to draw on. No permanent exemption. The option is additive, so every other caller is untouched. | 5c owns `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/pickers.ts`; 5f adds the pass-through in `lib/navigate.ts`, which `nav` then uses | 5a does not edit those two picker files. |
| 11 | **One `failPlain`.** Three copies today. 5b keeps one in `commands/git/` for its two files; 5e replaces the copy in `commands/repos.ts` on its own. No shared file. | 5b and 5e, separately | |

All Go work (`ui/`) is 5a's and only 5a's. No other slice edits a file under `ui/` or runs `bun run ui:build` for a change of its own.

## 3. The split

Six slices. Every slice also touches the four files every phase touches (ruling 7): `lib/__tests__/raw-output-allowlist.json` (line deletions), `.github/workflows/e2e.yml` (only if it adds a pty test), `AGENTS.md` "Output layer" (append only), and its own tests.

### 5a. Layer additions and the dispatcher (lands first)

- **Verbs:** none of its own; `--help`, usage, unknown-command and the pre-dispatch notices for every verb.
- **Owns (5 allowlisted files, 46 guard lines; 40 visible sites, 4 guard-only):** `cli.ts` (6), `lib/command-tree.ts` (26), `lib/arg-collector.ts` (1), `lib/daemon-client.ts` (2), `lib/repo.ts` (11). Also: `lib/ui/out.ts` and `lib/ui/out-plain.ts` (additions), new `lib/ui/transient-step.ts` and `lib/ui/usage.ts`, `lib/tui/inline-spinner.ts` (body replaced by a re-export), `lib/ui/protocol.ts` and `lib/ui/spawn.ts` if the erasing ending needs a wire field, everything under `ui/` (render, textwrap, theme, the steps verb, fixtures), `ui/fixtures/render-document.json`.
- **Shared items:** 1, 2, 4, 5, 6, 7, 8, 9.
- **Must not touch:** any `commands/` file other than through `cli.ts`; `lib/ui/steps.ts` (5b's); `lib/errors.ts` (phase 2's, unchanged here).
- **Tests it must move:** `e2e/tests/first-run.test.ts`, `smoke.test.ts` and `errors.test.ts` assert dispatcher text; `e2e/pty/errors.test.ts` drives it in a pty.
- **Second cut if too large:** Go and `lib/ui` additions first (items 1, 2, 4 to 9), then the five file conversions.

### 5b. Git and sync

- **Verbs:** every `git` leaf, `sync`, `sync all`.
- **Owns (10 allowlisted files, 135 guard lines, 34 seam lines; 141 visible sites, 26 guard-only):** `commands/git/backup.ts` (9), `credential.ts` (1), `inspect.ts` (14), `mutate.ts` (28), `pull.ts` (7), `push.ts` (17), `rebase.ts` (6 + 18), `reset.ts` (7 + 16), `commands/sync.ts` (25), `lib/rebase-escalation.ts` (21). Also `lib/ui/steps.ts` and `lib/rt-render.ts`.
- **Shared items:** owns 3; consumes 8; first caller of 4 (the `diff` block); pins a hostile branch name for 5.
- **Must not touch:** `lib/repo.ts` (5a converts the refusals `sync` reaches); `lib/enrich.ts`; `lib/stack-guard.ts`'s `renderStackRefusal` JSON mode.
- **Second cut:** (i) `inspect`, `mutate`, `backup`, `pull`, `push`, `credential`; (ii) `sync`, `rebase`, `reset`, `lib/rebase-escalation.ts`, `lib/ui/steps.ts`.

### 5c. Worktree and navigation

- **Verbs:** `worktree` (all but the hook verbs), `cd`, `nav`, `code`, `code extension`.
- **Owns (9 allowlisted files, 157 guard lines, 1 seam line; 121 visible sites, 35 guard-only):** `commands/worktree.ts` (91 + 1), `lib/enrich.ts` (5), `lib/herdr-launch.ts` (4), `lib/worktree/config.ts` (3), `commands/cd.ts` (25), `commands/nav.ts` (6), `commands/code.ts` (9), `commands/extension.ts` (13), `lib/pickers.ts` (1). Also `lib/worktree-each.ts` (`formatSummary`).
- **Already on rt-ui, not converted:** `nav` is the navigator and `cd` is the worktree picker; neither picker changes. `commands/nav.ts` is in this slice for its stream swap and two Quick Look lines only, and its plan task is guard hygiene, with no screenshot. `cd`'s visible work is the shell-wrapper notes and two refusals. Also `lib/pick-wrappers.ts` and `lib/ui/pick.ts` for shared item 12.
- **Shared items:** owns 12; consumes 1 (the three `lib/worktree/config.ts` warns, `lib/herdr-launch.ts`), 2 (`lib/enrich.ts`), 8; pins a hostile branch name for 5.
- **Must not touch:** `commands/worktree-hook.ts`; `lib/navigate.ts` (5f's; `nav.ts` only calls it, and passes the stream once 5f has added the option, so that one task waits for 5f or goes last); `lib/repo.ts`, `lib/repo-index.ts`; `commands/run.ts` and `commands/daemon.ts` (phase 6 callers of `lib/enrich.ts`: keep its exported signatures as they are).
- **Second cut:** (i) `worktree` with its three lib files; (ii) `cd`, `nav`, `code`, `extension`, `lib/pickers.ts`.

### 5d. Skills, plugins and hooks

- **Verbs:** `skills` (all), `plugin`, `tools`, `deps`, `hooks`, `intercept`.
- **Owns (15 allowlisted files, 202 guard lines, 18 seam lines; 183 visible sites, 40 guard-only):** `commands/skills.ts` (72), `skills-audit.ts` (5), `skills-expand.ts` (7 + 4), `skills-init.ts` (11), `skills-link.ts` (7 + 1), `skills-sync.ts` (10 + 3), `skills-writing-style.ts` (1 + 9), `lib/skills/sources.ts` (1), `commands/plugin.ts` (20), `lib/plugins.ts` (2), `lib/plugin-api.ts` (1), `commands/tools.ts` (6), `commands/deps.ts` (14 + 1), `commands/hooks.ts` (23), `commands/intercept.ts` (22). Also the copy audit of `lib/skills/` and `lib/deps/`.
- **Shared items:** consumes 1 (`lib/skills/sources.ts`, `lib/plugins.ts`, `lib/plugin-api.ts`), 8.
- **Must not touch:** `lib/setup/validators/writing-style.ts` and `lib/setup/tools-install.ts` (phase 3's copy pass); `lib/skills/writing-style.ts`'s `WRITING_STYLE_SOURCE_LABEL` wording is shared with phase 3's setup row, so change it only after phase 3 merges; `lib/plugins.ts:346` (a scaffold template, the guard's hit there needs a reword, not a conversion).
- **Second cut:** (i) the seven `skills` files and `lib/skills/sources.ts`; (ii) `plugin`, `tools`, `deps`, `hooks`, `intercept`.

### 5e. Team, home, release and repos

- **Verbs:** `team` (all), `home init|key export|key import|snapshot|claim|release`, `release` (all), `repos` (all).
- **Owns (11 allowlisted files, 114 guard lines, 57 seam lines; 161 visible sites, 28 guard-only):** `commands/team.ts` (2 + 30), `lib/team/invite.ts` (1), `lib/team/join.ts` (1), `lib/team/members.ts` (1), `commands/home.ts` (69), `lib/home/age-key.ts` (1), `lib/prompt-secret.ts` (1), `commands/release.ts` (14), `commands/repos.ts` (8 + 21), `lib/repo-index.ts` (10), `lib/repo-tracking.ts` (6). Also `commands/repos-reidentify.ts` (6 seam) and the copy audit of `lib/team/`, `lib/home/`, `lib/release/`.
- **Shared items:** owns 10; consumes 1 (`lib/repo-index.ts`, `lib/repo-tracking.ts`, the three `lib/team` sinks), 8; pins a hostile branch name for 5 (`repos status` prints branches).
- **Must not touch:** `commands/setup.ts` (`home remote set` lives there, phase 3's); `lib/setup/**`; `lib/secrets/store.ts`; the JSON written by `team status`, `team invite`, `team create`, `team join --dry-run`, `team members sync`, `home init --dry-run` (the tray decodes each).
- **Second cut:** (i) `team` and `lib/team`; (ii) `home`, `release`, `repos` and their lib files.

### 5f. sdm, port, chat and runs

- **Verbs:** `sdm connect|connections|status|login|refresh|enrichment`, `port`, `chat`, `runs`, `runs show`, `runs abandon`.
- **Owns (8 allowlisted files, 149 guard lines, 10 seam lines; 117 visible sites, 42 guard-only):** `commands/sdm.ts` (59), `lib/sdm/enrichment.ts` (2), `lib/sdm/picker.ts` (5), `lib/navigate.ts` (1), `commands/port.ts` (19), `commands/chat.ts` (53 + 8), `lib/chat-viewer-url.ts` (1), `commands/runs.ts` (9 + 2).
- **Already on rt-ui, not converted:** the sdm resource picker. `lib/sdm/picker.ts` and `lib/navigate.ts` are guard-only (row colors become roles; the stream pass-through for item 12) and must look the same after.
- **Shared items:** consumes 1 (`lib/sdm/enrichment.ts`, `lib/chat-viewer-url.ts`), 2 (`port`, `sdm`), 8, 12. First streaming caller outside setup: `sdm connect` and `sdm login` move `streamLine` onto step sub-lines, logged through `logCliEvent` at `debug` the way phase 3 does. Owns the spec's one `banner` (the production confirm).
- **Must not touch:** `commands/settings.ts` (`sdm set-email`, phase 4's); `commands/runs-find.ts`, `commands/runs-write.ts`; `lib/herdr-launch.ts` (5c's; `chat` only calls it); `lib/daemon/handlers/chat.ts` (the delivery frame and `renderWelcome` are daemon output, asserted verbatim end to end); `lib/chat-viewer-url.ts`'s `/r/<room>#m-<id>` link shape.
- **Second cut:** (i) `sdm`, `port`, `lib/navigate.ts`; (ii) `chat`, `runs`.

## 4. Order and parallelism

**Planning:** all six plans can be written at once, now. 5b to 5f plan against the three names section 2 fixes (`out.note`, `withTransientStep`, `usageFailure`) and nothing else from 5a. The lib warnings wait on one thing more: 5a's warnings table, which says show or log only per line, so 5a's plan is written first or its table is published early.

**Execution:**

- 5a starts now, alongside phases 3 and 4. It shares no source file with either.
- 5b, 5d and 5e can start now too. Their only calls into 5a are `usageFailure` and `out.note`; they order those tasks last and rebase onto 5a before opening a PR.
- 5c and 5f wait for 5a to merge before their spinner tasks (`lib/enrich.ts`, `port`, `sdm`). Everything else in them can start now under the same rule.
- No slice opens its PR before 5a is on main: its screenshots depend on 5a's renderer fixes, and its allowlist deletions rebase more cleanly over 5a's.
- 5b to 5f share no source file with each other and can merge in any order, with one ordering inside them: `nav` passing a stream (5c) follows `lib/navigate.ts` taking one (5f).

**Files shared with phases 3 and 4, and who lands first:**

| File | Shared between | Order |
|---|---|---|
| `lib/__tests__/raw-output-allowlist.json` | every phase and slice | line deletions only; whoever lands second rebases by hand (ruling 7) |
| `.github/workflows/e2e.yml` path filter | phases 3, 4; any slice adding a pty test | same; append to the filter |
| `AGENTS.md` "Output layer" | phases 3, 4; 5a (the note and the transient step) | append a paragraph, never rewrite; phases 3 and 4 first, since they are ahead |
| `lib/ui/__tests__/capture-out.ts` | phase 2 created it, phase 4 extends it (`console` option, `clear()`) | no phase 5 slice edits it. A slice that needs the console spies waits for phase 4 or sets `out.__test__.setHuman` and reads `stdout()`/`stderr()` |
| `lib/ui/out.ts` | 5a adds `note`; phases 3 and 4 only import it | no conflict expected |
| `lib/skills/writing-style.ts` (`WRITING_STYLE_SOURCE_LABEL`) | phase 3's setup row reads it; 5d's `writing-style show` prints it | phase 3 first; 5d leaves the constant's wording alone until then |
| `lib/prompt-secret.ts` | 5e owns it; phase 3's `logins`, `secrets`, `setup` call it | 5e keeps `promptSecret`'s signature; phase 3 does not edit the file, so either order works |
| `lib/home/age-key.ts` | 5e owns its one debug line; phase 3's files import it | same |
| `commands/setup.ts` (`homeRemoteSet`) | phase 3 only | 5e never edits it, though the verb sits under `home` |
| `commands/settings.ts` (`setSdmEmail`) | phase 4 only | 5f never edits it, though the verb sits under `sdm` |
| `e2e/tests/errors.test.ts`, `e2e/pty/errors.test.ts` | phase 2 wrote them; 5a changes dispatcher text they assert | 5a rebases over whatever phases 3 and 4 changed there |

Neither phase 3's nor phase 4's plan names a file under `ui/`, `lib/command-tree.ts`, `cli.ts`, or any lib file a phase 5 slice owns (checked by grep over both plans).

## 5. Risks: output another program reads

For each, the planner pins `--json` shape or payload bytes with a characterization test before converting.

| Verb | Reader | Where | What to pin |
|---|---|---|---|
| `cd`, `nav` | the `rt()` shell wrapper every user has in their rc file | `SHELL_FUNCTION`, `commands/cd.ts:40` (`dir="$(rt cd ...)"`) | stdout is exactly the path or empty; every human line on stderr; exit code |
| `git credential` | git itself | `commands/git/credential.ts:38` | stdout byte for byte through `out.payload`; nothing on stdout otherwise |
| `sync --json --no-agent` | the `branch_sync` MCP tool | `lib/mcp/git-tools.ts:325` and `:380` | exit codes 0, 3, 4; the envelope keys `error`, `hint`, `tool` and the conflict bundle; **and stderr**: when the envelope has no `error`, `detail(r)` (line 60) reads the last three stderr lines and puts them in the tool's error, which `plugins/mattstack/attachments/forge/rebase-worktree/SKILL.md:257` quotes as `rt sync refused (exit 4): ...` |
| every agent-safe leaf (`git status`, `log`, `branches`; `worktree list`, `triage`, `await-ready`; `repos status`; `skills compile`, `check`, `sync`, `surface`, `bind`; `skills writing-style show`, `team status`, `intercept status`, `runs show`) | `rt_verb` | `lib/mcp/rt-verb.ts:59` (`spawnRtJson` parses stdout as one JSON value) | stdout is one JSON value under `--json`; any incidental note goes through `out.payloadOnStdout()` first (ruling 6) |
| `team status --json`, `team invite --handle --json`, `team create --json`, `team join --dry-run --json`, `team members sync --json` | the tray | `rt-tray/Sources-core/Settings/TeamSettingsModel.swift:28,32`, `Setup/TeamChoiceModel.swift:138,223`, `rt-tray/Sources/NotificationManager.swift:467` (`MembersSyncOutcome.parse(stdout:)`) | each decoded struct's keys and types; the exit-2 envelope `userError` reads |
| `home init --dry-run --json` | the tray | `rt-tray/Sources-core/Setup/TeamChoiceModel.swift:261` | `home init` declares no `--json` and its handler never reads the flag; the tray reads only the exit code, an exit-2 envelope if one appears (`r.userError`), and stderr through `failureCopy`. `--json` on argv does close `out`'s human gate, so the plain text is what the tray can show |
| `tools install <tool> --json`, `deps link <tool> --json` | the tray's row actions | `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift:48,51` | envelope shape and exit code |
| any of the above, on failure | the tray shows the first 200 bytes of stderr to the person | `failureCopy`, `rt-tray/Sources-core/Rt/RtClient.swift:21` | a plain `failure` block's first line must read well alone: title first, no leading blank line, no `[failed]` tag the alert would show raw |
| `release verify --json`, `release apps --json`, `release apps --dry-run`, `release update-machine --plan` and `--yes` | the release skills, on Bash | `skills/mattstack-release/SKILL.md`, `skills/rt-release/fast-path.md`, `publish-and-finish.md` | the three JSON envelopes; **`apps --dry-run` and `update-machine` (`--plan`, `--yes`) are read as text** ("Dry run qualifies?", "Update-machine summary?"): fix the skill text in the same PR |
| `sdm status`, `connections`, `connect` with `--json`; `sdm login` | the sdm skill | `skills/rt-sdm-connect/SKILL.md:25,31,122` | envelopes with `stage`, `error`, `hint`; exit 0 and 1; `sdm login` is read by exit code alone |
| `plugin validate <name>` | the plugin skill, as text (the verb has no `--json`) | `skills/rt-create-plugin/SKILL.md:33,83` ("prints `ok`", "its error strings name the exact ...") | either keep a line a reader can match or update the skill in the same PR |
| `skills check --strict`, `skills compile --dry-run` | CI | `.github/workflows/checks.yml:270,274` | exit codes; nothing parses the text |
| `skills compile --preview` | a file or a preview pane | `commands/skills.ts:875` | the compiled body through `out.payload`, lint notes on stderr |
| `skills compile` output marker | a plugin test greps compiled files for "compiled by rt skills compile" | `plugins/mattstack/tests/stubs-no-source-collision.sh:27` | that string is file content, not terminal output; leave it |
| `home key export` | a person's clipboard or password manager | `commands/home.ts:819` | the key through `out.payload`, alone on stdout |
| `team invite` | a person pastes the code | `commands/team.ts` | a `copy` block; the code never wraps |
| `worktree restore --list`, `worktree restore <tree>` | the worktree skill reads the result as text | `skills/rt-worktree/SKILL.md:289` to `345` | `restore` declares `--json`: move the skill to it, or keep "restored" and "failed" readable |
| `worktree hydrate-clone` (hidden) | the daemon | `lib/worktree/hydrate.ts:27,163` (reads exit code and stderr on failure) | leave its streams as they are; it is not a human verb |
| `intercept run` | whatever called the shimmed tool | `commands/intercept.ts:161` | rt prints nothing of its own on stdout on that path |
| `chat` agent verbs and the delivery frame | agents, `plugins/herdr-chat`, the e2e frame tests | `skills/rt-chat/SKILL.md`, `e2e/tests/chat-inbox-delivery.test.ts`, `chat-presence-roster.test.ts` | the `--json` envelopes and the reply-hint lines quoted in the skill (`rt chat dm <id> "..."`); the frame is the daemon's, not `commands/chat.ts`'s |
| `runs`, `runs show` | the board and skills go through MCP run tools; `plugins/mattstack/hooks/pipeline-gate-stop.sh` uses `runs find` and `runs snapshot` (non-goals) | | `runs --json` and `runs show --json` |
| e2e text assertions | CI on main | `e2e/tests/git-verbs.test.ts` (43 assertions), `plugins.test.ts` (28), `runs.test.ts` (25), `release-apps.test.ts` (23), `sdm-enrichment.test.ts` (7), `skills-writing-style.test.ts` (6), `skills-sync.test.ts` (4), `team-membership.test.ts` (4) | each slice runs `bun run test:e2e` for its files; a TypeScript-only PR does not run them |

## Rulings (Matt, 2026-10-01)

1. **Spinners leave nothing on screen.** The `steps` verb gains an erasing ending; 5a owns the wire change. `port` and `sdm` keep no "scanned" line.
2. **Lib warnings are decided one by one.** 5a's plan carries a table of every one of the roughly 35 `console.warn("rt: ...")` lines under `lib/`, each marked show on stderr and log, or log only, for Matt to skim, as phase 3 did for copy. The slice that owns each file applies its rows.
3. **`cd` and `nav`: the picker wrappers take a stream.** No stdout swap and no permanent exemption (shared item 12).
4. **`agent`, `pane`, `run`, `herd` (its non-worker verbs) and `post-install` go to phase 6.** 5c keeps the exported signatures of `lib/herdr-launch.ts` and `lib/enrich.ts` so `run` is untouched.
5. **`sdm`'s human text moves to stdout,** per rule 2 of the spec. Failures stay on stderr.
6. **5f settles all of `commands/chat.ts`,** agent verbs included (onto `out.json` and `out.payload`), so the file leaves the allowlist.
7. **`plugin validate` gains `--json`** (Matt, 2026-10-01). 5d adds the flag with a result envelope and edits `skills/rt-create-plugin/SKILL.md` to read it in the same PR; the human output is then free to be styled.
8. **PR count: six, split if huge** (Matt, 2026-10-01). One PR per slice; 5d and 5e may each ship as two along their second cut if their plan passes about 2,500 changed lines. Eight at most.
9. **Tray failure text: title only** (Matt, 2026-10-01). The tray shows the first 200 bytes of stderr (`failureCopy`, `rt-tray/Sources-core/Rt/RtClient.swift:21`). When a `failure` block is the first block of a plain render, its first line is the title with no `[failed]` tag; every other plain status keeps its tag. 5a owns the change in `lib/ui/out-plain.ts` and updates the tests that pin `[failed] <title>` as a first line (phase 2's and whatever phases 3 and 4 have landed by then).
10. **`exitUserError`'s unused `verb` argument stays until phase 6.**
11. **A verb already on rt-ui is not converted.** `nav` needs no visible change; see "What rt-ui already draws".
12. **5a takes** the `lineRun` hint wrap, hyphen break points and combining marks in `ui/internal/textwrap` (opt-in, so mission's diff wrap does not change), and `usageFailure`.

## Allowlisted files that are not phase 5's

- **Phase 3:** `commands/accounts.ts`, `logins.ts`, `secrets.ts`, `setup.ts`, `uninstall.ts`, `verify.ts`, `lib/setup/emit.ts`, `finish-gate.ts`, `steps/home.ts`, `team-settings.ts`.
- **Phase 4:** `commands/settings.ts`, `settings-keys.ts`, `settings-schema.ts`, `lib/settings/notice-channel.ts`.
- **Phase 6 or non-goals (38):** `commands/agent.ts`, `apps.ts`, `bg.ts`, `ci.ts`, `cron.ts`, `daemon.ts`, `endpoint.ts`, `events.ts`, `flavor.ts`, `gate.ts`, `glitter.ts`, `herd.ts`, `mcp.ts`, `pane.ts`, `post-install.ts`, `reconciler.ts`, `run.ts`, `runner.ts`, `runs-find.ts`, `runs-write.ts`, `services.ts`, `state.ts`, `state-backup-init.ts`, `state-backup-status.ts`, `worktree-hook.ts`; `lib/cli-logger.ts`, `daemon-logger.ts`, `daemon/inject.ts`, `endpoint/config.ts`, `run-history.ts`, `runner/runner.ts`, `secrets/store.ts`, `state/backup-orchestrator.ts`, `state/backup-restore.ts`, `state/branch-cache.ts`, `state/db.ts`, `state/identity-migrate.ts`, `state/legacy-import.ts`.

`lib/secrets/store.ts` (one debug line) sits behind phase 3's `secrets` verb, but phase 3's plan does not take it, so it falls to phase 6.
