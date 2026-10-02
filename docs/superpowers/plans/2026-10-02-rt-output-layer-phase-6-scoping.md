# rt Output Layer, Phase 6 (Hidden Verbs and Close-out): Scoping and Split

Ticket: RT-369. Date: 2026-10-02. Base: main at `658e704b9` (every phase 1 to 5 slice and 5g merged).

This is not a plan. It splits phase 6 into eleven slices, one PR each, so each slice has one plan and the slices can run in parallel worktrees without touching the same source file. The slice plans sit beside this file as `2026-10-02-rt-output-layer-phase-6<letter>-<name>.md`.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`, "Phases" item 6, "Guard", "Rules", "Copy style". **Rulings:** the cross-phase rulings (13 items, kept in the shepherd's scratchpad, `cross-phase-rulings.md`) bind every slice; this document restates the ones a slice needs. **Scope list:** Matt's follow-ups triage of 2026-10-02 (the shepherd's `followups-triage.md`): every item marked FOLD INTO PHASE 6 is placed below; nothing marked TICKET is (RT-411 owns `rt sync all`'s exit code, RT-412 the terminal query hardening, RT-413 the two flaky tests).

## What phase 6 is

1. **Empty the raw-output allowlist.** `lib/__tests__/raw-output-allowlist.json` holds 42 files today. Each one leaves it in exactly one slice, one of three ways the spec names: converted onto `lib/ui/out.ts`; moved onto `out.json` or `out.payload` with no wording change (agent-only verbs); or put on a permanent exemption list with a one-line reason (a seam that must write to a stream directly). When the list is empty, delete `lib/ansi.ts`, the `lib/tui.ts` shim and `lib/tui/palette.ts`.
2. **Chat daemon refusals get codes,** so `rt chat` draws them `refused` instead of as failures (5f2's decision 8).
3. **Every follow-up Matt folded in:** four behavior bugs, the shell strings and token leftovers, about thirty copy polish items, four renderer leftovers, and chat `read`'s clock and spacing.

## Standing rules every slice carries

- `--json` keeps its shape: keys, structure, types and every value a program reads stay byte-identical. A human sentence inside an envelope may be reworded only where a person reads it on screen. **Any change to a `--json` shape needs Matt's yes, with its readers named** (Decision 2 is the only one phase 6 asks for).
- Exit codes never change, except where a slice states the change and Matt has said yes. Phase 6 has one: `rt settings extension` exits 1 when nothing was installed (slice 6h; Matt's triage, Form 1). RT-411 owns `rt sync all`'s exit code, not phase 6.
- Refusals by policy draw `refused` (an `out.note` on stderr, same exit code); coral is only for a real failure.
- Copy speaks plainly to "you", with no flags, paths, store names or ids in sentences; the command to run goes in a `next` callout. No em or en dashes anywhere. Clean-code comments only.
- An agent-facing verb's stdout off a terminal is frozen byte for byte and pinned by a fixture captured before conversion (the 5f2 chat model). Only verbs a person reads draw blocks, and only when `out.isHuman()`.
- UI validation is mandatory: every slice that changes what a person sees renders it dark and light, screenshots both with Fast Browser, and says plainly what reads wrong.
- A built `rt` binary runs only under an isolated HOME (`env -i HOME=<temp> PATH="$PATH" ...`).

## How the numbers were made

Guard lines: a scan of each allowlisted file with the four patterns of `lib/__tests__/no-raw-output.test.ts`, one count per matching line (script `inv.ts` in the planner's scratchpad, rerunnable from the repo root). Seam lines: `rg -c` on `(deps|d|seams|io|opts|ctx).(print|warn|log|error)(` in the same files. Size estimates are changed lines (insertions plus deletions), tests and fixtures included, PNGs not.

## 1. Inventory: the 42 allowlisted files

Columns: guard lines / seam lines; who reads stdout; how the file leaves the list; slice.

| File | Guard / seam | Reader of its output | Leaves by | Slice |
|---|---|---|---|---|
| `commands/gate.ts` | 18 / 0 | agents (gate skills, `rt gate wait` in eight skills), the board | `out.json`; stderr notes and failures onto the layer, same words | 6a |
| `commands/events.ts` | 7 / 0 | agents, the board | `out.json` | 6a |
| `commands/mcp.ts` | 2 / 0 | Claude Code (stdio MCP), `rt mcp tools --json` readers | `out.json` plus a new `out.drain()`; tool names through `out.payload` | 6a |
| `commands/ci.ts` | 3 / 0 | agents (CI lease) | `out.json`, `out.payload`, failures through `out.fail` | 6a |
| `commands/runs-find.ts` | 1 / 0 | `plugins/mattstack/hooks/pipeline-gate-stop.sh` | `out.payload` | 6a |
| `commands/runs-write.ts` | 1 / 0 | the pipeline skills | `out.payload` | 6a |
| `commands/worktree-hook.ts` | 11 / 0 | Claude Code's WorktreeCreate hook reads the path on stdout; `skills/rt-worktree` reads `hook status --json` | `out.payload`, `out.json`, `warn`, `out.fail` | 6a |
| `lib/cli-logger.ts` | 1 / 0 | nobody: the crash handler's last-resort print | permanent exemption (`lib/ui/out.ts` imports this module) | 6a |
| `lib/daemon-logger.ts` | 6 / 0 | the daemon log | permanent exemption (it is the daemon's stderr capture) | 6a |
| `lib/daemon/inject.ts` | 1 / 0 | nobody: a regex that reads escapes in a pane capture | permanent exemption (it parses escapes, prints none) | 6a |
| `commands/herd.ts` | 11 / 0 | the shepherdr skill, herd MCP tools (`herd brief`), Matt (`herd list`, `herd status`) | frozen stdout; blocks for `list`, `status`, `gates` at a terminal | 6b |
| `commands/pane.ts` | 18 / 0 | skills (`pane send`, `pane spawn`, `pane accounts`), agents | frozen stdout through `out.payload` and `out.json` | 6b |
| `commands/agent.ts` | 12 / 0 | `skills/rt-chat`, `skills/rt-herdr-inject` | frozen stdout; blocks for `agent list` at a terminal | 6b |
| `commands/daemon.ts` | 97 / 7 | Matt; the tray (`daemon logs --no-open`, first line of stderr on failure); `skills/rt-build-dev-app` (`daemon restart`) | converted; `daemon logs` children untouched | 6c |
| `commands/services.ts` | 1 / 8 | the apply engine, the tray | converted; `--json` pinned | 6d |
| `commands/apps.ts` | 1 / 5 | the tray (`apps list --json`, `apps enable/disable --json`) | converted; `--json` pinned | 6d |
| `commands/flavor.ts` | 2 / 5 | the tray (`flavor takeover --json`) | converted; `--json` pinned | 6d |
| `commands/bg.ts` | 7 / 0 | Matt; `rt runner` | converted | 6d |
| `commands/cron.ts` | 6 / 0 | Matt | converted | 6d |
| `commands/reconciler.ts` | 5 / 0 | Matt | converted | 6d |
| `commands/endpoint.ts` | 7 / 0 | Matt; `rt intercept run` reads nothing back | converted | 6d |
| `commands/post-install.ts` | 5 / 0 | the installer (`rt --post-install`), read by exit code | converted | 6d |
| `lib/endpoint/config.ts` | 1 / 0 | any verb reading endpoint config | `warn`, 5a row 39 | 6d |
| `commands/state.ts` | 26 / 0 | the daemon's backup sweep calls the lib, not the verb; Matt | converted; `--json` pinned | 6e |
| `commands/state-backup-init.ts` | 20 / 0 | Matt | converted to steps and lines | 6e |
| `commands/state-backup-status.ts` | 10 / 0 | Matt | converted; `--json` pinned | 6e |
| `lib/state/db.ts` | 4 / 0 | every verb and the daemon | `warn`, 5a rows 33 to 36 | 6e |
| `lib/state/identity-migrate.ts` | 6 / 0 | migrations | `warn`, 5a rows 27 to 32 | 6e |
| `lib/state/legacy-import.ts` | 3 / 0 | migrations | `warn`, 5a rows 24 to 26 | 6e |
| `lib/state/branch-cache.ts` | 2 / 0 | the daemon | `warn`, 5a rows 37, 38 | 6e |
| `lib/state/backup-orchestrator.ts` | 1 / 0 | `rt state backup`, the daemon sweep | `warn`, row 46 below | 6e |
| `lib/state/backup-restore.ts` | 2 / 0 | `rt state restore` | `warn`, rows 47, 48 below | 6e |
| `lib/run-history.ts` | 5 / 0 | `rt run` | `warn`, 5a rows 1 to 5 | 6e |
| `lib/secrets/store.ts` | 1 / 0 | `CLI_DEBUG` only | `logCliEvent("debug", ...)`, row 49 below | 6e |
| `commands/run.ts` | 20 / 0 | Matt; `rt runner` reads `--emit` JSON on stdout | converted; human text on stderr (`payloadOnStdout`) | 6f |
| `commands/runner.ts` | 9 / 0 | Matt (a session view) | preflight failures and reconcile notes only (spec non-goal: the view itself) | 6f |
| `commands/glitter.ts` | 3 / 0 | Matt (a session view) | preflight failures only | 6f |
| `lib/runner/runner.ts` | 2 / 0 | Matt | the two stderr notes | 6f |
| `commands/cd.ts` | 24 / 0 | the `rt()` shell wrapper reads the path on stdout | **Decision 1** | 6f |
| `commands/nav.ts` | 6 / 0 | the same wrapper | **Decision 1** | 6f |
| `commands/code.ts` | 6 / 0 | `rt nav`'s ctrl-o; Matt | **Decision 1** (the `rt nav` paths 5c kept raw), plus the `savePrefs` bug | 6f |
| `lib/pickers.ts` | 3 / 0 | `rt cd`'s refusals | **Decision 1** (the `rt cd` paths 5c kept raw) | 6f |

Totals: 419 guard lines and 25 seam lines. By kind: agent-only and seams 66 (6a), agent verbs with a human view 41 (6b), the daemon verb 104 (6c), service verbs 53 (6d), state 81 (6e), session verbs and `rt cd`/`rt nav` 73 (6f).

## 2. The fold-ins, placed

Every FOLD INTO PHASE 6 item from Matt's triage, with the file that holds it and its slice. "Copy" means a wording change only; anything else is said.

### Form 1: behavior bugs

| Item | Where | Fix direction | Slice |
|---|---|---|---|
| `rt settings extension` exits 0 on failure | `commands/extension.ts:180-214` | exit 1 when the extension is missing or no editor took it (Matt's yes, Form 1) | 6h |
| git-core `stashPop` treats a conflicted pop as success | `packages/git-core/src/stash.ts:41` | `stashPop` returns `{ kept: boolean }` (the pop conflicted and git kept the stash); `rt git stash pop` reads it instead of recounting | 6g |
| `savePrefs` "undefined type" in production (since #294) | `commands/code.ts:59-66` | `rt.workspacePrefs` writes the whole validated object; the warning goes through `warn` and names the key | 6f |
| `rt cd`'s two-row erase wipes the typed command line | `commands/cd.ts:236-238` | delete the exit-time erase: no picker on `rt cd`'s path leaves rows behind | 6f |
| `rt skills init` keeps only `err.message`; the daemon's `next` is lost | `lib/skills/init.ts:375-381`, `commands/skills-init.ts:69-79` | `attempt()` carries a `UserActionableError`'s `why` and `next` into the outcome, and the failure block prefers them to the generic remedy | 6g |

### Form 2: security and robustness

| Item | Where | Fix direction | Slice |
|---|---|---|---|
| Shell strings | `lib/git-backup.ts:62,109,127`; `lib/git-ops.ts:15,28,43,57,115` | every `execSync(string)` becomes `execFileSync("git", argv)`; the interpolated ones (`git-backup.ts:109`, `git-ops.ts:43,57,115`) carry a branch or remote name a shell would read | 6g |
| `rt git tag push --json` echoes a raw `--remote` token | `commands/git/mutate.ts:294` | **Decision 2** | 6g |
| `printable` misses query-string tokens | `commands/git/shared.ts:100-111` | a remote whose query carries a credential parameter prints as `REMOTE` | 6g |
| `TOKEN_SHAPE_RE` duplicates `CREDENTIAL_TOKEN_RE` | `commands/git/shared.ts:89`, `lib/team/redact.ts:20` | export one `holdsCredentialToken` from `lib/team/redact.ts`; `printable` calls it | 6g |

### Form 3: copy polish

| Item | Where | Slice |
|---|---|---|
| `settings list` prints raw `invalid[user]: ...` | `commands/settings-keys.ts:466` (and the `nonconforming[...]`, `diverged[...]` labels beside it) | 6h |
| `settings get` of an unset key prints `<unset>` as the payload | `commands/settings-keys.ts:229` | 6h |
| `rt logins` table has no header | `commands/logins.ts:94` | 6h |
| An unreadable tool version reads "is older than" | `lib/setup/validators/tools.ts:117,522` | 6h |
| `failCannotAsk` says "more than one repo" when it means worktrees | `lib/repo.ts:45-52,312` | 6h |
| Skills titles name paths and flags | `commands/skills-link.ts:75,79`, `commands/skills-expand.ts:32,48`, `lib/skills/init.ts:313,351` | 6g |
| `skills init`'s multi-line compile failure puts `next` mid-list | `commands/skills-init.ts:69-79` | 6g |
| `team members remove`'s `next` holds a sentence | `commands/team.ts:310` | 6h |
| `forge-login-unknown` remedy reads in the wrong order | `lib/team/join.ts:621-625` | 6h |
| "recognise" | `commands/team.ts:242`, `commands/home.ts:414,431` | 6h |
| "0 of 1 connection have a label" | `commands/sdm.ts:253-254` | 6i |
| "pid NaN" hint | `commands/port.ts:136` | 6h |
| `repos prune`'s duplicate row repeats the kept name three times | `commands/repos.ts:222-235` | 6h |
| `missingRepoRefusal`: a long dash and the wire form | `lib/repo-index.ts:1470-1473` (only `rt cd`'s paths call it) | 6f |
| `repos prune`'s `--repo <key>` next is the wire form | `commands/repos.ts:253`; `lib/repo-arg.ts` learns `host/path` | 6h |
| Rebase conflict file lists sit flush left with no caption | `commands/git/rebase.ts:116-122`, `lib/rebase-escalation.ts` (`manualReport`, `:303`, `:333`, `:337`) | 6g |
| `rt intercept run`'s passthrough notes keep an `rt-intercept:` prefix and a long dash | `lib/endpoint/run.ts:102,115,155` | 6d |
| `tools install` of a refused bundled link reads coral | `lib/setup/tools-install.ts:86-90,176-180`, `commands/tools.ts:86-89` | 6h |
| Cross-verb "not ours" wording | `lib/skills/link.ts:126`, `commands/skills-link.ts:118` (6g); `commands/intercept.ts:295`, `commands/worktree.ts:428`, `lib/setup/steps/index.ts:31` (6h) | 6g, 6h |
| `healErrorClause` lowercases by a fixed word list | callers `commands/repos.ts:163` (6h) and `commands/skills-init.ts:93` (6g) stop using it; 6k deletes it from `lib/repo-index.ts:272` | 6g, 6h, 6k |
| `lib/worktree/dispose.ts` returns sentences the CLI parses | `lib/worktree/dispose.ts:229,232`, `commands/worktree.ts` (`disposeReason`) | 6h |
| `skills surface apply` prints row by row (one rt-ui spawn each) | `commands/skills.ts:2316-2355` | 6g |
| `skills sync`'s missing-Claude guard draws refused while `init`'s draws a failure | `commands/skills-sync.ts:156-176`, `commands/skills-init.ts:241-245` | 6g |

The one phrase for "not ours", used by every site in both slices: a sentence that says **rt did not make it, so rt left it alone**, worded to fit the site. The exact strings are in 6g's and 6h's copy tables.

### Renderer leftovers (Form 3)

| Item | Where | Slice |
|---|---|---|
| `fitColumns` clips the widest leading column at narrow widths (a table's value is lost at 48 columns) | `ui/internal/render/blocks_layout.go:27-55,103-140` | 6i |
| A command moved to column 0 has no gap before the next row | `ui/internal/render/blocks_basic.go:100-133`, `render.go:54-73` | 6i |
| `settleBackground` reruns per step when no answer comes (`NO_COLOR`, `TERM=dumb`, an old helper) | `lib/ui/spawn.ts:39-53` | 6i |
| `sdm`'s `withProgress` clears its step when the task throws | `commands/sdm.ts:97-113` | 6i |

### Chat (Form 3, and 5f2's decision 8)

| Item | Where | Slice |
|---|---|---|
| Three daemon refusals carry no code: release by a non-holder, `--as` naming an identity another session holds, `--as` naming the human's or the herd's handle | `lib/daemon/handlers/chat.ts:1027-1033`, `lib/state/presence-store.ts:259-270`, `lib/daemon/handlers/types.ts:98-100` | 6j |
| `chat read` shows UTC with no zone on the human path | `commands/chat.ts:655` (the frozen line at `:516` stays UTC) | 6j |
| `chat read` runs messages together | `commands/chat.ts:648-660` | 6j |

### Carried from earlier phases

| Item | Source | Slice |
|---|---|---|
| `exitUserError`'s unused `verb` argument goes | phase 5 scoping, ruling 10 | 6k |
| Delete `lib/ansi.ts`, `lib/tui.ts`, `lib/tui/palette.ts` and its test | spec "Guard" | 6k |

## 3. Shared work

Each item has exactly one owner.

| # | Item | Owner | What the others see |
|---|---|---|---|
| 1 | **Permanent exemptions.** A new `lib/__tests__/raw-output-exemptions.json`: `[{ "file": string, "reason": string, "lines": number }]`. The guard skips an exempt file only while its raw-line count is at most `lines`, so an exemption never grows silently, and the test fails if an exempt file is also on the allowlist. | 6a creates it and the three seam entries | 6f appends entries only under Decision 1 option A. 6k checks it holds only seams |
| 2 | **`out.drain(): Promise<void>`** in `lib/ui/out.ts`: resolves once stdout has flushed everything written before it. `rt mcp tools --json` needs it (a roster larger than a pipe buffer). | 6a | Nobody else calls it |
| 3 | **`out.holdStdout(): () => void`** in `lib/ui/out.ts` (Decision 1 option B only): until the returned release runs, writes to stdout go to stderr; the release restores stdout and returns nothing. It replaces the hand-rolled `process.stdout.write` swaps in `cd.ts` and `nav.ts`. | 6f | Nobody else calls it |
| 4 | **Lib warnings.** 5a's warnings table already decided every phase 6 row (5a plan, "The warnings table", rows 1 to 5 and 24 to 39, marked P6). Rows 46 to 52 below are the ones 5a did not see. Each slice applies its rows. | 6d, 6e, 6a, 6f | |
| 5 | **The "not ours" phrase** (section 2). | 6g, 6h at their own sites | |
| 6 | **`healErrorClause`.** 6g and 6h stop calling it; 6k deletes it and its test. | 6g, 6h, 6k | |
| 7 | **`CommandResult` may carry `failure`.** `lib/daemon/handlers/types.ts`'s failure branch gains `failure?: { code: string; message: string }`, which `createHandleCommand` already passes through. | 6j | Additive; no other handler changes |
| 8 | **The frozen-stdout fixture pattern** (5f2's `chat-bytes.json`): each agent-facing slice captures its own fixture before converting, ASCII-escaped, never regenerated after. | 6a, 6b | No shared code |

Warnings 5a did not list (Matt: skim the Decision column and flip any row):

| # | File:line | Today's text | Decision | Reason | Shown copy |
|---|---|---|---|---|---|
| 46 | `lib/state/backup-orchestrator.ts:237` | `git lfs prune warning: <first 200 chars of stderr>` | Log only | housekeeping after a backup that already worked | |
| 47 | `lib/state/backup-restore.ts:159` | `git pull failed (exit <n>), continuing with local backups` | Show | the restore may be older than the person expects | `rt could not pull the latest backups` / `restoring from the copies on this Mac` / no next |
| 48 | `lib/state/backup-restore.ts:172` | `git lfs pull failed (exit <n>), continuing with local backups` | Show | the same | the same as row 47 |
| 49 | `lib/secrets/store.ts:503` | `[secrets] <argv> (env/output redacted)` under `CLI_DEBUG` | Log only, at `debug` through `logCliEvent` | a debug trace | |
| 50 | `commands/worktree-hook.ts:119` | `rt: skipping claude hook install offer... rt is not on PATH` | Show | the person said yes and nothing happened | `rt could not install the worktree hook` / `rt is not on your PATH` / no next |
| 51 | `commands/worktree-hook.ts:125` | `rt: claude hook install offer failed... <err>` | Show | the same | `rt could not install the worktree hook` / `<first line of err>` / `rt worktree hook install` |
| 52 | `commands/code.ts:64` | `rt: could not save workspace prefs -- <err>` | Show | the editor choice was not remembered | `rt could not remember your editor choice` / `<first line of err>` / `rt settings check` |

## 4. The split

Eleven slices. Every slice also touches the shared files of cross-phase ruling 7: `lib/__tests__/raw-output-allowlist.json` (its own line deletions), `AGENTS.md` "Output layer" (append only), `docs/design/output-layer/README.md` (append a row), and `.github/workflows/e2e.yml` (only to add a pty path).

| Slice | Name | Owns | Allowlist lines | Est. size |
|---|---|---|---|---|
| 6a | agent-only | `commands/gate.ts`, `events.ts`, `mcp.ts`, `ci.ts`, `runs-find.ts`, `runs-write.ts`, `worktree-hook.ts`; `lib/cli-logger.ts`, `lib/daemon-logger.ts`, `lib/daemon/inject.ts`; `lib/__tests__/no-raw-output.test.ts`; new `lib/__tests__/raw-output-exemptions.json`; `out.drain` in `lib/ui/out.ts` | 10 | 1,300 |
| 6b | herd-pane-agent | `commands/herd.ts`, `pane.ts`, `agent.ts` | 3 | 1,400 |
| 6c | daemon | `commands/daemon.ts` | 1 | 2,100 |
| 6d | services | `commands/services.ts`, `apps.ts`, `flavor.ts`, `bg.ts`, `cron.ts`, `reconciler.ts`, `endpoint.ts`, `post-install.ts`; `lib/endpoint/config.ts`, `lib/endpoint/run.ts` | 9 | 1,700 |
| 6e | state | `commands/state.ts`, `state-backup-init.ts`, `state-backup-status.ts`; `lib/state/backup-orchestrator.ts`, `backup-restore.ts`, `branch-cache.ts`, `db.ts`, `identity-migrate.ts`, `legacy-import.ts`; `lib/run-history.ts`; `lib/secrets/store.ts` | 12 | 1,600 |
| 6f | session-cd-nav | `commands/run.ts`, `runner.ts`, `glitter.ts`, `cd.ts`, `nav.ts`, `code.ts`; `lib/runner/runner.ts`, `lib/pickers.ts`; `missingRepoRefusal` and `ghostPathRefusal` in `lib/repo-index.ts`; `out.holdStdout` in `lib/ui/out.ts` (option B) | 8 | 1,900 (B), 900 (A) |
| 6g | git-skills-fixes | `packages/git-core/src/stash.ts`, `types.ts`; `lib/mission/__tests__/driver.test.ts`; `commands/git/mutate.ts`, `shared.ts`, `rebase.ts`; `commands/sync.ts`; `lib/rebase-escalation.ts`; `lib/team/redact.ts`; `lib/git-backup.ts`, `lib/git-ops.ts`; `commands/skills-init.ts`, `skills-link.ts`, `skills-expand.ts`, `skills.ts`, `skills-sync.ts`; `lib/skills/init.ts`, `lib/skills/link.ts` | 0 | 1,700 |
| 6h | copy-polish | `commands/settings-keys.ts`, `extension.ts`, `logins.ts`, `tools.ts`, `intercept.ts`, `worktree.ts`, `team.ts`, `home.ts`, `repos.ts`, `port.ts`; `lib/setup/validators/tools.ts`, `lib/setup/tools-install.ts`, `lib/setup/steps/index.ts`; `lib/worktree/dispose.ts`; `lib/repo.ts`, `lib/repo-arg.ts`; `lib/team/join.ts` | 0 | 1,500 |
| 6i | renderer | `ui/internal/render/**`; `lib/ui/spawn.ts`; `commands/sdm.ts` | 0 | 900 |
| 6j | chat-codes | `lib/daemon/handlers/types.ts`, `lib/daemon/handlers/chat.ts`, `lib/state/presence-store.ts`, `commands/chat.ts` | 0 | 800 |
| 6k | close-out | deletes `lib/ansi.ts`, `lib/tui.ts`, `lib/tui/palette.ts` and its test; `lib/__tests__/no-raw-output.test.ts` and the allowlist JSON; `lib/errors.ts` and every `exitUserError` caller; `healErrorClause` in `lib/repo-index.ts`; `ui/internal/theme/theme.go`'s header comment; `e2e/tests/settings.test.ts:121`; the spec's status line | its own: none left | 700 |

No slice passes 2,500 lines. 6c is the largest; its plan names a second cut (`status`/`track` first, the lifecycle verbs and `logs` second).

**Must not touch (every slice):** a file another slice owns; `ui/**` (6i's alone); `lib/ui/**` except the one export a slice is named for in section 3 (6a `drain`, 6f `holdStdout`, 6i `spawn.ts`); `lib/ui/__tests__/capture-out.ts`.

## 5. Order and parallelism

- **6a lands first.** It creates the exemption file (6f's option A appends to it) and the shape of the agent-verb conversion 6b copies. Nothing else waits on it for code.
- **6b to 6j run in parallel** once 6a's plan is approved. They share no source file. Two of them append one export each to `lib/ui/out.ts` (6a `drain`, 6f `holdStdout`): whoever merges second rebases by hand, as with the allowlist.
- **6f waits for Matt's answer to Decision 1** before Task 2. Its Task 1 stops if the answer is not in its plan's ledger.
- **6g's Task for `tag push` waits for Matt's answer to Decision 2.** Every other 6g task can run.
- **6k runs last,** after every other slice is on main. Its first task stops unless the allowlist is empty on `origin/main`.
- PRs are titled `RT-369: output layer phase 6<letter>, <name>`.

## 6. Who reads what (each slice's plan pins these before converting)

| Verb | Reader | What to pin |
|---|---|---|
| `gate *` | eight skills run `rt gate wait`, `answer`, `park` in Bash; the board | every `--json` line; exit codes; stderr notes keep their words |
| `events *` | the board, agents | every `--json` line; `events watch`'s NDJSON stream |
| `mcp serve`, `mcp tools --json` | Claude Code; e2e `mcp-serve.test.ts` | stdout is only JSON-RPC (serve) or one JSON value (tools) |
| `runs find`, `runs run-start` and the other run-tracking writes | `plugins/mattstack/hooks/pipeline-gate-stop.sh`, the pipeline skills | stdout bytes and exit codes |
| `worktree claude-hook` | Claude Code reads the path on stdout | stdout is the path alone; stderr refusals; exit codes |
| `worktree hook status --json` | `skills/rt-worktree/SKILL.md` | the envelope |
| `herd *` | shepherdr skill (`herd spawn`, `stop --hidden`, `attend`, `wrap-up`), `lib/mcp/herd-tools.ts` (`herd brief`) | stdout bytes off a terminal for every verb |
| `pane *`, `agent *` | `skills/rt-herdr-inject`, `skills/rt-chat` | stdout bytes off a terminal |
| `apps list/enable/disable --json`, `flavor takeover --json` | the tray (`AppsSettingsModel.swift`, `FlavorLaunch.swift`) | envelopes; exit codes |
| `daemon logs --no-open` | the tray (`LogViewerLaunch.swift`): the first non-empty line of stderr, else stdout, on an early exit | that first line reads well alone |
| `daemon restart` | `skills/rt-build-dev-app` | exit code |
| `cd`, `nav` | the `rt()` shell wrapper (`dir="$(rt cd ...)"`) | stdout is the path or empty; exit codes |
| `git tag push --json` | nothing in this repo (no skill, MCP tool, tray model or script); only `commands/git/__tests__/mutate*.test.ts` | Decision 2 |
| `chat *` | 5f2's fixture `commands/__tests__/fixtures/chat-bytes.json` | must pass unchanged |

## Decision 1: how `rt cd` and `rt nav` leave the allowlist (for Matt)

Matt ruled on 2026-10-01 that `rt cd` and `rt nav` are rt-ui session verbs and are not converted: the pickers and the navigator are rt-ui and stay exactly as they are. Four files still print raw on their paths: `commands/cd.ts` (24 lines: the stdout swap, nine shell-wrapper notes, two refusals, the exit-time erase), `commands/nav.ts` (6: the stdout swap, two Quick Look lines), and the paths 5c left byte-for-byte in `lib/pickers.ts` (3) and `commands/code.ts` (6). Matt also folded in the fix for `rt cd`'s two-row erase, which wipes the typed command line on every cached run.

**Option A: an explicit, tested exemption.** The four files go on `raw-output-exemptions.json` with the reason "rt cd and rt nav are rt-ui session verbs; their raw lines are kept byte for byte (Matt, 2026-10-01)" and a pinned line count. The only edit is the erase fix (deleting the `\x1b[2A\x1b[0J` exit hook, which also lowers `cd.ts`'s count). About 900 lines with tests. What stays: the yellow escape-colored shell-wrapper notes, the `missingRepoRefusal` long dash and wire form, and two known bugs 5c recorded: under `rt nav`, "No supported editor CLI found" goes to stdout, so `dir="$(rt nav)"` takes it as the folder; and three children of `rt nav` inherit stdout.

**Option B: a narrow conversion of only the non-rt-ui prints.** Nothing rt-ui draws changes: no picker, prompt, navigator or step. What changes: the shell-wrapper install and upgrade notes become `out.note` lines on stderr (a `warn` line and a `copy` block for the function to paste); the two refusals become `failure` blocks on stderr with plain copy and the command in `next`; the Quick Look lines become `out.note`; the `rt nav` paths in `code.ts` move their no-editor lines to stderr (fixing the `$dir` bug); the children of `rt nav` get stdout redirected to stderr; the hand-rolled stdout swaps become `out.holdStdout()`; the erase is deleted. stdout stays the path and nothing else, pinned before and after. The allowlist empties with only true seams exempt. About 1,900 lines with tests.

**Recommendation: B.** It keeps Matt's ruling (nothing rt-ui draws is touched), fixes the two `rt nav` stdout bugs that A would freeze into an exemption, and leaves no human text exempt from the layer, which is what "the allowlist is empty" is for. A is the smaller change if Matt wants `rt cd` and `rt nav` frozen until his hand check after the release; B's PR then waits for that check.

## Decision 2: `rt git tag push --json` echoes a raw `--remote` (for Matt)

`rt git tag push v1 --remote https://x:TOKEN@host/repo.git --json` writes `{"ok":true,"name":"v1","remote":"https://x:TOKEN@host/repo.git"}` to stdout, so a token passed on the command line lands in whatever captured the output. The human line already prints `printable(remote)`.

**Readers of the envelope:** none outside its own tests. Searched `skills/`, `plugins/`, `apps/`, `marketplace/`, `rt-tray/`, `lib/mcp/`, `scripts/` and `e2e/`: no caller parses `rt git tag push --json`, the verb is not agent-safe so `rt_verb` cannot run it, and the only assertions are in `commands/git/__tests__/mutate.test.ts` and `mutate-json.test.ts`.

**Option 1: `remote` carries `printable(remote)`.** Same key, same type; the value differs only when the remote holds a credential, where it becomes the remote without its userinfo or the word `REMOTE`. Shape unchanged; one machine-read value changes, which is why it needs a yes.
**Option 2: leave the envelope as it is.** The token keeps reaching stdout when someone passes one; 6g still fixes `printable` and the duplicated regex.
**Option 3: drop `remote` from the envelope.** A key removed: a shape change, with no reader to justify it.

**Recommendation: option 1.** It closes the leak with no structural change and no reader to break.

## Items not placed

None. Every FOLD INTO PHASE 6 item is in section 2. Out of scope by Matt's triage: `rt sync all`'s exit code (RT-411), terminal query hardening (RT-412), the two flaky tests (RT-413), and the two hand checks Matt does himself after the release (`rt sdm login`, `rt cd`/`rt nav`).
