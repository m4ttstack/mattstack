# rt Output Layer, Phase 5c (Worktree and Navigation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every human line printed by `rt worktree` (all but the hook verbs) and `rt settings extension` comes from the output layer, as do `rt code`'s own lines and the refusals `lib/pickers.ts` prints for its callers other than `rt cd`. Five files leave the raw-output allowlist: `commands/worktree.ts`, `lib/enrich.ts`, `lib/herdr-launch.ts`, `lib/worktree/config.ts`, `commands/extension.ts`. `rt cd` and `rt nav` are not touched (Matt, 2026-10-01: both are already drawn by rt-ui): `commands/cd.ts` and `commands/nav.ts` are not edited and stay on the allowlist, and everything they reach in `lib/pickers.ts` and `commands/code.ts` prints as it does today. The one way `rt cd`'s screen changes is the branch-info fetch on a cold cache, which becomes a spinner that leaves nothing, as it does for every other caller (Matt, same day).

**Architecture:** `commands/worktree.ts` is converted in three passes (failures and the `--json` doors, then the list-shaped verbs, then `each`), after which `lib/enrich.ts` can drop its ANSI label formatter and move its `\r` fetch line onto 5a's `withTransientStep` for every caller. `lib/pickers.ts` and `commands/code.ts` are shared with `rt cd` and `rt nav`, so each converts only the paths those two never reach and keeps the others byte for byte; both stay on the allowlist because they still print raw on the kept paths. No picker, prompt or step changes how it draws.

**Tech Stack:** Bun + TypeScript (`commands/`, `lib/`), `bun:test`. No Go change: all of `ui/` is 5a's.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369), phase 5 of "Phases", plus "Rules", "Block vocabulary", "Status set", "Copy style", "Guard" and "Testing". The slice is defined by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md` (section 1 "What rt-ui already draws", section 2 items 1, 2, 5 and 8, section 3 "5c", section 5, rulings 1, 2, 4 and 11), as narrowed on 2026-10-01: shared item 12 and ruling 3 were withdrawn, and `rt cd` and `rt nav` left the slice (see "Decisions"). The API this plan calls is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md` ("API for slices 5b to 5f", "The breadcrumb header", and rows 21 to 23 of its warnings table). The twelve cross-phase rulings in `.superpowers/sdd/cross-phase-rulings.md` bind this plan.

**What was run while writing this plan:** two scratch scripts on Bun 1.4.2: a `process.stdout.write` swap does not catch `console.log` (the text still reaches fd 1), and `os.homedir()` does not follow a later change to `HOME`. Everything else is uncompiled and was written against the files at `9390e493d` (main `5bc69f231` plus the plan documents). Line numbers are from that commit and will have moved by the time 5a, phase 3 and phase 4 are on main; every edit below also names the function or the text it replaces.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` output of every existing command must not change, byte for byte. Plain text off a TTY takes the new wording.
- Human text goes to stdout except in payload verbs; failures go to stderr through `out.fail`; never style a payload.
- Coral only for failures. A state that is not done is pending, off, refused, needs-you, stale, skipped or warn.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Every converted file: delete its line from `lib/__tests__/raw-output-allowlist.json` in the same commit.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. No real team, person or host names.
- Every leaf picker and every human branch gates on TTY, `--json` and `RT_BATCH` exactly as today; the non-TTY and `--json` paths keep their exit codes.
- 5c only: no picker, prompt or step is converted. The six leaf pickers of `rt worktree`, the editor and target pickers of `rt code` and the editor multiselect of `rt settings extension` look and behave as they do today (Matt's ruling 11).
- 5c only: `rt cd` and `rt nav` are already rt-ui and are not part of this slice. `commands/cd.ts`, `commands/nav.ts` and their tests are not edited, both files stay on the allowlist, and nothing they print changes, with one exception named below. Where this slice's files are called from them, the signatures and the bytes those callers print stay as they are today: in `lib/pickers.ts`, `pickFromAllRepos`, `pickWorktreeWithSwitch`, `pickPackageWithEscape` and `resolveWorktreeByBranch` on the path `rt cd` takes (it passes `stderr: true`, and no other caller does); in `commands/code.ts`, `openDirectoryInEditor` (which `rt nav`'s ctrl-o calls), the no-editor branch of `ensureEditor` it reaches, and `savePrefs`'s warning. The exception: `enrichBranches`'s fetch line becomes a transient step for every caller, so on a cold cache `rt cd`'s worktree picker shows a spinner that leaves nothing instead of today's two lines.
- 5c only: several existing strings in these files hold a long dash, and several of them are `--json` `error` values that must stay byte for byte. Never retype such a string. Leave the literal where it is, or move it with cut and paste; this plan never quotes one in full for that reason.
- 5c only: exit codes do not change. Every refusal that exits 1 today still exits 1; `rt worktree dispose` with a refused tree and `rt worktree await-ready` on an unready tree still set exit code 1; `rt settings extension` still exits 0 when it finds nothing to install.
- 5c only: rt declining to do something by policy (a guard, a lock another operation holds, a branch another worktree holds, a folder it will not overwrite) is a `refused` line on stderr through `out.note`, never `out.fail` and never coral. Exit codes and `--json` values do not change.
- 5c only: no daemon code (`dirty`, `no-token`, `manual`) and no daemon sentence reaches the screen as the daemon wrote it. `commands/worktree.ts` maps each one through the copy table in Task 2; `--json` keeps the raw value. `lib/worktree/dispose.ts` and `lib/explain-error.ts` are not edited.
- 5c only: `lib/enrich.ts`, `lib/worktree/config.ts` and `lib/herdr-launch.ts` are loaded by the daemon. They may import `lib/ui/out.ts`, `lib/ui/warn.ts` and `lib/ui/transient-step.ts`; they must never import `lib/ui/spawn.ts`, `steps.ts`, `pick.ts`, `prompts.ts`, `lib/pick-wrappers.ts` or `lib/repo.ts`, not even as a type (`lib/__tests__/no-eager-tui.test.ts`).
- 5c only: the exported signatures of `lib/enrich.ts` that another file imports (`enrichBranches`, `formatBranchSegments`, `refreshAllMRs`, `parseRemoteUrl`, `isGitLabRemote`, `isGitHubRemote`, `forgeTokenFor`, `defaultBranchOf`, `numericUserId`, `toMRInfo`, `isDefaultBranch`, `MR_TERMINAL_STATES`, the types) and of `lib/herdr-launch.ts` (`launchFallback`, `shellQuote`, `LaunchItem`) stay as they are, so `commands/run.ts` and `commands/daemon.ts` (phase 6) are untouched.
- 5c only: files this slice must not edit: anything under `ui/`; `commands/cd.ts`, `commands/nav.ts` and their tests (`commands/__tests__/cd*.test.ts`, `commands/__tests__/nav.test.ts`, `lib/__tests__/cd-cache-read.test.ts`, `lib/__tests__/repo-index-missing.test.ts`); `lib/ui/pick.ts`; `commands/worktree-hook.ts`; `lib/navigate.ts` (5f); `lib/repo.ts`, `lib/command-tree.ts`, `lib/ui/out.ts`, `lib/ui/out-plain.ts`, `lib/ui/warn.ts`, `lib/ui/usage.ts`, `lib/ui/transient-step.ts`, `lib/ui/screen.ts` (5a); `lib/repo-index.ts` (5e); `lib/explain-error.ts` (shared with `lib/mcp/tools.ts`, whose text agents read); `lib/repo-arg.ts`; `commands/run.ts`, `commands/daemon.ts` (phase 6); `lib/pick-wrappers.ts`, `lib/ui/pick-fake.ts` (no slice needs them changed); `lib/ui/__tests__/capture-out.ts` (phase 4 extended it); `skills/rt-worktree/SKILL.md`.
- 5c only: git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.

## Review Focus

1. **What `rt cd` and `rt nav` print.** They are out of this slice, but they call `lib/pickers.ts` and `commands/code.ts`, which are in it. Their refusals and the "Opened" line must come out byte for byte as today, on the stream they use today; the shell wrapper runs `dir="$(rt cd ...)"` and changes into whatever stdout holds. Pinned in Task 3 (`with the stderr flag rt cd passes, the refusals print as today`) and Task 10 (`the opener rt nav calls prints as it does today`).
2. **A branch name carrying a right-to-left override or a zero-width character.** `rt worktree list` prints branch names another person pushed. Both renderers drop the hidden character (5a); this slice pins it against its own verb. Pinned in Task 7 (`a hostile branch name is printed without its hidden character`).
3. **`--json` when the daemon is down or slow.** An agent that passed `--json` must never get a styled human line on stdout to parse. Pinned in Task 6 (`--json with the daemon down leaves stdout empty and exits 1`).
4. **Team-written setup steps that carry escape sequences.** `rt worktree ready-approve` asks a person to approve shell the team wrote; the person must see every step, one per line, as plain characters. Pinned in Task 7 (`the steps a person approves are shown one per line with escapes removed`).
5. **A worktree row with nothing in its last columns.** Most rows have no owner, no merge request and no note; the table must not leave trailing spaces or an empty column an agent then splits on. Pinned in Task 7 (`a row with nothing after its branch ends at the branch`).
6. **The cold fetch.** The fetch line becomes a spinner on `/dev/tty` that leaves nothing on the streams, for every caller, `rt cd` included. Pinned in Task 9 (`a cold fetch runs under a step that is cleared, and writes nothing to stderr`).
7. **A refusal drawn as a failure.** A guard that declines (a dirty tree, a held lock, a branch another worktree has) must read as `[refused]` on stderr, not coral. Pinned in Task 6 (`a lock another operation holds is a refusal on stderr, not a failure`) and Task 7 (the dispose tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/pickers.ts` (modify) | The no-repos and missing-repo refusals of `pickFromAllRepos` through `out.fail` for callers other than `rt cd`; `rt cd`'s path (the `stderr` flag) and `resolveWorktreeByBranch` print as today. Stays on the allowlist |
| `lib/worktree/config.ts` (modify) | Three warnings through `warn` (5a rows 21 to 23) |
| `lib/herdr-launch.ts` (modify) | The one-at-a-time fallback through `out.note` |
| `commands/worktree.ts` (modify) | Every verb's human output, failures and `--json` doors |
| `lib/worktree-each.ts` (modify) | `summarizeEach` replaces `formatSummary`; `errorKind` on the parsed args |
| `lib/enrich.ts` (modify) | The fetch line becomes a transient step; the ANSI label formatter is deleted |
| `commands/code.ts` (modify) | `rt code`'s opened and failed lines and its no-editor failure; `openDirectoryInEditor`, the no-editor branch it reaches and `savePrefs`'s warning print as today. Stays on the allowlist |
| `commands/extension.ts` (modify) | One step per editor while it installs; the result lines and the summary |
| `lib/__tests__/raw-output-allowlist.json` (modify) | Five lines deleted |
| Tests beside each of the above (Tasks 3 to 11 name them) | |
| `docs/design/output-layer/` (modify) | Four renders |

---

### Task 1: 5a is on main

No code. Every later task calls an API that exists only once 5a has merged.

**Files:** none.

**Interfaces:**
- Consumes: main at or after the 5a merge.
- Produces: a branch rebased on that main, with the helper built.

- [ ] **Step 1: Fetch**

Run: `git fetch origin`

- [ ] **Step 2: Look for the 5a merge**

Run: `git log origin/main --oneline -40`
Expected: one line reading `RT-369: output layer phase 5a, ...`.

If it is not there, **stop**. Report to the shepherd: "5c is blocked: phase 5a is not on main." Do not start any task below, and do not build 5a's API yourself.

- [ ] **Step 3: Rebase**

Run: `git rebase origin/main`
Expected: clean. A conflict in `lib/__tests__/raw-output-allowlist.json` is resolved by keeping every deletion from both sides.

Phase 4 is on main (`19ceaa403`) and phase 3 will be by the time this runs. Phase 4 extended `lib/ui/__tests__/capture-out.ts`: `captureOut(opts?: { console?: boolean })` and a `clear()` that empties what was captured so far. This plan's tests call `io.clear()` between two runs in one test; confirm it is there with `grep -n "clear" lib/ui/__tests__/capture-out.ts`. Where phase 3 or 4 changed a line this plan quotes, main wins.

- [ ] **Step 4: Confirm the API this plan calls**

Run each alone:

```bash
ls lib/ui/transient-step.ts lib/ui/usage.ts lib/ui/warn.ts
```

```bash
grep -n "export function note" lib/ui/out.ts
```

```bash
grep -n "export function missingRepoFailure" lib/repo.ts
```

```bash
grep -n "clear(): Promise<boolean>" lib/ui/spawn.ts
```

Expected: three files listed and one match from each grep. A missing one means 5a landed with a different name: stop and report which.

- [ ] **Step 5: Build the helper and take a baseline**

Run: `bun install --frozen-lockfile`
Run: `bun run ui:build`
Run: `bun test commands/__tests__/worktree.test.ts commands/__tests__/cd.test.ts commands/__tests__/nav.test.ts lib/__tests__/pickers.test.ts lib/__tests__/repo-index-missing.test.ts lib/__tests__/herdr-launch.test.ts lib/worktree/__tests__/config.test.ts commands/__tests__/code-prefs.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS. Write down any failure before touching a file; a test that fails here is not this slice's.

---

### Task 2: Audit of the print sites this slice owns

No code. This is the inventory every later task implements; it stays in the plan.

**Files read:** `commands/worktree.ts`, `lib/enrich.ts`, `lib/herdr-launch.ts`, `lib/worktree/config.ts`, `lib/worktree-each.ts`, `commands/cd.ts`, `commands/nav.ts`, `commands/code.ts`, `commands/extension.ts`, `lib/pickers.ts`, `lib/pick-wrappers.ts`, `lib/ui/pick.ts`, `lib/ui/pick-fake.ts`, `lib/navigate.ts`, `lib/explain-error.ts`, `lib/repo-arg.ts`, `lib/worktree/hydrate.ts`, `ui/internal/views/picker/picker.go` (`Run`), `skills/rt-worktree/SKILL.md`, and the tests beside each.

#### Already on rt-ui (confirming the scoping document)

| Verb | Scoping call | Confirmed | What 5c touches |
|---|---|---|---|
| `nav` | yes | Yes. The navigator is one `runPick` session, the sort modal and the "open with" picker. | Nothing (Matt, 2026-10-01): `commands/nav.ts` is not edited |
| `cd` | yes on the everyday path | Yes. With the shell helper installed and a live repo, every byte a person sees is a picker. | Nothing (Matt, 2026-10-01): `commands/cd.ts` is not edited. The cold-cache fetch line it reaches through `lib/enrich.ts` becomes a spinner (Task 9) |
| `code` | partly | Yes. The worktree and repo pickers (`lib/pickers.ts`) and the editor and workspace `select` prompts are rt-ui and unchanged. | `rt code`'s opened, failed and no-editor lines; not the opener `rt nav` shares |
| `code extension` | partly | Partly right: the verb is `rt settings extension` (`lib/command-tree-def.ts:1897`), not `rt code extension`. Its editor multiselect is rt-ui and unchanged. | Twelve result lines |
| `worktree` | partly | Yes. Six `filterableSelect` or `filterableMultiselect` calls (`pickOneTree`, `pickRestorableEntry`, `pickRepoName`, `confirmApprove`, the `each` multiselect) are rt-ui. One correction: `pickOneTree` feeds an ANSI-colored string into a picker hint today, built by `formatBranchLabelParts`; Task 7 gives it segment rows from `formatBranchSegments`, the form every other worktree picker already uses, so `lib/enrich.ts` can drop its color import. Same glyphs, same tones. | Every result line, every refusal, the `--json` doors |

#### `rt cd` and `rt nav`: what this slice leaves alone

Ruled by Matt on 2026-10-01: both verbs are already drawn by rt-ui and are not part of 5c. `commands/cd.ts` (25 guard lines) and `commands/nav.ts` (6 guard lines) are not edited, keep their stdout swap and their raw lines, and stay on the allowlist; phase 6 decides whether they become permanent exemptions. Their tests are not edited.

They call into three files this slice does convert, so those files keep every path the two verbs reach exactly as it is today:

| Called from | Function | What stays as today | Task |
|---|---|---|---|
| `rt cd` | `pickFromAllRepos`, `pickPackageWithEscape`, `pickWorktreeWithSwitch`, `resolveWorktreeByBranch` (`lib/pickers.ts`) | Signatures; every refusal printed when `opts.stderr` is set, which only `rt cd` passes (its calls at `commands/cd.ts:277` to `:340`), byte for byte through `console.error` or `process.stderr.write`; `resolveWorktreeByBranch`, whose only caller is `rt cd`, is not edited at all | 3 |
| `rt nav` (ctrl-o) | `openDirectoryInEditor` (`commands/code.ts:393`) | Signature, both lines it prints, its exit code, and what it reaches: the no-editor branch of `ensureEditor` and `savePrefs`'s warning | 10 |
| `rt cd`, cold cache | `enrichBranches` through `pickWorktreeFromRepo` (`lib/repo.ts:353`, not silent) | Everything but the fetch line: Matt ruled the same day that the fetch becomes a transient step for every caller, `rt cd` included. On a cold cache `rt cd` shows a spinner that leaves nothing instead of today's `⟳ Fetching branch info…` line overwritten by `✓ N MRs loaded`. It is the one way `rt cd`'s screen changes, and the PR body names it | 9 |

Pre-existing behavior this slice finds and leaves for Matt (the PR lists each under Follow-up; none is fixed here):

- **`rt cd`'s two-row erase wipes the typed command line.** `commands/cd.ts:236` writes `\x1b[2A\x1b[0J` on exit 0. Its comment says it removes "the 2-line header", the dispatcher breadcrumb, but `rt cd` is `fullscreen: true` so no header is drawn, and every picker on its paths is on the alternate screen and leaves nothing. So on every cached run the erase removes the person's own `rt cd` command line and the row above it. On today's cold run the leftover "loaded" row took one of the two places; after Task 9 a cold run erases the same two rows a cached run does.
- **The comment on `rt cd`'s `fullscreen: true` is stale.** `lib/command-tree-def.ts:1158` says the picker "renders an inline frame, not an alt-screen"; the picker sends no `layout`, which is the alternate screen. `lib/command-tree-def.ts` is 5a's file.
- **Under `rt nav`, `ensureEditor`'s "No supported editor CLI found" lines go to stdout.** They are `console.log` (`commands/code.ts:240` and `:241`), which `nav`'s stdout swap does not catch, so `dir="$(rt nav)"` takes them as the folder. Task 10 keeps them as they are on the `nav` path and converts them only for `rt code`.
- **Three children of `rt nav` inherit fd 1** and can print into `$dir`: the editor ctrl-o launches (`commands/code.ts:342` and `:348`, `launchEditor`), the shell "open terminal here" starts (`commands/nav.ts:377`) and the app "Open with" starts (`commands/nav.ts:202`).

#### Print sites

`commands/code.ts` (9 guard lines). `rt code`'s own lines are converted; everything `rt nav` reaches through `openDirectoryInEditor` keeps its bytes, so the file stays on the allowlist:

| Site | Today | Becomes | Task |
|---|---|---|---|
| line 23 | color import | kept: the lines `rt nav` reaches still use `green`, `red`, `dim`, `reset` | 10 |
| 63 | `console.warn("rt: could not save workspace prefs ...")` in `savePrefs` | kept as today: `openDirectoryInEditor` calls `savePrefs`, so `rt nav` can print it | 10 |
| 240 to 242 | red "No supported editor CLI found", dim "Install one of: ...", on stdout, exit 1 | `ensureEditor` takes the no-editor ending from its caller. `openInEditor` (`rt code`) passes `out.fail({ title: "rt could not find an editor it can open", why: "It looks for the shell command of VS Code, Cursor, Zed, VSCodium, Windsurf, Sublime Text or a JetBrains editor.", next: "Install one of them, or turn on its shell command, then run this again" })`, exit 1. `openDirectoryInEditor` passes today's two `console.log` lines and exit 1, moved unchanged into a function of their own | 10 |
| 404, 406 to 407 | green check "Opened <dir> in <editor>" and the red "Failed to open" line, on stderr (the `rt nav` path) | not edited | 10 |
| 456 | green check "Opened <label> in <editor>" on stdout | `out.print(out.line("done", "Opened <label> in <editor>"))` | 10 |
| 458 to 460 | red "Failed to open <editor>. Is '<cmd>' CLI installed?", dim "Reset your editor preference with: rt settings set ...", on stdout, exit 1 | `out.fail({ title: "<editor> did not open", why: "rt ran <cmd> and it failed, or it is not installed.", next: out.cmd("rt settings set rt.workspacePrefs '{}' --scope machine"), details: "That clears your saved editor, so rt asks again." })`, exit 1 | 10 |

`commands/extension.ts` (13 guard lines):

| Site | Today | Becomes | Task |
|---|---|---|---|
| line 13 | color import | removed | 11 |
| 40 | dim "building extension from source..." | `out.print(out.line("running", "Building the extension from source"))` | 11 |
| 59 to 60 | red cross "rt-context.vsix not found", dim where it was expected; returns (exit 0) | `out.fail({ title: "rt could not find its editor extension", why: "It ships beside the rt program and is missing there." })`; still returns | 11 |
| 64 | dim `vsix: <path>` | removed from the screen; `logCliEvent("debug", "extension", "vsix found", { path })` | 11 |
| 69 to 70 | yellow "no VS Code-compatible editors found", dim "install Cursor, VS Code, ..." | `out.print(out.line("pending", "No editor that takes VS Code extensions was found", "install Cursor, VS Code or a similar editor first"))` | 11 |
| 87 | dim "no editors selected" | `out.print(out.line("skipped", "No editors selected"))` | 11 |
| 91, 98 to 109 | a blank line, then per editor a check or a cross with the error, each printed when that editor's install returns | one step per editor while its install runs (`openStep("Installing in <editor>")`), ending `done("Installed in <editor>")` or `fail("<editor> did not take the extension", <the last non-empty line of its output, or "it did not finish within 30 seconds" when the 30-second limit killed it>)`. Off a terminal, or when the helper cannot start or exits early, the same ending prints as a plain line through `out.print`: `[ok] Installed in <editor>` or `[failed] <editor> did not take the extension  <hint>`. The error is the command's combined output (`2>&1` puts it on the child's stdout; today's `err.stderr` is almost always empty, so it printed "unknown error") | 11 |
| 111 to 112 | green "installed, restart your editor" | when any installed, `out.print(out.summary("done", "RT Context is installed", ["N of M editors"]), out.callout("next", "Restart your editor to turn it on"))` | 11 |

`lib/pickers.ts` (1 guard line, 3 print sites). `rt cd` is the only caller that passes `stderr: true`; `rt code --pick` (`commands/code.ts:431` to `:436`) and the dispatcher's worktree context (`lib/command-tree.ts:443` to `:455`) pass none and today get their refusals on **stdout** through `console.log`. The file stays on the allowlist because the `stderr` path keeps printing raw:

| Site | Today | Becomes | Task |
|---|---|---|---|
| 169 to 174 | "no known repos found" (or `opts.errorMessage`), through `console.error` when `opts.stderr` is set, `console.log` otherwise, exit 1 | with `opts.stderr`: unchanged. Without it: `out.fail({ title: "rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" })` (the copy 5a uses for the same case in `lib/repo.ts`), exit 1. `errorMessage` stays: it is part of the options `rt cd` passes through | 3 |
| 178 to 181 | `missingRepoRefusal(repo)`, same writer, exit 1 | with `opts.stderr`: unchanged. Without it: `out.fail(missingRepoFailure(repo))`, exit 1 | 3 |
| 411 to 415 | `no worktree found matching branch: "<b>"`, exit 1 | not edited: `resolveWorktreeByBranch` has one caller, `rt cd` | 3 |

`lib/worktree/config.ts` (3 guard lines): 5a's warnings table rows 21, 22 and 23, all "Show". Applied in Task 4 with that table's copy.

`lib/herdr-launch.ts` (4 guard lines), all on stderr, kept on stderr with `out.note` because the only caller (`commands/run.ts`) gives its children the terminal:

| Site | Today | Becomes | Task |
|---|---|---|---|
| line 5 | color import | removed | 5 |
| 23 | dim "<reason>, running sequentially" | `out.note(out.line("warn", "Running these one at a time", reason))` | 5 |
| 25 | bold item label | `out.note(out.section(item.label, undefined))` | 5 |
| 32 | red cross "<label> exited N" | `out.note(out.line("failed", "<label> stopped with an error", "exit N"))` | 5 |

`lib/enrich.ts` (5 guard lines):

| Site | Today | Becomes | Task |
|---|---|---|---|
| 36 | color import | removed | 9 |
| 184 to 205 | `MR_STATE_ICONS`, `PIPELINE_ICONS`, `hexToAnsi` | deleted with `formatBranchLabelParts` | 9 |
| 214 to 278 | `BranchLabelParts`, `formatBranchLabelParts`: ANSI strings; the only caller is `commands/worktree.ts:318` | deleted once Task 7 has moved that caller onto `formatBranchSegments` and the `EnrichedBranch` itself | 9 |
| 505 to 508 | on a stderr TTY, cyan "Fetching branch info..." ending in `\r` | `withTransientStep("Fetching branch info", ...)` around the fetch, when not `silent` and a token exists | 9 |
| 595 to 602 | green check "N MRs, M tickets loaded", which stays on screen as one row | removed: a spinner leaves nothing on screen (Matt's ruling 1, and for `rt cd` Matt's answer of 2026-10-01). The callers that show the change: `rt cd` through `pickWorktreeFromRepo` (`lib/repo.ts:353`), `rt code --pick` through `pickRepoInteractive` (`lib/repo.ts:409`), `rt run`'s worktree picker (`commands/run.ts:1036`) and `rt worktree list` and its leaf pickers; the PR body names them | 9 |

`commands/worktree.ts` (91 guard lines, 1 seam line). Shared doors first:

| Site | Today | Becomes | Task |
|---|---|---|---|
| line 18 | color import | removed | 8 |
| `daemonUnavailable` (213) | a red cross line on **stdout**, also under `--json`; exit 1 | `out.fail(...)` on stderr; stdout empty under `--json`; exit 1. Down: title "The rt daemon is not running", why "Worktrees are made and cleaned up by the daemon.", next `rt daemon start`. Timed out: title "This is taking longer than rt waits for", why "The daemon may still be working on it.", next `rt worktree list` | 6 |
| `failText` (219) | `{ error }` JSON, or a red cross line on stdout; exit 1 | JSON through `out.json`, unchanged; human through `out.fail` with the copy in the next table | 6 |
| `failResult` (230) | `{ error }` JSON, or `explainError(code)` on stdout; exit 1 | JSON unchanged; human from `copyForCode(code)` (table below): a refusal is `out.note(out.line("refused", title, hint), next callout)` on stderr, a failure is `out.fail(...)`; exit 1 either way | 6 |
| every `console.log(JSON.stringify(x, null, 2))` (378, 441, 470, 516, 575, 595, 618, 662, 797, 820) | pretty JSON | `out.json(x, 2)`, the same bytes | 6, 7 |
| 738, 743 | compact JSON (`{"teamOwned":false}`, `{"teamOwned":true,"approved":true,"hash":"<hash>"}`) | `out.json(x)`, the same bytes; both pinned from the real verb before conversion (Task 6 Step 1) | 7 |
| "nothing selected" (429, 495, 585, 728, 785, 903) | dim line | `out.print(out.line("skipped", "Nothing selected"))` | 6, 7, 8 |

Human copy for each `failText` call (the first two arguments stay as they are; the third is new):

| Line | Verb | Human failure |
|---|---|---|
| 361, 420, 464, 483, 566, 611, 659, 723, 774, 815 | every `resolveRepoArg` call | by the kind `tryResolveRepoArg` returns (`lib/repo-arg.ts`, already exported). `none`: title "rt does not know a repo called <arg>", next `rt repos status`. `ambiguous`: title "More than one repo is called <arg>", why "Use the full name of the one you mean.", details "It could be <match>, <match>", each match decoded from its serialized identity to `host/path` with `repoLabelFull` (`lib/repo-label.ts`), so a person reads `git.example.com/one/twin`, not `remote:git.example.com%2Fone%2Ftwin` |
| 362 | provision | `usageFailure("Which repo?", "rt worktree provision --repo <name>", "You are not inside a repo rt knows.")` |
| 435 | await-ready | `usageFailure("Which repo?", "rt worktree await-ready <tree> --repo <name>", "You are not inside a repo rt knows.")` |
| 465 | create | `usageFailure("Which repo?", "rt worktree create --repo <name>", "You are not inside a repo rt knows.")` |
| 567 | restore | `usageFailure("Which repo?", "rt worktree restore <tree> --repo <name>", "You are not inside a repo rt knows.")` |
| 424 | await-ready | `usageFailure("Which worktree?", "rt worktree await-ready <tree>")` |
| 487 | dispose | `usageFailure("Which worktree?", "rt worktree dispose <tree>")` |
| 588 | restore | `usageFailure("Which worktree?", "rt worktree restore <tree>")` |
| 571, 732 | restore, ready-approve | title "rt does not know a repo called <label>", next `rt repos status` |
| 726 | ready-approve | `usageFailure("Which repo?", "rt worktree ready-approve <repo>")` |
| 747 | ready-approve | title "rt cannot record an approval for this repo", why "It has no remote or folder rt can name it by." |
| 752 | ready-approve off a terminal | not a failure: rt is waiting on the person. Under `--json` the `failText` call stays as it is; otherwise `out.note(out.line("needs-you", "The team's setup steps for <label> need your approval", "approving needs a terminal, so rt can show you the steps first"), out.callout("next", cmd("rt worktree ready-approve <repo>")), out.callout("note", ["From a script: ", cmd("rt settings set rt.worktreeReadyApproval '\"<hash>\"' --scope user --repo <repo>")]))` on stderr, then exit 1 as today. stderr because the verb exits 1 and a script's stdout must not carry it |
| 814 | adopt | `usageFailure("Which repo?", "rt worktree adopt --repo <name>", "This changes every worktree in the repo, so name it.")` |

`copyForCode` (the error codes the daemon's `worktree:*` handlers return, `lib/daemon/handlers/worktree.ts` and `lib/worktree/restore.ts`; `lib/explain-error.ts` keeps its strings for the MCP tools and stays the fallback for a code not listed). A **refusal** is rt declining by policy and prints as `[refused] <title>  <hint>` with an optional `next` callout, on stderr through `out.note`; a **failure** prints through `out.fail`. Exit 1 and the `--json` `{ error }` value are the same for both.

| Code | Kind, and why | Title | Why (failure) or hint (refusal) | Next or details |
|---|---|---|---|---|
| `busy` | refusal: another operation holds the tree's lock and rt will not work under it | That worktree is busy right now | hint: another rt operation is using it | next: Try again in a moment |
| `repo-unknown` | failure: the input names nothing rt knows | rt does not know that repo | Name a repo rt knows, or run this from inside one. | next: `rt repos status` |
| `branch-unresolved` | failure: input is missing | Which branch? | A new worktree needs a branch, or a ticket to name one after. | next: `rt worktree provision --branch <name>` |
| `no-target` | failure: input is missing | Which worktree? | | next: `rt worktree dispose <tree>` |
| `tree-ambiguous` | failure: the input matches more than one thing | More than one repo has a worktree with that name | | next: Run it again with the repo named |
| `branch-duplicated` | refusal: rt will not hand out a branch two worktrees already hold | That branch is checked out in more than one worktree | hint: rt will not pick one of them for you | next: `rt worktree adopt --repo <name>` |
| `branch-attached:<tree>` | refusal: rt will not check a branch out twice | That branch is already checked out in the <tree> worktree | hint: a branch can only be in one worktree at a time | |
| `checkout-failed:<text>` | failure: git could not do it | The branch could not be checked out | | details: <text> |
| `create-failed:<step>` | failure | The worktree could not be created | It stopped at the <step> step. | next: `rt daemon logs` |
| `claim-write-failed` | failure | rt could not mark the worktree as yours | Writing its record failed, so it was given back. | next: `rt daemon logs` |
| `handoff-write-failed` | failure | rt could not hand the worktree over | Writing its record failed. | next: `rt daemon logs` |
| `tree-required` | failure: input is missing | Which worktree? | | next: `rt worktree await-ready <tree>` |
| `tree-unknown` | failure: nothing by that name | rt has no worktree by that name | | next: `rt worktree list` |
| `not-found` | failure: nothing by that name | No cleaned-up worktree has that name | | next: `rt worktree restore --list` |
| `no-manifest` | failure: rt cannot, not will not | That worktree cannot be brought back | rt kept no record of how it was cleaned up. | |
| `branch-elsewhere` | refusal: rt will not overwrite a branch that exists again | That branch exists again | hint: bringing the worktree back would overwrite it, so rt left both alone | |
| `no-head-sha` | failure: rt cannot | That worktree cannot be brought back | rt has no record of the commit it was on. | |
| `path-exists` | refusal: rt will not overwrite a folder | A worktree with that name already exists | hint: rt will not write over it | next: `rt worktree list` |
| `worktree-add-failed` | failure: git could not do it | The worktree could not be recreated | | next: `rt daemon logs` |
| `copy-failed` | failure | The worktree is back, but its untracked files are not | Copying them back failed. The saved copy is still there. | next: `rt worktree dispose <tree> --force`; details: Then bring it back again. |
| `register-failed` | failure | The worktree is back on disk, but rt lost track of it | | next: `rt worktree adopt --repo <name>` |
| anything else | failure | `explainError(code)` | | |

The `branch-attached` row has no next: the code names the worktree, not the branch, and `rt cd --worktree` takes a branch.

#### Copy table: daemon codes and sentences on screen

Every value below is what the daemon writes and what `--json` keeps; the right-hand column is all a person reads. `disposeReason` (Task 7) and `RESTORE_REASON` (Task 6) in `commands/worktree.ts` hold them, and each row's test is named. A code not in a table falls back to the code itself, which no current path produces.

| # | Daemon value | Where it shows | On screen | Kind | Test |
|---|---|---|---|---|---|
| 1 | `changed` | dispose, adopt, list's `disposable` cell, the leaf pickers | it changed while rt was checking it, try again | refusal | Task 7 `disposeReason covers every dispose code` |
| 2 | `kind-main` | same | it is the repo's main folder | refusal | same |
| 3 | `kind-golden` | same | it is the copy rt builds new worktrees from | refusal | same |
| 4 | `kind-<other>` | same | rt did not make it, so rt does not remove it | refusal | same |
| 5 | `dirty` | same | it has changes that are not committed | refusal | same, and `list names why a disposable tree stayed ...` |
| 6 | `unpushed` | same | it has commits that are not merged or pushed | refusal | same |
| 7 | `running-run` with detail `running run <id> at <stage>; rt runs abandon <id>` (`lib/worktree/dispose.ts:229`) | dispose, adopt | a pipeline run is still working in it (run <id>, at <stage>); next `rt runs abandon <id>`. The id and stage are read from the detail with `/^running run (\S+) at (\S+);/`; a detail that does not match is shown as the hint unchanged | refusal | Task 7 `a running-run refusal names the run and the command to stop it, on stderr` |
| 8 | `runs-unreadable` with a detail sentence that ends "check manually with" and `rt runs` in backticks (`lib/worktree/dispose.ts:232`) | dispose, adopt | rt could not check whether a pipeline run is using it; next `rt runs` | refusal | Task 7 `disposeReason covers every dispose code` |
| 9 | `attended` | dispose, adopt, list, pickers | someone is working on its merge request right now | refusal | same |
| 10 | `grace` | same | it was claimed moments ago | refusal | same |
| 11 | `no-trash` | same | rt could not keep a copy to bring it back from | refusal | same |
| 12 | `busy` | dispose, adopt | another rt operation is using it, try again in a moment | refusal | same |
| 13 | `remove-failed` | dispose, adopt | it could not be moved away, try again | failure (`[failed]` on stderr in dispose; `warn` in adopt, see below) | same |
| 14 | `unknown` | dispose, adopt | rt has no worktree by that name; next `rt worktree list` | failure (`warn` in adopt) | same |
| 15 | `manual` | `restore --list` | cleaned up <date> by you | | Task 6 `restore --list says who cleaned each worktree up, in words` |
| 16 | `auto` | `restore --list` | cleaned up <date> by rt after its merge | | same |
| 17 | `force` | `restore --list` | cleaned up <date> by you, with force | | same |
| 18 | `no-token`, forge `github` | list, triage (banner) | `[warning] Merged worktrees are not cleaned up in <repo>  rt has no GitHub login`; next `rt setup github connect --use-gh` | warn | Task 7 `list says when merged worktrees are not cleaned up ...`, `triage names the same gap the way list does` |
| 19 | `no-token`, forge `gitlab` | list, triage | `... rt has no GitLab login`; next `rt setup gitlab connect` | warn | same |
| 20 | `no-branches-grant`, mode `off` | list, triage | `... rt is not watching this repo`; next `rt repos register <path> --track poll --caches <caches>,branches` | warn | same |
| 21 | `no-branches-grant`, mode set | list, triage | `... rt watches this repo, but not its pull requests`; next `rt repos register <path> --track <mode> --caches <caches>,branches` | warn | same |

Which status each verb uses for rows 1 to 14:

- `dispose`: the person asked rt to remove the tree. A refusal is `out.note(out.line("refused", <tree>, <words>))` on stderr, with the `next` callout when the row has one; rows 13 and 14 are `out.note(out.line("failed", ...))`. Exit 1 when any tree was refused, as today.
- `adopt`: the person asked rt to adopt the repo's trees. Cleaning up parked trees is something rt tried on its own, so a tree a guard declined is `out.line("skipped", "<tree> was left as it is", <words>)` on stdout with the rest of the result: nothing was asked of rt about that tree. Rows 13 and 14 are not a guard declining but a fault, so they are `out.line("warn", "<tree> was left as it is", <words>)`: worth noticing, not coral, since the adopt itself succeeded. No exit code change (adopt sets none today).
- `list` and the leaf pickers: `disposable (<words>)` in the state cell.

The `lib/worktree/dispose.ts` sentences in rows 7 and 8 stay as they are (the daemon log and `--json` carry them); the PR names them under Follow-up as sentences to move to codes plus fields.

Per verb:

| Verb | Today | Becomes | Task |
|---|---|---|---|
| `provision` (381 to 394) | check, bold tree, dim path; "branch X (state, from the on-deck pool, hydrated from the golden)"; warn "team ready steps held"; dim "settling in background"; warn "ready step failed" | `out.line("done", tree, path)`, `out.kv("branch", branch, <where it came from>)`, then as they apply: `out.line("needs-you", "The team's setup steps are waiting for your approval")` + `out.callout("next", out.cmd("rt worktree ready-approve"))`; `out.line("running", "Still setting up in the background", <steps>)` + `out.callout("next", out.cmd("rt worktree await-ready <tree>"))`; `out.line("warn", "The <step> setup step failed", "you can use this worktree, but its dependencies may be out of date")` | 6 |
| `await-ready` (444 to 457) | check "ready (time)"; or warn "not ready ...", exit code 1 | ready: `out.line("done", "<tree> is ready", <time> or "it had no setup steps")`. Not ready, on stdout and worded like provision's and restore's own `warn` for a failed step: `out.line("warn", "The <step> setup step failed in <tree>" or "Setup did not finish in <tree>", STALE_DEPS)`. Not coral: the tree is usable. Exit code 1 as today | 6 |
| `create` (472 to 474) | check, tree, path, "(on-deck)" | `out.line("done", tree, path)`, with hint "<path>, kept as a spare" for `--on-deck` | 6 |
| `restore --list` (541 to 550) | "nothing recoverable", or bold name, cyan branch, dim "disposed D (reason), kept until D" with the raw `manual`, `auto` or `force` | `out.line("skipped", "Nothing to bring back")`, or `out.table` rows `[strong(name), key(branch), dim("cleaned up D <who>"), dim("kept until D")]`, `<who>` from copy table rows 15 to 17 | 6 |
| `restore` (598 to 603) | check "<tree> restored", path; warn "ready step failed" | `out.line("done", "<tree> restored", path)`, and the same `warn` line as provision | 6 |
| `hydrate-clone` (947, 951; hidden; the daemon reads its stderr) | `console.error("usage: ...")`, `console.error("clonefile: <msg>")` | `out.fail({ title: <the same text> })`: off a terminal a leading failure prints its title alone (5a), so the daemon reads the same line | 6 |
| `list` (620 to 652) | held notice; merge cleanup lines; one row per tree with colors | `out.line("needs-you", "The team's setup steps are waiting for your approval", <repos>)` + `out.callout("next", out.cmd("rt worktree ready-approve <repo>"))`; per gap `out.line("warn", "Merged worktrees are not cleaned up in <repo>", <why>)` + `out.callout("next", out.cmd(<command>))`; `out.table` rows `[strong("<repo>/<tree>"), dim(state, with a disposable tree's reason in words from the copy table), key(branch), dim(owner), <merge request cell, its number marked by `changeMarker(repoName)` so GitHub rows read `#41` as triage's do>, <notes>]`, or `out.line("skipped", "No worktrees")` | 7 |
| `triage` (668 to 677) | bold "N worktrees need a decision"; dim banners carrying the raw reason (`no-token`) as `off`; one row per tree | `out.section(<header>, undefined, <each banner through the same mergeCleanupOffBlocks list uses: a warn line and its next callout>, out.table(rows))`: the same fact reads the same in both verbs | 7 |
| `dispose` (518 to 529) | check "<tree> disposed" with "recoverable at <path> until D"; red cross "<tree> (reason: detail)" on stdout; "nothing to dispose" | stdout: `out.line("done", "<tree> cleaned up", "you can bring it back until D")`, or `out.line("skipped", "Nothing to clean up")`. stderr through `out.note`: `out.line("refused", <tree>, <words>)` and its `next` callout for a refusal, `out.line("failed", <tree>, <words>)` for `remove-failed` and `unknown` (copy table rows 1 to 14). Exit 1 when any tree was refused, as today | 7 |
| `ready-approve` (739 to 766) | "no team-authored ready steps"; "already approved <hash>"; the ladder; "not approved"; "approved <hash>" | `out.line("skipped", "<repo> has no team setup steps to approve")`; `out.line("done", "Already approved", hash)`; `out.section("Setup steps the team wrote for <repo>", "hash <hash>", out.verbatim(<one line per step>))`; `out.line("skipped", "Not approved")`; `out.line("done", "Approved", hash)` | 7 |
| `freshen` (800 to 803) | "nothing needed freshening"; check "<tree> freshened" | `out.line("skipped", "Nothing needed freshening")`; `out.line("done", "<tree> freshened")` | 7 |
| `adopt` (829 to 837) | check "adopted main=..., N claimed, N unmanaged, N disposed"; a line per tree; yellow "<tree> not disposed: <raw reason>" | `out.line("done", tree, "now looked after by rt")`, `out.line("skipped", tree, "left alone")`, `out.line("skipped", "<tree> was left as it is", <words from the copy table>)` (or `warn` for `remove-failed` and `unknown`), then `out.summary("done", "Adopted this repo's worktrees", [counts])` | 7 |
| `each` (842 to 940) | red cross refusals on stdout; a bold rule per worktree; "exit N"; a colored summary line | refusals through `out.fail`; `out.section(<tree>, <branch>)` before each child; `out.line("done", "Finished")` or `out.line("failed", "Stopped with an error", "exit N")` after it; `out.summary` from `summarizeEach` | 8 |

`lib/worktree-each.ts`: `formatSummary` (one caller) is replaced by `summarizeEach`; `parseEachArgs` gains `errorKind` beside its `error` text so the command can pick a failure without matching on wording. Task 8.

Every command named in a `next` above exists in `lib/command-tree-def.ts`: `rt worktree ready-approve`, `await-ready`, `list`, `dispose`, `restore`, `adopt`, `provision`, `create`, `each`; `rt daemon start`, `rt daemon logs`; `rt repos status`, `rt repos prune`, `rt repos register`; `rt settings check`, `rt settings set`; `rt setup github connect`, `rt setup gitlab connect`; `rt runs`, `rt runs abandon` (`lib/command-tree-def.ts:1650` and `:451`).

Counts against the scoping document: 157 guard lines and 1 seam line across the nine files it gave 5c. `commands/cd.ts` (25) and `commands/nav.ts` (6) are out; of the remaining 126, every line in `commands/worktree.ts`, `lib/enrich.ts`, `lib/herdr-launch.ts`, `lib/worktree/config.ts` and `commands/extension.ts` is converted, and `commands/code.ts` and `lib/pickers.ts` keep the raw lines on the paths `rt nav` and `rt cd` reach.

#### Tests that pin text or a stream this slice changes

| File | What it pins today | Task |
|---|---|---|
| `lib/__tests__/repo-index-missing.test.ts:150`, `commands/__tests__/cd.test.ts` | `pickFromAllRepos(..., { stderr: true })` and `rt cd`'s refusals through `console.error` spies | none: `rt cd`'s path is unchanged, so they must pass unedited (Task 3 runs them) |
| `lib/worktree/__tests__/config.test.ts:659-686` | a `console.warn` override | 4 |
| `lib/__tests__/herdr-launch.test.ts` | both tests read raw stderr writes | 5 |
| `commands/__tests__/worktree.test.ts` | nine tests override `console.log`. Task 6 rewrites the two for verbs it converts (`await-ready reports unfinished readiness ...`, `an unresolvable --repo ...`); the other six (`JSON output includes readyHeldRepos ...`, `held-repo notice ...`, `a running-run dispose refusal ...`, `list labels the golden row ...`, `list names why a disposable tree stayed ...`, `triage prints one line per row ...`) still read `console.log`, which `list`, `dispose` and `triage` still call until Task 7, so they pass through Task 6 and Task 7 rewrites them | 6, 7 |
| `commands/__tests__/worktree-hydrate-clone.test.ts` | a `console.error` override | 6 |
| `e2e/tests/worktree-hydrate-clone.test.ts` | `usage: rt worktree hydrate-clone <src> <dst>` and `clonefile: ` on stderr | 6 (no edit; must still pass) |
| `lib/__tests__/worktree-each.test.ts` | `formatSummary` | 8 |
| `lib/__tests__/enrich-branch-segments.test.ts` | a header comment naming `formatBranchLabelParts` | 9 |
| `commands/__tests__/code-prefs.test.ts:88` | a `console.warn` spy | none: `savePrefs` is unchanged |
| `commands/__tests__/nav.test.ts` | `rt nav`'s path output and its stub of `openDirectoryInEditor` | none: must pass unedited (Task 10 runs it) |

#### Readers outside the tests

- **The `rt()` shell wrapper** (`SHELL_FUNCTION`, `commands/cd.ts:40`): reads stdout of `rt cd` and `rt nav` as a path. Neither verb is edited, and every path they reach in this slice's files prints as today (Tasks 3 and 10 pin it); the one change, the cold fetch spinner, draws on `/dev/tty`.
- **The worktree skill** (`skills/rt-worktree/SKILL.md:289` to `345`, `378` to `383`): runs `rt worktree restore --list` and `rt worktree restore <tree>` in Bash and reads the result as text ("quote what rt said"). It matches no string. The new text keeps the words it leans on: a listed tree's name, `restored` on success, and a failure or a `[refused]` line on stderr with exit 1. Pinned in Task 6. No skill edit.
- **The daemon** (`lib/worktree/hydrate.ts:27,163`): reads `hydrate-clone`'s exit code and stderr. Unchanged off a terminal; pinned in Task 6.
- **`rt_verb`** (`worktree list`, `triage`, `await-ready` are agent-safe): parses stdout as one JSON value. Pinned by the byte tests in Task 6.
- Searched `plugins/mattstack`, `skills/` and `apps/board/skills` for `disposed`, `freshened`, `nothing recoverable`, `nothing to dispose`, `held pending approval`, `needs a decision`, `not ready`, `settling in background`, `no worktrees`, `Opened`, `shell wrapper`, `Quick Look`: every hit is prose about the daemon's JSON fields or another tool, none reads this slice's human text.

---

### Task 3: `lib/pickers.ts` refuses through the layer, except on `rt cd`'s path

`pickFromAllRepos` refuses in two places. `rt cd` passes `stderr: true` and must print exactly what it prints today; `rt code --pick` and the dispatcher's worktree context pass nothing and today get their refusal on stdout through `console.log`. This task moves only the second kind onto `out.fail`. `resolveWorktreeByBranch` is called only by `rt cd` and is not edited. The file stays on the allowlist, because the `stderr` path still prints raw.

**Files:**
- Modify: `lib/pickers.ts`
- Modify: `lib/__tests__/pickers.test.ts`

**Interfaces:**
- Consumes: `out.fail` (`lib/ui/out.ts`); `missingRepoFailure(r: KnownRepo): FailureInput` (`lib/repo.ts`, 5a); `captureOut()` (`lib/ui/__tests__/capture-out.ts`).
- Produces: every exported function keeps its signature, and `pickFromAllRepos` keeps every option, `errorMessage` included. With `opts.stderr` set, both refusals print as today, byte for byte, through `console.error`. Without it, plain refusals on stderr, exit 1:
  - `rt does not know any repos yet` / `  next: Run rt once from inside a git repo, so it learns where that repo is`
  - the three lines of `missingRepoFailure` (5a).

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/pickers.test.ts`, add to the imports:

```ts
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
```

Append:

```ts
describe("pickFromAllRepos refusals", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    io = captureOut();
    ui.__test__.setHuman(() => false);
    spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
  });
  afterEach(() => io.restore());

  test("without the stderr flag, no known repo is a failure on stderr with the next step", async () => {
    const { pickFromAllRepos } = await import("../pickers.ts");
    await expect(pickFromAllRepos([])).rejects.toThrow("process.exit sentinel");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("rt does not know any repos yet\n  next: Run rt once from inside a git repo, so it learns where that repo is\n");
  });

  test("without the stderr flag, a lost repo is the missing-repo failure", async () => {
    const { pickFromAllRepos } = await import("../pickers.ts");
    await expect(pickFromAllRepos([{ ...repoFixture("moved", "/x/gone"), missing: true }])).rejects.toThrow("process.exit sentinel");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toContain("moved is no longer where rt last saw it");
    expect(io.stderr()).toContain("  next: rt repos locate <new-path> --repo moved");
  });

  test("with the stderr flag rt cd passes, the refusals print as today", async () => {
    const { pickFromAllRepos } = await import("../pickers.ts");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    await expect(pickFromAllRepos([], { stderr: true })).rejects.toThrow("process.exit sentinel");
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [line] = errSpy.mock.calls[0] as [string];
    expect(line).toStartWith("\n  no known repos found ");
    expect(line).toEndWith(" run rt from inside a git repo first\n");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });
});
```

The file's `afterEach` already calls `mock.restore()`, which puts `process.exit` and `console.error` back. The last test is a regression guard: it passes before and after this task, and it pins that `rt cd`'s refusal still goes through `console.error` with today's words (the middle of the string holds a long dash, so the test reads its two ends rather than retyping it). `commands/__tests__/cd.test.ts` and `lib/__tests__/repo-index-missing.test.ts` already pin the missing-repo refusal on that path and are not edited.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/pickers.test.ts`
Expected: the first two FAIL (the text goes to stdout through `console.log`, which the capture does not see, so both captures are empty); the third PASSES.

- [ ] **Step 3: Convert the non-`rt cd` path**

Change the import on line 12 to also name `missingRepoFailure`:

```ts
import { pickWorktreeFromRepo, getWorkspacePackages, repoOptions, repoFromOptionValue, missingRepoRefusal, missingRepoFailure, pickerWorktrees, type KnownRepo } from "./repo.ts";
```

Add under the imports:

```ts
import * as out from "./ui/out.ts";
```

In `pickFromAllRepos`, replace the line `const writer = opts?.stderr ? console.error : console.log;` with:

```ts
  // rt cd passes stderr and is not on the output layer yet: its refusals keep today's bytes.
  const legacyCd = opts?.stderr === true;
```

In the `if (repos.length === 0) { ... }` block, keep the `const msg = ...` line exactly as it is (it holds a long dash) and replace the `writer(...)` line under it with:

```ts
    if (legacyCd) console.error(`\n  ${msg}\n`);
    else out.fail({ title: "rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" });
```

In `refuse`, replace the `writer(...)` line with:

```ts
    if (legacyCd) console.error(`\n  ${missingRepoRefusal(repo)}\n`);
    else out.fail(missingRepoFailure(repo));
```

Nothing else in the file changes: `resolveWorktreeByBranch`, every `stderr` option and every `...(opts?.stderr ? { stderr: true } : {})` spread stay. The allowlist line `lib/pickers.ts` stays.

- [ ] **Step 4: Run the tests and the guards**

Run: `bun test lib/__tests__/pickers.test.ts lib/__tests__/repo-index-missing.test.ts commands/__tests__/cd.test.ts commands/__tests__/code-launch.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, with `cd.test.ts` and `repo-index-missing.test.ts` unedited.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/pickers.ts lib/__tests__/pickers.test.ts
```

```bash
git commit -m "pickers: refusals for rt code and the worktree context are failures on stderr; rt cd's path is unchanged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Worktree config warnings (5a's rows 21 to 23)

**Files:**
- Modify: `lib/worktree/config.ts` (lines 135, 252, 473)
- Modify: `lib/worktree/__tests__/config.test.ts` (the two tests at 659 and 676, plus one new)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/worktree/config.ts"`)

**Interfaces:**
- Consumes: `warn(module: string, message: string, opts?: { context?: Record<string, unknown>; show?: { title: string; hint?: string; next?: CellInput } }): void`, `setWarningLog(log, opts?)`, `__test__.reset()` (`lib/ui/warn.ts`, 5a); `out.cmd` (`lib/ui/out.ts`); `repoLabel(serialized: string): string` (`lib/repo-label.ts`).
- Produces: no signature change. With no log set (the daemon, a unit test): one stderr line `rt: ignoring "<key>" for repo "<repo>" -- <err>` or `rt: ignoring "<key>": <err>`. In the CLI: one `warn` log line, and once per process on stderr:
  - `[warning] A worktree setting for <repo label> is being ignored  <first line of err>` / `  next: rt settings check`
  - `[warning] A worktree app setting is being ignored  <first line of err>` / `  next: rt settings check`

- [ ] **Step 1: Rewrite the two tests and add one**

In `lib/worktree/__tests__/config.test.ts`, add to the imports:

```ts
import * as ui from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../ui/warn.ts";
```

Replace `a refused team value warns once, naming the key and scope but not the value` with:

```ts
    test("a refused team value warns once, naming the key and scope but not the value", () => {
      writeStore(teamSettingsPath("acme"), { "rt.worktreeApp": ["secret-ish"] });
      warnTest.reset();
      const io = captureOut();
      try {
        expect(loadWorktreeAppConfig()).toEqual({ enabled: false, killProcesses: true });
        expect(io.stderr().match(/rt: ignoring/g)).toHaveLength(1);
        expect(io.stderr()).toContain('rt: ignoring "rt.worktreeApp": ');
        expect(io.stderr()).toContain('"rt.worktreeApp" from the team scope');
        expect(io.stderr()).not.toContain("secret-ish");
      } finally {
        io.restore();
      }
    });

    test("in the CLI the person reads a plain warning with the command to run, and the log keeps the detail", () => {
      writeStore(teamSettingsPath("acme"), { "rt.worktreeApp": ["secret-ish"] });
      const logged: Array<[string, string]> = [];
      warnTest.reset();
      setWarningLog((module, message) => {
        logged.push([module, message]);
      });
      const io = captureOut();
      ui.__test__.setHuman(() => false);
      try {
        loadWorktreeAppConfig();
        expect(logged).toHaveLength(1);
        expect(logged[0]![0]).toBe("worktree-config");
        expect(logged[0]![1]).toStartWith('ignoring "rt.worktreeApp": ');
        expect(io.stderr()).toStartWith("[warning] A worktree app setting is being ignored  ");
        expect(io.stderr()).toEndWith("  next: rt settings check\n");
        expect(io.stderr()).not.toContain("secret-ish");
        expect(io.stdout()).toBe("");
      } finally {
        io.restore();
        warnTest.reset();
      }
    });
```

Replace `a refused machine value falls through to the scopes below it` with:

```ts
    test("a refused machine value falls through to the scopes below it", () => {
      writeStore(teamSettingsPath("acme"), { "rt.worktreeApp": { enabled: true } });
      writeStore(machineSettingsPath(), { "rt.worktreeApp": ["nope"] });
      const io = captureOut();
      try {
        expect(loadWorktreeAppConfig()).toEqual({ enabled: true, killProcesses: true });
      } finally {
        io.restore();
      }
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/worktree/__tests__/config.test.ts`
Expected: FAIL. The stderr capture is empty (the text goes through `console.warn`) and `logged` is empty.

- [ ] **Step 3: Convert the three sites**

Add to the imports of `lib/worktree/config.ts`:

```ts
import { repoLabel } from "../repo-label.ts";
import * as out from "../ui/out.ts";
import { warn } from "../ui/warn.ts";
```

Add above `resolveDeclared`:

```ts
// A setting somebody wrote is being skipped: the log gets the resolver's own
// words, the person gets one line and the command that names the fault.
function warnIgnored(key: string, repoName: string | null, err: unknown): void {
  const detail = (err as Error).message;
  const first = detail.split("\n")[0] ?? detail;
  if (repoName === null) {
    warn("worktree-config", `ignoring "${key}": ${detail}`, {
      show: { title: "A worktree app setting is being ignored", hint: first, next: out.cmd("rt settings check") },
    });
    return;
  }
  warn("worktree-config", `ignoring "${key}" for repo "${repoName}" -- ${detail}`, {
    show: { title: `A worktree setting for ${repoLabel(repoName)} is being ignored`, hint: first, next: out.cmd("rt settings check") },
  });
}
```

Replace the `console.warn(...)` line in `resolveDeclared`'s catch and the one in `worktreeSettingsDeclared`'s catch with:

```ts
    warnIgnored(SETTING_KEY, repoName, err);
```

Replace the `console.warn(...)` line in `loadWorktreeAppConfig`'s catch with:

```ts
    warnIgnored(APP_SETTING_KEY, null, err);
```

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "lib/worktree/config.ts"` (it is the last entry; remove the comma from the line that becomes last).

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test lib/worktree/__tests__/config.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/worktree/config.ts lib/worktree/__tests__/config.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "worktree config: an ignored setting is one plain warning, logged in full

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The one-at-a-time fallback in `lib/herdr-launch.ts`

**Files:**
- Modify: `lib/herdr-launch.ts`
- Modify: `lib/__tests__/herdr-launch.test.ts` (whole file)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/herdr-launch.ts"`)

**Interfaces:**
- Consumes: `out.note(...blocks: Block[]): void` (5a: stderr, never follows `payloadOnStdout`), `out.line`, `out.section` (`lib/ui/out.ts`).
- Produces: `launchFallback(items: LaunchItem[], reason: string): void`, `shellQuote`, `LaunchItem` unchanged. Plain strings, on stderr:
  - `[warning] Running these one at a time  <reason>`
  - `<item label>` before each child
  - `[failed] <item label> stopped with an error  exit <code>`

- [ ] **Step 1: Rewrite the test file**

Replace `lib/__tests__/herdr-launch.test.ts` with:

```ts
/**
 * launchFallback (lib/herdr-launch.ts): the real text, not a mock of it.
 * Every launchQueue and launchPreset test elsewhere mocks this function
 * away, so nothing else pins what it writes.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { launchFallback, type LaunchItem } from "../herdr-launch.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
});
afterEach(() => io.restore());

test("names the caller's reason, then one heading per item, all on stderr", () => {
  const items: LaunchItem[] = [
    { label: "web → dev", command: "true", cwd: process.cwd() },
    { label: "api → start", command: "true", cwd: process.cwd() },
  ];
  launchFallback(items, "tmux is not on PATH");

  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[warning] Running these one at a time  tmux is not on PATH\nweb → dev\napi → start\n");
});

test("names a non-zero exit against the item's own label", () => {
  const items: LaunchItem[] = [{ label: "web → dev", command: "exit 7", cwd: process.cwd() }];
  launchFallback(items, "not running in an interactive terminal");

  expect(io.errLines().at(-1)).toBe("[failed] web → dev stopped with an error  exit 7");
});

test("stays on stderr when the verb's stdout is a payload", () => {
  ui.payloadOnStdout();
  launchFallback([{ label: "web → dev", command: "true", cwd: process.cwd() }], "tmux is not on PATH");
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toContain("Running these one at a time");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/__tests__/herdr-launch.test.ts`
Expected: FAIL. stderr holds the old indented, colored lines.

- [ ] **Step 3: Convert the function**

In `lib/herdr-launch.ts`, replace the color import with:

```ts
import * as out from "./ui/out.ts";
```

and replace the body of `launchFallback` (the doc comment above it stays) with:

```ts
export function launchFallback(items: LaunchItem[], reason: string): void {
  out.note(out.line("warn", "Running these one at a time", reason));
  for (const item of items) {
    out.note(out.section(item.label, undefined));
    const result = Bun.spawnSync(["sh", "-c", item.command], {
      cwd: item.cwd,
      env: childEnv(),
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) {
      out.note(out.line("failed", `${item.label} stopped with an error`, `exit ${result.exitCode}`));
    }
  }
}
```

Each `out.note` is its own render, so a heading is the first block of its call and no blank line is printed above it.

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "lib/herdr-launch.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test lib/__tests__/herdr-launch.test.ts commands/__tests__/run-queue-launch.test.ts commands/__tests__/run-preset-launch.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-daemon-sync-exec.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/herdr-launch.ts lib/__tests__/herdr-launch.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "herdr-launch: the one-at-a-time fallback prints through out.note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt worktree`, pass 1: the `--json` doors, the failures, and provision, create, await-ready, restore

**Files:**
- Create: `commands/__tests__/worktree-json.test.ts`
- Modify: `commands/worktree.ts`
- Modify: `commands/__tests__/worktree.test.ts`, `commands/__tests__/worktree-hydrate-clone.test.ts`

`commands/worktree.ts` stays on the allowlist until Task 8: the guard only lets a file leave when nothing raw is left in it.

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.note(...blocks)` (5a: stderr, never follows `payloadOnStdout`), `out.json(value, indent?)`, `out.line`, `out.kv`, `out.callout`, `out.table`, `out.cmd`, `out.strong`, `out.dim`, `out.key`, `FailureInput`, `CellInput` (`lib/ui/out.ts`); `Block`, `Segment` (`lib/ui/protocol.ts`); `usageFailure(title: string, usage: string, why?: string): FailureInput` (`lib/ui/usage.ts`, 5a); `explainError` (`lib/explain-error.ts`); `tryResolveRepoArg` (`lib/repo-arg.ts`); `repoLabelFull(serialized: string): string` (`lib/repo-label.ts`).
- Produces, all private to `commands/worktree.ts` and used by Tasks 7 and 8:
  - `type CodeCopy = out.FailureInput & { refused?: true }`
  - `function copyForCode(error: string): CodeCopy` (also exported through `__test__`)
  - `function refusalBlocks(c: { title: string; hint?: string; next?: out.CellInput }): Block[]`: a `refused` line and, when there is one, its `next` callout
  - `function failText(json: boolean, message: string, human?: out.FailureInput): never`
  - `function failResult(json: boolean, error: string): never`: a refusal through `out.note(...refusalBlocks(c))`, a failure through `out.fail`, exit 1 either way
  - `async function resolveRepo(json: boolean, arg: string): Promise<string>`
  - `function noRepo(usage: string): out.FailureInput`
  - `function nothingSelected(): void`
  - `const STALE_DEPS = "you can use this worktree, but its dependencies may be out of date"`
  - `const RESTORE_REASON: Record<string, string>` (copy table rows 15 to 17)
  - `function restorableEntriesBlock(entries: RestorableEntry[]): Block` (the `restore --list` table)
  - `export const __test__ = { copyForCode, restorableEntriesBlock }`

- [ ] **Step 1: Pin today's `--json` bytes**

Create `commands/__tests__/worktree-json.test.ts`. It passes before the conversion and must pass, unedited, after it:

```ts
/**
 * The --json output of rt worktree, byte for byte. The capture reads both
 * doors (console.log and process.stdout), so the same file pins the bytes
 * before and after the verbs move onto the output layer.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { worktreeAdopt, worktreeAwaitReady, worktreeCreate, worktreeDispose, worktreeFreshen, worktreeList, worktreeProvision, worktreeRestore, worktreeTriage } from "../worktree.ts";
import { getRepoIdentity } from "../../lib/repo.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";

const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realLastQueryTimedOut = realDaemonClient.lastQueryTimedOut;

function fakeDaemon(response: DaemonResponse | null): void {
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async () => response,
    lastQueryTimedOut: () => false,
  }));
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

describe("rt worktree --json bytes", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let repo: string;
  let stdout: string;
  let realLog: typeof console.log;
  let realWrite: typeof process.stdout.write;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-json-home-")));
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-json-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execSync("git init -q -b main", { cwd: repo });
    process.chdir(repo);
    getRepoIdentity();

    stdout = "";
    realLog = console.log;
    realWrite = process.stdout.write;
    console.log = (...args: unknown[]) => {
      stdout += args.map(String).join(" ") + "\n";
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    console.log = realLog;
    process.stdout.write = realWrite;
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: realDaemonQuery,
      lastQueryTimedOut: realLastQueryTimedOut,
    }));
    process.exitCode = 0;
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const CASES: Array<[string, (args: string[]) => Promise<void>, string[], Record<string, unknown>]> = [
    ["provision", (a) => worktreeProvision(a, {}), ["--branch", "feature/one", "--json"], { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "new", readyPending: true, readySteps: ["install"] }],
    ["create", (a) => worktreeCreate(a, {}), ["--json"], { tree: "alpha", path: "/pool/alpha" }],
    ["await-ready", (a) => worktreeAwaitReady(a, {}), ["alpha", "--json"], { tree: "alpha", path: "/pool/alpha", ready: false, readyAt: null }],
    ["dispose", (a) => worktreeDispose(a, {}), ["alpha", "--json"], { disposed: [], refused: [{ tree: "alpha", reason: "dirty" }], recoverable: [] }],
    ["restore", (a) => worktreeRestore(a, {}), ["alpha", "--json"], { restored: true, path: "/pool/alpha", tree: "alpha" }],
    ["triage", (a) => worktreeTriage(a, {}), ["--json"], { rows: [], banners: [], counts: { needsDecision: 0 } }],
    ["freshen", (a) => worktreeFreshen(a, {}), ["alpha", "--json"], { ran: ["alpha"] }],
  ];

  test.each(CASES)("%s prints the daemon's data, indented by two", async (_name, run, args, data) => {
    fakeDaemon({ ok: true, data });
    await run(args);
    expect(stdout).toBe(pretty(data));
  });

  test("adopt prints the daemon's data, indented by two", async () => {
    const data = { main: "main", claimed: ["alpha"], unmanaged: [], disposed: [], refused: [] };
    fakeDaemon({ ok: true, data });
    await worktreeAdopt(["--repo", repo, "--json"], {});
    expect(stdout).toBe(pretty(data));
  });

  test("list prints trees, readyHeldRepos and mergeCleanupOff, in that order", async () => {
    fakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/sample"] } });
    await worktreeList(["--json"], {});
    expect(stdout).toBe(pretty({ trees: [], readyHeldRepos: ["path:/sample"], mergeCleanupOff: [] }));
  });

  test("restore --list prints the entries", async () => {
    fakeDaemon({ ok: true, data: {} });
    await worktreeRestore(["--list", "--json"], {});
    expect(stdout).toBe(pretty({ entries: [] }));
  });

  test("a daemon refusal is one compact error line, exit 1", async () => {
    fakeDaemon({ ok: false, error: "busy" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha", "--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(stdout).toBe('{"error":"busy"}\n');
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a usage refusal is one compact error line, exit 1", async () => {
    fakeDaemon({ ok: true, data: {} });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeAdopt(["--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(stdout).toBe('{"error":"--repo <name> is required for adopt"}\n');
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("rt worktree ready-approve --json bytes", () => {
  // ready-approve reads the repo's own settings, not the daemon, so these run
  // the real verb against a repo with a remote and real settings stores.
  const REMOTE = "git@git.example.com:sample-team/approve-pin.git";
  const IDENTITY = "git.example.com/sample-team/approve-pin";
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let repo: string;
  let wire: string;
  let stdout: string;
  let realLog: typeof console.log;
  let realWrite: typeof process.stdout.write;

  beforeEach(async () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-ready-approve-json-home-")));
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-ready-approve-json-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execSync("git init -q -b main", { cwd: repo });
    execSync(`git remote add origin ${REMOTE}`, { cwd: repo });
    process.chdir(repo);
    getRepoIdentity();
    wire = serializeIdentity(await deriveRepoIdentity(repo));

    stdout = "";
    realLog = console.log;
    realWrite = process.stdout.write;
    console.log = (...args: unknown[]) => {
      stdout += args.map(String).join(" ") + "\n";
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    console.log = realLog;
    process.stdout.write = realWrite;
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  test("a repo with no team setup steps is one compact line", async () => {
    await worktreeReadyApprove([wire, "--json"], {});
    expect(stdout).toBe('{"teamOwned":false}\n');
  });

  test("an approved team ladder is one compact line with its hash", async () => {
    const store = teamSettingsPath("sample-team");
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify({ repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 1, ready: [{ run: "make setup" }] } } } }, null, 2));
    const hash = readyLadderHash((await loadWorktreeRepoConfig(wire, repo)).ready);
    writeReadyApproval(IDENTITY, hash);

    await worktreeReadyApprove([wire, "--json"], {});

    expect(stdout).toBe(`{"teamOwned":true,"approved":true,"hash":"${hash}"}\n`);
  });
});
```

Add to that file's imports: `worktreeReadyApprove` to the `../worktree.ts` import; `mkdirSync` and `writeFileSync` to the `fs` import; `dirname` to the `path` import; and

```ts
import { teamSettingsPath } from "../../lib/rt-paths.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import { loadWorktreeRepoConfig } from "../../lib/worktree/config.ts";
import { readyLadderHash, writeReadyApproval } from "../../lib/worktree/ready-approval.ts";
```

(`lib/worktree/__tests__/ready-held.test.ts` builds the same team store this way.) The expected strings are literal on purpose: `{"teamOwned":false}` and `{"teamOwned":true,"approved":true,"hash":...}` are what `commands/worktree.ts:738` and `:743` write today with `JSON.stringify` and no indent.

- [ ] **Step 2: Run it to verify it passes on today's code**

Run: `bun test commands/__tests__/worktree-json.test.ts`
Expected: PASS. If a case fails here, the fixture is wrong, not the verb: fix the fixture until every case passes against the unconverted file, and only then go on. Commit it alone:

```bash
git add commands/__tests__/worktree-json.test.ts
```

```bash
git commit -m "worktree: pin every --json envelope byte for byte before converting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Write the failing human-output tests**

In `commands/__tests__/worktree.test.ts`:

Add to the imports:

```ts
import { spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { teamSettingsPath } from "../../lib/rt-paths.ts";
import { worktreeCreate, worktreeReadyApprove, worktreeRestore, __test__ as worktreeTest } from "../worktree.ts";
```

(merge `spyOn` into the existing `bun:test` import, `mkdirSync` and `writeFileSync` into the `fs` import, `dirname` into the `path` import, and the four names into the existing `../worktree.ts` import).

Inside `describe("worktree CLI identity plumbing", ...)`, add `let io: ReturnType<typeof captureOut>;`, add as the last lines of its `beforeEach`:

```ts
    io = captureOut();
    ui.__test__.setHuman(() => false);
```

and as the first line of its `afterEach`:

```ts
    io.restore();
```

Replace `await-ready reports unfinished readiness without printing an undefined step name` (its body after `installFakeDaemon(...)`) with:

```ts
    try {
      await worktreeAwaitReady(["alpha"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("[warning] Setup did not finish in alpha  you can use this worktree, but its dependencies may be out of date\n");
    expect(io.stderr()).toBe("");
```

(Not a failure: the tree is usable, so it is a `warn` line on stdout, the way provision and restore word a failed step; the exit code stays 1.)

Replace the body of `an unresolvable --repo exits with a clear message instead of sending a bogus key to the daemon` after `const calls = ...` with:

```ts
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--repo", "no-such-repo-anywhere", "--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(calls.find((c) => c.cmd === "worktree:list")).toBeUndefined();
      expect(JSON.parse(io.stdout()).error).toContain("no-such-repo-anywhere");
      io.clear();
      await expect(worktreeList(["--repo", "no-such-repo-anywhere"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("rt does not know a repo called no-such-repo-anywhere\n  next: rt repos status\n");
    } finally {
      exitSpy.mockRestore();
    }
```

Leave `JSON output includes readyHeldRepos alongside trees` as it is: `list`'s `--json` door still prints through `console.log` until Task 7, which rewrites it.

Add these tests inside the same `describe`:

```ts
  test("provision says what was made, where its branch came from, and what is still running", async () => {
    const repoPath = makeGitRepo("provision-human");
    process.chdir(repoPath);
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "new", wasOnDeck: true, readyPending: true, readySteps: ["install"] },
    });

    await worktreeProvision(["--branch", "feature/one"], {});

    expect(io.stdout()).toBe(
      "[ok] alpha  /pool/alpha\n" +
        "branch: feature/one\n" +
        "  a new branch, on a spare worktree rt had ready\n" +
        "[running] Still setting up in the background  install\n" +
        "  next: rt worktree await-ready alpha\n",
    );
    expect(io.stderr()).toBe("");
  });

  test("provision names held team steps and a failed step without coral", async () => {
    const repoPath = makeGitRepo("provision-held");
    process.chdir(repoPath);
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "behind", readyHeld: true, readyFailed: true, failedStep: "install" },
    });

    await worktreeProvision(["--branch", "feature/one"], {});

    expect(io.lines().slice(2)).toEqual([
      "  a branch you already had, behind its remote",
      "[needs you] The team's setup steps are waiting for your approval",
      "  next: rt worktree ready-approve",
      "[warning] The install setup step failed  you can use this worktree, but its dependencies may be out of date",
    ]);
  });

  test("create names the tree, and says when it was kept as a spare", async () => {
    const repoPath = makeGitRepo("create-human");
    process.chdir(repoPath);
    installFakeDaemon({ ok: true, data: { tree: "beta", path: "/pool/beta" } });

    await worktreeCreate(["--on-deck"], {});

    expect(io.stdout()).toBe("[ok] beta  /pool/beta, kept as a spare\n");
  });

  test("await-ready on a ready tree is one line on stdout", async () => {
    const repoPath = makeGitRepo("await-human");
    process.chdir(repoPath);
    installFakeDaemon({ ok: true, data: { tree: "alpha", path: "p", ready: true, readyAt: null } });

    await worktreeAwaitReady(["alpha"], {});

    expect(io.stdout()).toBe("[ok] alpha is ready  it had no setup steps\n");
  });

  test("restore keeps the word the worktree skill reads, and lists what can come back", async () => {
    const repoPath = makeGitRepo("restore-human");
    process.chdir(repoPath);
    getRepoIdentity();
    installFakeDaemon({ ok: true, data: { restored: true, path: "/pool/alpha", tree: "alpha" } });

    await worktreeRestore(["alpha"], {});
    expect(io.stdout()).toBe("[ok] alpha restored  /pool/alpha\n");

    io.clear();
    await worktreeRestore(["--list"], {});
    expect(io.stdout()).toEndWith("[skipped] Nothing to bring back\n");
  });

  test("--json with the daemon down leaves stdout empty and exits 1", async () => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async () => null,
      lastQueryTimedOut: () => false,
    }));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("The rt daemon is not running\n  why: Worktrees are made and cleaned up by the daemon.\n  next: rt daemon start\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a slow daemon is not called down", async () => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async () => null,
      lastQueryTimedOut: () => true,
    }));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList([], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("This is taking longer than rt waits for\n  why: The daemon may still be working on it.\n  next: rt worktree list\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a repo name that matches two repos says so, and names them", async () => {
    const first = makeGitRepo("twin");
    const second = makeGitRepo("twin");
    const { setKvValue } = await import("../../lib/state/index.ts");
    setKvValue("repo-index", `remote:${encodeURIComponent("git.example.com/one/twin")}`, first);
    setKvValue("repo-index", `remote:${encodeURIComponent("git.example.com/two/twin")}`, second);
    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--repo", "twin"], {})).rejects.toThrow("process.exit sentinel");
      expect(calls.find((c) => c.cmd === "worktree:list")).toBeUndefined();
      const lines = io.errLines();
      expect(lines[0]).toBe("More than one repo is called twin");
      expect(lines[1]).toBe("  why: Use the full name of the one you mean.");
      expect(lines[2]).toStartWith("  It could be ");
      expect(lines[2]).toContain("git.example.com/one/twin");
      expect(lines[2]).toContain("git.example.com/two/twin");
      expect(lines[2]).not.toContain("remote:");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a lock another operation holds is a refusal on stderr, not a failure", async () => {
    installFakeDaemon({ ok: false, error: "busy" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[refused] That worktree is busy right now  another rt operation is using it\n  next: Try again in a moment\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("ready-approve off a terminal says the steps need you, on stderr, exit 1", async () => {
    const repoPath = makeGitRepo("approve-human");
    execSync("git remote add origin git@git.example.com:sample-team/approve-human.git", { cwd: repoPath });
    process.chdir(repoPath);
    getRepoIdentity();
    const store = teamSettingsPath("sample-team");
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify({ repos: { "git.example.com/sample-team/approve-human": { "rt.worktrees": { onDeck: 1, ready: [{ run: "make setup" }] } } } }));
    const wire = serializeIdentity(await deriveRepoIdentity(repoPath));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeReadyApprove([wire], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      const lines = io.errLines();
      expect(lines[0]).toBe("[needs you] The team's setup steps for approve-human need your approval  approving needs a terminal, so rt can show you the steps first");
      expect(lines[1]).toStartWith("  next: rt worktree ready-approve ");
      expect(lines[2]).toStartWith(`  note: From a script: rt settings set rt.worktreeReadyApproval '"`);
      expect(lines).toHaveLength(3);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a failed checkout is a failure, with git's words under it", async () => {
    installFakeDaemon({ ok: false, error: "checkout-failed:pathspec did not match" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("The branch could not be checked out\n  pathspec did not match\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a missing tree name asks for it, with the command as the next step", async () => {
    installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeDispose([], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stderr()).toBe("Which worktree?\n  next: rt worktree dispose <tree>\n");
    } finally {
      exitSpy.mockRestore();
    }
  });
```

Add a new `describe` at the end of the file:

```ts
describe("copyForCode", () => {
  test("a known daemon code becomes a plain title, a why and a next", () => {
    expect(worktreeTest.copyForCode("not-found")).toEqual({
      title: "No cleaned-up worktree has that name",
      next: { text: "rt worktree restore --list", role: "command" },
    });
    expect(worktreeTest.copyForCode("tree-unknown")).toEqual({
      title: "rt has no worktree by that name",
      next: { text: "rt worktree list", role: "command" },
    });
  });

  test("rt declining by policy is a refusal with a hint, never a failure", () => {
    expect(worktreeTest.copyForCode("busy")).toEqual({
      refused: true,
      title: "That worktree is busy right now",
      hint: "another rt operation is using it",
      next: "Try again in a moment",
    });
    for (const code of ["busy", "branch-duplicated", "branch-attached:alpha", "branch-elsewhere", "path-exists"]) {
      expect(worktreeTest.copyForCode(code).refused).toBe(true);
    }
    for (const code of ["repo-unknown", "checkout-failed:x", "create-failed:install", "not-found", "no-manifest", "no-head-sha", "worktree-add-failed", "copy-failed", "register-failed", "claim-write-failed", "something-new"]) {
      expect(worktreeTest.copyForCode(code).refused).toBeUndefined();
    }
  });

  test("a code that carries a value puts the value in the sentence", () => {
    expect(worktreeTest.copyForCode("branch-attached:alpha").title).toBe("That branch is already checked out in the alpha worktree");
    expect(worktreeTest.copyForCode("create-failed:install").why).toBe("It stopped at the install step.");
    expect(worktreeTest.copyForCode("checkout-failed:pathspec did not match")).toEqual({ title: "The branch could not be checked out", details: "pathspec did not match" });
  });

  test("an unknown code falls back to the daemon's own words", () => {
    expect(worktreeTest.copyForCode("something-new")).toEqual({ title: "something-new" });
  });
});

describe("restore --list", () => {
  let io: ReturnType<typeof captureOut>;
  beforeEach(() => {
    io = captureOut();
    ui.__test__.setHuman(() => false);
  });
  afterEach(() => io.restore());

  test("restore --list says who cleaned each worktree up, in words", () => {
    ui.print(
      worktreeTest.restorableEntriesBlock([
        { name: "alpha", path: "/t/alpha", branch: "feature/one", reason: "manual", disposedAt: "2026-09-30T10:00:00.000Z", keptUntil: "2026-10-07T10:00:00.000Z" },
        { name: "beta", path: "/t/beta", branch: null, reason: "auto", disposedAt: "2026-09-29T10:00:00.000Z", keptUntil: "2026-10-06T10:00:00.000Z" },
        { name: "gamma", path: "/t/gamma", branch: "fix/two", reason: "force", disposedAt: "2026-09-28T10:00:00.000Z", keptUntil: "2026-10-05T10:00:00.000Z" },
      ]),
    );
    expect(io.lines().map((l) => l.split(/ {2,}/))).toEqual([
      ["alpha", "feature/one", "cleaned up 2026-09-30 by you", "kept until 2026-10-07"],
      ["beta", "(detached)", "cleaned up 2026-09-29 by rt after its merge", "kept until 2026-10-06"],
      ["gamma", "fix/two", "cleaned up 2026-09-28 by you, with force", "kept until 2026-10-05"],
    ]);
  });
});
```

Replace `commands/__tests__/worktree-hydrate-clone.test.ts`'s capture. Its top becomes:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { worktreeHydrateClone } from "../worktree.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const realExit = process.exit;
let exitCode: number | undefined;
let io: ReturnType<typeof captureOut> | undefined;

function arm() {
  exitCode = undefined;
  io?.restore();
  io = captureOut();
  ui.__test__.setHuman(() => false);
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("__exit__"); }) as never;
}
afterEach(() => { process.exit = realExit; io?.restore(); io = undefined; });
```

and its last test's final line becomes:

```ts
    expect(io!.stderr()).toMatch(/^clonefile: /);
    expect(io!.stdout()).toBe("");
```

Add to its first test, after the three `expect(await run(...))` lines:

```ts
    expect(io!.stderr()).toBe("usage: rt worktree hydrate-clone <src> <dst>\n");
```

- [ ] **Step 4: Run them to verify they fail**

Run: `bun test commands/__tests__/worktree.test.ts commands/__tests__/worktree-hydrate-clone.test.ts`
Expected: FAIL. `worktreeTest` is undefined; the captures hold nothing because the verbs still print through `console`.

- [ ] **Step 5: Add the shared helpers to `commands/worktree.ts`**

Add under the existing imports (the color import on line 18 stays until Task 8; drop names from it as they fall out of use):

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { RestorableEntry } from "../lib/worktree/restore.ts";
```

and add `repoLabelFull` to the names imported from `../lib/repo-label.ts` on line 23 (beside `changeMarker`). The `restore.ts` import is type-only, so the module is still loaded lazily by `fetchRestorableEntries`.

Delete the two constants `DAEMON_DOWN_MESSAGE` and `DAEMON_TIMEOUT_MESSAGE`.

Replace `daemonUnavailable`, `failText` and `failResult` (the doc comment above `daemonUnavailable` and the `export { explainError };` between them stay) with:

```ts
function daemonUnavailable(): never {
  out.fail(
    lastQueryTimedOut()
      ? { title: "This is taking longer than rt waits for", why: "The daemon may still be working on it.", next: out.cmd("rt worktree list") }
      : { title: "The rt daemon is not running", why: "Worktrees are made and cleaned up by the daemon.", next: out.cmd("rt daemon start") },
  );
  process.exit(1);
}

/** `message` is the --json error value and never changes; `human` is what a person reads instead. */
function failText(json: boolean, message: string, human: out.FailureInput = { title: message }): never {
  if (json) out.json({ error: message });
  else out.fail(human);
  process.exit(1);
}

/** A refusal is rt declining by policy: it prints as `refused` on stderr, never as a coral failure. */
type CodeCopy = out.FailureInput & { refused?: true };

function copyForCode(error: string): CodeCopy {
  if (error === "busy") return { refused: true, title: "That worktree is busy right now", hint: "another rt operation is using it", next: "Try again in a moment" };
  if (error === "repo-unknown") return { title: "rt does not know that repo", why: "Name a repo rt knows, or run this from inside one.", next: out.cmd("rt repos status") };
  if (error === "branch-unresolved") return usageFailure("Which branch?", "rt worktree provision --branch <name>", "A new worktree needs a branch, or a ticket to name one after.");
  if (error === "no-target") return usageFailure("Which worktree?", "rt worktree dispose <tree>");
  if (error === "tree-required") return usageFailure("Which worktree?", "rt worktree await-ready <tree>");
  if (error === "tree-unknown") return { title: "rt has no worktree by that name", next: out.cmd("rt worktree list") };
  if (error === "tree-ambiguous") return { title: "More than one repo has a worktree with that name", next: "Run it again with the repo named" };
  if (error === "branch-duplicated") {
    return { refused: true, title: "That branch is checked out in more than one worktree", hint: "rt will not pick one of them for you", next: out.cmd("rt worktree adopt --repo <name>") };
  }
  if (error.startsWith("branch-attached:")) {
    return { refused: true, title: `That branch is already checked out in the ${error.slice("branch-attached:".length)} worktree`, hint: "a branch can only be in one worktree at a time" };
  }
  if (error.startsWith("checkout-failed:")) return { title: "The branch could not be checked out", details: error.slice("checkout-failed:".length) };
  if (error.startsWith("create-failed:")) return { title: "The worktree could not be created", why: `It stopped at the ${error.slice("create-failed:".length)} step.`, next: out.cmd("rt daemon logs") };
  if (error === "claim-write-failed") return { title: "rt could not mark the worktree as yours", why: "Writing its record failed, so it was given back.", next: out.cmd("rt daemon logs") };
  if (error === "handoff-write-failed") return { title: "rt could not hand the worktree over", why: "Writing its record failed.", next: out.cmd("rt daemon logs") };
  if (error === "not-found") return { title: "No cleaned-up worktree has that name", next: out.cmd("rt worktree restore --list") };
  if (error === "no-manifest") return { title: "That worktree cannot be brought back", why: "rt kept no record of how it was cleaned up." };
  if (error === "branch-elsewhere") {
    return { refused: true, title: "That branch exists again", hint: "bringing the worktree back would overwrite it, so rt left both alone" };
  }
  if (error === "no-head-sha") return { title: "That worktree cannot be brought back", why: "rt has no record of the commit it was on." };
  if (error === "path-exists") return { refused: true, title: "A worktree with that name already exists", hint: "rt will not write over it", next: out.cmd("rt worktree list") };
  if (error === "worktree-add-failed") return { title: "The worktree could not be recreated", next: out.cmd("rt daemon logs") };
  if (error === "copy-failed") {
    return {
      title: "The worktree is back, but its untracked files are not",
      why: "Copying them back failed. The saved copy is still there.",
      next: out.cmd("rt worktree dispose <tree> --force"),
      details: "Then bring it back again.",
    };
  }
  if (error === "register-failed") return { title: "The worktree is back on disk, but rt lost track of it", next: out.cmd("rt worktree adopt --repo <name>") };
  return { title: explainError(error) };
}

function refusalBlocks(c: { title: string; hint?: string; next?: out.CellInput }): Block[] {
  return [out.line("refused", c.title, c.hint), ...(c.next ? [out.callout("next", c.next)] : [])];
}

function failResult(json: boolean, error: string): never {
  if (json) out.json({ error });
  else {
    const { refused, ...copy } = copyForCode(error);
    if (refused) out.note(...refusalBlocks(copy));
    else out.fail(copy);
  }
  process.exit(1);
}

/**
 * --repo to an identity. Under --json the refusal is resolveRepoArg's own
 * message, unchanged; a person gets a failure worded from the kind of miss.
 */
async function resolveRepo(json: boolean, arg: string): Promise<string> {
  if (json) return resolveRepoArg(arg, (message) => failText(true, message));
  const resolution = await tryResolveRepoArg(arg);
  if (resolution.kind === "resolved") return resolution.identity;
  out.fail(
    resolution.kind === "ambiguous"
      ? { title: `More than one repo is called ${arg}`, why: "Use the full name of the one you mean.", details: `It could be ${resolution.matches.map(repoLabelFull).join(", ")}` }
      : { title: `rt does not know a repo called ${arg}`, next: out.cmd("rt repos status") },
  );
  process.exit(1);
}

function noRepo(usage: string): out.FailureInput {
  return usageFailure("Which repo?", usage, "You are not inside a repo rt knows.");
}

function nothingSelected(): void {
  out.print(out.line("skipped", "Nothing selected"));
}

const STALE_DEPS = "you can use this worktree, but its dependencies may be out of date";

export const __test__ = { copyForCode, restorableEntriesBlock };
```

(`restorableEntriesBlock` is a function declaration added in Step 7; the module-level `__test__` can name it because declarations are hoisted.)

- [ ] **Step 6: Repoint every `failText` and `resolveRepoArg` call in the file**

All of these are in this task, because `failText`'s human default would otherwise print today's flag-heavy text. In each, the existing arguments stay exactly as they are (several hold a long dash and are `--json` values); only what is listed is added or replaced.

Add `tryResolveRepoArg` to the names imported from `../lib/repo-arg.ts` on line 22 (it is already exported there and returns `{ kind: "resolved"; identity } | { kind: "ambiguous"; matches } | { kind: "none" }`). Every `resolveRepoArg(X, (m) => failText(J, m))` becomes `resolveRepo(J, X)`, at lines 361, 420, 464, 483, 566, 611, 659, 774 (`X` is `parsed.repoName`, `J` is `parsed.json`), 723 (`X` is `positional[0]`, `J` is `json`) and 815 (`X` is `parsed.repoName`, `J` is `parsed.json`).

Add a third argument to these `failText` calls:

| Line | Third argument |
|---|---|
| 362 | `noRepo("rt worktree provision --repo <name>")` |
| 424 | `usageFailure("Which worktree?", "rt worktree await-ready <tree>")` |
| 435 | `noRepo("rt worktree await-ready <tree> --repo <name>")` |
| 465 | `noRepo("rt worktree create --repo <name>")` |
| 487 | `usageFailure("Which worktree?", "rt worktree dispose <tree>")` |
| 567 | `noRepo("rt worktree restore <tree> --repo <name>")` |
| 571 | ``{ title: `rt does not know a repo called ${repoLabel(repoName)}`, next: out.cmd("rt repos status") }`` |
| 588 | `usageFailure("Which worktree?", "rt worktree restore <tree>")` |
| 726 | `usageFailure("Which repo?", "rt worktree ready-approve <repo>")` |
| 732 | ``{ title: `rt does not know a repo called ${repoLabel(repoName)}`, next: out.cmd("rt repos status") }`` |
| 747 | `{ title: "rt cannot record an approval for this repo", why: "It has no remote or folder rt can name it by." }` |
| 814 | `usageFailure("Which repo?", "rt worktree adopt --repo <name>", "This changes every worktree in the repo, so name it.")` |

Line 752 (the multi-line `failText` call inside `if (!interactive) { ... }`) is not a failure: rt is waiting on the person to approve. Keep that `failText(json, ...)` call exactly as it is, literal included, and put this block above it, inside the same `if`:

```ts
    if (!json) {
      out.note(
        out.line("needs-you", `The team's setup steps for ${repoLabel(repoName)} need your approval`, "approving needs a terminal, so rt can show you the steps first"),
        out.callout("next", out.cmd(`rt worktree ready-approve ${shellQuote(repoName)}`)),
        out.callout("note", ["From a script: ", out.cmd(`rt settings set rt.worktreeReadyApproval '"${info.hash}"' --scope user --repo ${shellQuote(repoName)}`)]),
      );
      process.exit(1);
    }
```

so the `failText` call below it only ever runs with `json` true and prints today's `{ error }` envelope. stderr, because the verb exits 1 and a script reading stdout must not get the note. Plain strings:

```
[needs you] The team's setup steps for <label> need your approval  approving needs a terminal, so rt can show you the steps first
  next: rt worktree ready-approve <repo>
  note: From a script: rt settings set rt.worktreeReadyApproval '"<hash>"' --scope user --repo <repo>
```

- [ ] **Step 7: Convert provision, await-ready, create, restore and hydrate-clone**

Add above `worktreeProvision`:

```ts
const BRANCH_STATE: Record<string, string> = {
  new: "a new branch",
  "existing-clean": "a branch you already had",
  behind: "a branch you already had, behind its remote",
  diverged: "a branch you already had, which has moved apart from its remote",
  "tracking-remote": "a branch from the remote",
};

function provisionBlocks(d: Record<string, any>): Block[] {
  const origin = [
    BRANCH_STATE[d.branchState] ?? String(d.branchState),
    ...(d.wasOnDeck ? ["on a spare worktree rt had ready"] : []),
    ...(d.hydratedFrom ? ["set up from a ready-made copy"] : []),
  ].join(", ");
  const blocks: Block[] = [out.line("done", d.tree, d.path), out.kv("branch", d.branch, origin)];
  if (d.readyHeld) {
    blocks.push(out.line("needs-you", "The team's setup steps are waiting for your approval"), out.callout("next", out.cmd("rt worktree ready-approve")));
  }
  if (d.readyPending) {
    const steps = ((d.readySteps ?? []) as string[]).join(", ");
    blocks.push(out.line("running", "Still setting up in the background", steps || undefined), out.callout("next", out.cmd(`rt worktree await-ready ${d.tree}`)));
  }
  if (d.readyFailed) blocks.push(out.line("warn", `The ${d.failedStep} setup step failed`, STALE_DEPS));
  return blocks;
}
```

In `worktreeProvision`, replace everything from `if (parsed.json) { console.log(...); return; }` to the last `console.log("");` with:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  out.print(...provisionBlocks(ok.data));
```

(the `await maybeOfferClaudeHook(parsed.json);` line after it stays).

In `worktreeAwaitReady`: the picker cancel line becomes `if (!picked) { nothingSelected(); return; }`, and everything from `if (parsed.json) { ... }` to the end of the function becomes:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data;
  if (d.ready) {
    out.print(out.line("done", `${d.tree} is ready`, d.readyAt ?? "it had no setup steps"));
    return;
  }
  process.exitCode = 1;
  // Not ready with no failed step means the steps never got to run (the
  // settle could not take the tree lock), not that one ran and failed.
  out.print(out.line("warn", d.failedStep ? `The ${d.failedStep} setup step failed in ${d.tree}` : `Setup did not finish in ${d.tree}`, STALE_DEPS));
}
```

In `worktreeCreate`, the `--json` line and the three `console.log` lines become:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  out.print(out.line("done", ok.data.tree, parsed.onDeck ? `${ok.data.path}, kept as a spare` : ok.data.path));
```

Replace `printRestorableEntries` with:

```ts
const RESTORE_REASON: Record<string, string> = {
  manual: "by you",
  auto: "by rt after its merge",
  force: "by you, with force",
};

function restorableEntriesBlock(entries: RestorableEntry[]): Block {
  return out.table(
    entries.map((e) => [
      out.strong(e.name),
      out.key(e.branch ?? "(detached)"),
      out.dim(`cleaned up ${e.disposedAt.slice(0, 10)} ${RESTORE_REASON[e.reason] ?? `(${e.reason})`}`),
      out.dim(`kept until ${e.keptUntil.slice(0, 10)}`),
    ]),
  );
}

function printRestorableEntries(entries: RestorableEntry[]): void {
  if (entries.length === 0) { out.print(out.line("skipped", "Nothing to bring back")); return; }
  out.print(restorableEntriesBlock(entries));
}
```

In `pickRestorableEntry`, the option's `hint` carries the same raw reason; change only its text, so the picker row reads like the table (the picker itself is untouched, ruling 11):

```ts
    hint: `${e.branch ?? "(detached)"}  cleaned up ${e.disposedAt.slice(0, 10)} ${RESTORE_REASON[e.reason] ?? `(${e.reason})`}, kept until ${e.keptUntil.slice(0, 10)}`,
```

Change the parameter types of `pickRestorableEntry` to `RestorableEntry[]` as well.

In `worktreeRestore`: `if (parsed.json) { console.log(JSON.stringify({ entries }, null, 2)); return; }` becomes `if (parsed.json) { out.json({ entries }, 2); return; }`; the picker cancel becomes `if (!picked) { nothingSelected(); return; }`; and everything from the second `if (parsed.json) { ... }` to the last `console.log("");` becomes:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data as { restored: boolean; path: string; tree: string; readyFailed?: boolean; failedStep?: string };
  out.print(
    out.line("done", `${d.tree} restored`, d.path),
    ...(d.readyFailed ? [out.line("warn", `The ${d.failedStep} setup step failed`, STALE_DEPS)] : []),
  );
```

In `worktreeHydrateClone`, the two `console.error` calls become:

```ts
    out.fail({ title: "usage: rt worktree hydrate-clone <src> <dst>" });
```

```ts
  if (!r.ok) out.fail({ title: `clonefile: ${r.message}` });
```

Add this comment above the function's first line, replacing nothing:

```ts
// The daemon reads this verb's stderr. Off a terminal a failure that opens the
// output prints its title alone, so each line reaches the daemon as written here.
```

- [ ] **Step 8: Run the tests**

Run: `bun test commands/__tests__/worktree-json.test.ts commands/__tests__/worktree.test.ts commands/__tests__/worktree-hydrate-clone.test.ts lib/__tests__/worktree-cli-args.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, every test in all five files. Six tests in `worktree.test.ts` still override `console.log`: `JSON output includes readyHeldRepos alongside trees`, `held-repo notice prints even when there are no worktrees`, `a running-run dispose refusal prints the run id and abandon pointer`, `list labels the golden row by kind, not its on-deck state`, `list names why a disposable tree stayed and why a merged claim is held` and `triage prints one line per row with its group and verdict, and --json passes the payload through`. They pass here because `list`, `dispose` and `triage` still print through `console.log` (the `captureOut()` in `beforeEach` does not see `console.log`, and the test's own override does); Task 7 converts those verbs and rewrites the six. If any of them fails here, this task converted more than it should have: find the `console.log` it removed from `list`, `dispose` or `triage` and put it back.

Run: `bun test e2e/tests/worktree-hydrate-clone.test.ts --preload ./e2e/setup.ts`
Expected: PASS, unedited.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add commands/worktree.ts commands/__tests__/worktree.test.ts commands/__tests__/worktree-hydrate-clone.test.ts
```

```bash
git commit -m "worktree: failures on stderr with a next step; provision, create, await-ready and restore on the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `rt worktree`, pass 2: list, triage, dispose, ready-approve, freshen, adopt

**Files:**
- Modify: `commands/worktree.ts`
- Modify: `commands/__tests__/worktree.test.ts`

**Interfaces:**
- Consumes: Task 6's helpers (`failText`, `nothingSelected`, `refusalBlocks`, `STALE_DEPS`, `out`, `Block`); `out.note` (5a); `changeMarker` (`lib/repo-label.ts`, already imported); `enrichBranches(branches, remoteUrl?, options?)`, `formatBranchSegments(eb): { left: PickSegment[]; right: PickSegment[]; match: string }`, `type EnrichedBranch` (`lib/enrich.ts`); `filterableSelect(opts, extras: { rows?: PickRow[] })` (`lib/pick-wrappers.ts`); `PickRow`, `PickSegment`, `Segment` (`lib/ui/protocol.ts`).
- Produces: `enrichByPath(rows: TreeRow[]): Promise<Map<string, EnrichedBranch>>` in place of `enrichTrailingByPath`; `function disposeReason(reason: string, detail?: string): { words: string; next?: out.CellInput; failed?: true }` (copy table rows 1 to 14); `__test__` gains `readyStepsBlock` and `disposeReason`. After this task nothing in the file calls `formatBranchLabelParts`, which lets Task 9 delete it.

- [ ] **Step 1: Rewrite the six tests and add six**

In `commands/__tests__/worktree.test.ts`, inside `describe("worktree CLI identity plumbing", ...)`:

Replace the body of `JSON output includes readyHeldRepos alongside trees` after `installFakeDaemon(...)` with:

```ts
    await worktreeList(["--json"], {});
    expect(JSON.parse(io.stdout()).readyHeldRepos).toEqual(["path:/foo"]);
```

Replace the body of `held-repo notice prints even when there are no worktrees` after `installFakeDaemon(...)` with:

```ts
    await worktreeList([], {});

    const lines = io.lines();
    expect(lines[0]).toStartWith("[needs you] The team's setup steps are waiting for your approval  ");
    expect(lines.slice(1)).toEqual(["  next: rt worktree ready-approve <repo>", "[skipped] No worktrees"]);
```

Rename `a running-run dispose refusal prints the run id and abandon pointer` to `a running-run refusal names the run and the command to stop it, on stderr`, keep its fixture, and replace its body after `installFakeDaemon({...})` with:

```ts
    try {
      await worktreeDispose(["tree-a"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      // Bun's process.exitCode setter ignores undefined; only 0 clears it.
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[refused] tree-a  a pipeline run is still working in it (run run-1, at implement)\n  next: rt runs abandon run-1\n");
```

Replace the body of `list labels the golden row by kind, not its on-deck state` after `installFakeDaemon({...})` with:

```ts
    await worktreeList([], {});

    expect(io.stdout()).toBe("github.com/acme/app/golden  golden  (detached)\n");
```

Rename that test to `a row with nothing after its branch ends at the branch` and keep its fixture. (Its `repoName` is not a serialized identity, so `repoLabel` passes it through whole; that is today's behavior and the row shows it.)

Replace the body of `list names why a disposable tree stayed and why a merged claim is held` after `installFakeDaemon({...})` with:

```ts
    await worktreeList([], {});

    const rows = io.lines();
    expect(rows.find((l) => l.includes("/beacon "))).toContain("disposable (it has changes that are not committed)");
    expect(rows.find((l) => l.includes("/smaug "))).toContain("!361 merged");
    expect(rows.find((l) => l.includes("/smaug "))).toContain("held: pid 75703 (xctest) has its cwd inside");
    expect(rows.find((l) => l.includes("/gollum "))).not.toContain("held:");
    expect(rows.every((l) => l === l.trimEnd())).toBe(true);
```

Replace the body of `triage prints one line per row with its group and verdict, and --json passes the payload through` after `installFakeDaemon({ ok: true, data });` with:

```ts
    await worktreeTriage([], {});
    expect(io.lines()).toEqual([
      "1 worktree needs a decision",
      "app/olive  safe  #47 merged  Every commit is in main. Only generated files are left.",
      "kit/rowan  safe  !12 merged  Every commit is in main. Only generated files are left.",
    ]);

    io.clear();
    await worktreeTriage(["--json"], {});
    expect(JSON.parse(io.stdout()).counts.needsDecision).toBe(1);
```

Add:

```ts
  test("a hostile branch name is printed without its hidden character", async () => {
    const hostile = "main" + String.fromCodePoint(0x202e) + "gnp.exe";
    installFakeDaemon({
      ok: true,
      data: { trees: [{ name: "alpha", path: "/nonexistent/alpha", kind: "ephemeral", state: "claimed", branch: hostile, repoName: "github.com/acme/app" }] },
    });

    await worktreeList([], {});

    expect(io.stdout()).not.toContain(String.fromCodePoint(0x202e));
    expect(io.stdout()).toContain("maingnp.exe");
  });

  test("list says when merged worktrees are not cleaned up, with the command that fixes it", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [],
        mergeCleanupOff: [{ repo: `remote:${encodeURIComponent("github.com/acme/app")}`, path: "/code/app", reason: "no-token", forge: "github" }],
      },
    });

    await worktreeList([], {});

    expect(io.lines()).toEqual([
      "[warning] Merged worktrees are not cleaned up in app  rt has no GitHub login",
      "  next: rt setup github connect --use-gh",
      "[skipped] No worktrees",
    ]);
  });

  test("triage names the same gap the way list does", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        rows: [],
        banners: [{ repo: `remote:${encodeURIComponent("gitlab.example.com/acme/kit")}`, path: "/code/kit", reason: "no-token", forge: "gitlab" }],
        counts: { needsDecision: 0 },
      },
    });

    await worktreeTriage([], {});

    expect(io.lines()).toEqual([
      "0 worktrees need a decision",
      "[warning] Merged worktrees are not cleaned up in kit  rt has no GitLab login",
      "  next: rt setup gitlab connect",
    ]);
    expect(io.stdout()).not.toContain("no-token");
  });

  test("a GitHub row marks its pull request with #, as triage does", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "olive", path: "/nonexistent/olive", kind: "ephemeral", state: "claimed", branch: "sync-button", repoName: `remote:${encodeURIComponent("github.com/acme/app")}`, mr: { iid: 47, state: "merged", title: "t" } },
        ],
      },
    });

    await worktreeList([], {});

    expect(io.stdout()).toContain("#47 merged");
    expect(io.stdout()).not.toContain("!47");
  });

  test("dispose says how long a cleaned-up tree can be brought back, and when there was nothing to do", async () => {
    installFakeDaemon({
      ok: true,
      data: { disposed: ["tree-a"], refused: [], recoverable: [{ tree: "tree-a", path: "/trash/tree-a", until: "2026-10-08T00:00:00.000Z" }] },
    });
    await worktreeDispose(["tree-a"], {});
    expect(io.stdout()).toBe("[ok] tree-a cleaned up  you can bring it back until 2026-10-08\n");

    io.clear();
    installFakeDaemon({ ok: true, data: { disposed: [], refused: [] } });
    await worktreeDispose(["tree-a"], {});
    expect(io.stdout()).toBe("[skipped] Nothing to clean up\n");
  });

  test("freshen and adopt report each tree and a count", async () => {
    installFakeDaemon({ ok: true, data: { ran: ["lupin"] } });
    await worktreeFreshen(["lupin"], {});
    expect(io.stdout()).toBe("[ok] lupin freshened\n");

    io.clear();
    const repoPath = makeGitRepo("adopt-human");
    installFakeDaemon({ ok: true, data: { main: "main", claimed: ["alpha"], unmanaged: ["beta"], disposed: [], refused: [{ tree: "gamma", reason: "dirty" }, { tree: "delta", reason: "remove-failed" }] } });
    await worktreeAdopt(["--repo", repoPath], {});
    expect(io.lines()).toEqual([
      "[ok] alpha  now looked after by rt",
      "[skipped] beta  left alone",
      "[skipped] gamma was left as it is  it has changes that are not committed",
      "[warning] delta was left as it is  it could not be moved away, try again",
      "",
      "[ok] Adopted this repo's worktrees  1 claimed, 1 left alone, 0 cleaned up",
    ]);
    expect(io.stderr()).toBe("");
  });

  test("dispose: a guard that declines is refused on stderr, a tree that could not be moved is a failure", async () => {
    installFakeDaemon({
      ok: true,
      data: { disposed: [], refused: [{ tree: "tree-a", reason: "dirty" }, { tree: "tree-b", reason: "remove-failed" }], recoverable: [] },
    });
    try {
      await worktreeDispose(["tree-a"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("");
    expect(io.errLines()).toEqual([
      "[refused] tree-a  it has changes that are not committed",
      "[failed] tree-b  it could not be moved away, try again",
    ]);
  });
```

(add `worktreeAdopt` to this file's `../worktree.ts` import).

Add to the file tail a new `describe` for the copy of dispose codes:

```ts
describe("disposeReason", () => {
  test("disposeReason covers every dispose code with words, never the code", () => {
    const codes = ["changed", "kind-main", "kind-golden", "kind-unmanaged", "dirty", "unpushed", "attended", "grace", "no-trash", "busy", "remove-failed", "unknown"];
    for (const code of codes) {
      const { words } = worktreeTest.disposeReason(code);
      expect(words).not.toContain(code);
      expect(words).not.toMatch(/[-_]/);
    }
    expect(worktreeTest.disposeReason("remove-failed").failed).toBe(true);
    expect(worktreeTest.disposeReason("unknown").failed).toBe(true);
    expect(worktreeTest.disposeReason("dirty").failed).toBeUndefined();
  });

  test("a running-run detail becomes the run, the stage and the command to stop it", () => {
    expect(worktreeTest.disposeReason("running-run", "running run r-7 at review; rt runs abandon r-7")).toEqual({
      words: "a pipeline run is still working in it (run r-7, at review)",
      next: { text: "rt runs abandon r-7", role: "command" },
    });
    expect(worktreeTest.disposeReason("running-run", "some other sentence").words).toBe("some other sentence");
  });

  test("an unreadable run database names the command to check by hand", () => {
    expect(worktreeTest.disposeReason("runs-unreadable", "could not verify ...")).toEqual({
      words: "rt could not check whether a pipeline run is using it",
      next: { text: "rt runs", role: "command" },
    });
  });
});
```

Add to the same file tail a new `describe`:

```ts
describe("the steps a person approves", () => {
  let io: ReturnType<typeof captureOut>;
  beforeEach(() => {
    io = captureOut();
    ui.__test__.setHuman(() => false);
  });
  afterEach(() => io.restore());

  test("the steps a person approves are shown one per line with escapes removed", () => {
    ui.print(
      worktreeTest.readyStepsBlock("app", "abc123", [
        { run: "pnpm install" },
        { run: "pnpm db:migrate \x1b[2Jecho hidden", when: "lockfile changed" },
      ]),
    );
    expect(io.stdout()).toBe("Setup steps the team wrote for app (hash abc123)\n  pnpm install\n  pnpm db:migrate echo hidden  (lockfile changed)\n");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/worktree.test.ts`
Expected: FAIL in every test above: the captures are empty (the verbs still print through `console.log`), and `readyStepsBlock` and `disposeReason` are undefined.

- [ ] **Step 3: Give the tree pickers segment rows**

Add to the imports of `commands/worktree.ts`:

```ts
import type { EnrichedBranch } from "../lib/enrich.ts";
import type { PickRow, PickSegment, Segment } from "../lib/ui/protocol.ts";
```

(extend the `Block` type import from Task 6 rather than adding a second line for `protocol.ts`).

Add below `rowLabel` the words for every dispose code (copy table rows 1 to 14). The two `detail` sentences are `lib/worktree/dispose.ts`'s (`refuse("running-run", ...)` and `refuse("runs-unreadable", ...)`); this file reads them and never prints them as written:

```ts
const DISPOSE_WORDS: Record<string, string> = {
  changed: "it changed while rt was checking it, try again",
  "kind-main": "it is the repo's main folder",
  "kind-golden": "it is the copy rt builds new worktrees from",
  dirty: "it has changes that are not committed",
  unpushed: "it has commits that are not merged or pushed",
  attended: "someone is working on its merge request right now",
  grace: "it was claimed moments ago",
  "no-trash": "rt could not keep a copy to bring it back from",
  busy: "another rt operation is using it, try again in a moment",
  "remove-failed": "it could not be moved away, try again",
  unknown: "rt has no worktree by that name",
};

/** Why rt left a tree, in words. `failed` marks the two codes that are faults rather than a guard declining. */
function disposeReason(reason: string, detail?: string): { words: string; next?: out.CellInput; failed?: true } {
  if (reason === "running-run") {
    const m = detail ? /^running run (\S+) at (\S+);/.exec(detail) : null;
    if (!m) return { words: detail ?? "a pipeline run is still working in it" };
    return { words: `a pipeline run is still working in it (run ${m[1]}, at ${m[2]})`, next: out.cmd(`rt runs abandon ${m[1]}`) };
  }
  if (reason === "runs-unreadable") return { words: "rt could not check whether a pipeline run is using it", next: out.cmd("rt runs") };
  if (reason === "remove-failed") return { words: DISPOSE_WORDS[reason]!, failed: true };
  if (reason === "unknown") return { words: DISPOSE_WORDS[reason]!, next: out.cmd("rt worktree list"), failed: true };
  if (DISPOSE_WORDS[reason]) return { words: DISPOSE_WORDS[reason]! };
  if (reason.startsWith("kind-")) return { words: "rt did not make it, so rt does not remove it" };
  return { words: reason };
}
```

Add `disposeReason` to `__test__` (the full line after Step 6 is `export const __test__ = { copyForCode, restorableEntriesBlock, readyStepsBlock, disposeReason };`).

Replace `enrichTrailingByPath` and its doc comment with:

```ts
/**
 * MR, pipeline and ticket data for each tree, from the same `enrich` pipeline
 * `rt cd` renders: one daemon `cache:read` per repo, same source as
 * `worktree:list`.
 */
async function enrichByPath(rows: TreeRow[]): Promise<Map<string, EnrichedBranch>> {
  const byPath = new Map<string, EnrichedBranch>();
  const withBranch = rows.filter((r): r is TreeRow & { branch: string } => Boolean(r.branch));
  if (withBranch.length === 0) return byPath;

  const { enrichBranches } = await import("../lib/enrich.ts");
  const { getRemoteUrl } = await import("../lib/pickers.ts");
  const repoIndex = loadRepoIndex();

  const byRepo = new Map<string, Array<TreeRow & { branch: string }>>();
  for (const r of withBranch) {
    const group = byRepo.get(r.repoName) ?? [];
    group.push(r);
    byRepo.set(r.repoName, group);
  }

  await Promise.all(
    [...byRepo].map(async ([repoName, group]) => {
      const repoPath = repoIndex[repoName];
      const remoteUrl = repoPath ? await getRemoteUrl(repoPath) : undefined;
      const enriched = await enrichBranches(group.map((r) => ({ path: r.path, branch: r.branch })), remoteUrl);
      for (const eb of enriched) byPath.set(eb.path, eb);
    }),
  );
  return byPath;
}
```

Replace `pickOneTree` with:

```ts
async function pickOneTree(rows: TreeRow[], message: string, breadcrumb: string[]): Promise<TreeRow | null> {
  if (rows.length === 0) return null;
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const { formatBranchSegments } = await import("../lib/enrich.ts");
  const enriched = await enrichByPath(rows);
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const pickRows: PickRow[] = rows.map((r) => {
    const state = rowLabel(r);
    const base =
      state === "disposable"
        ? r.disposableReason
          ? `disposable (${disposeReason(r.disposableReason).words})`
          : "disposable"
        : `${state}${r.branch ? `  ${r.branch}` : ""}${r.owner ? `  ${r.owner}` : ""}`;
    const name = r.name.padEnd(nameWidth);
    const left: PickSegment[] = [{ text: name, bold: true, column: true }, { text: `  ${base}`, tone: "dim" }];
    const eb = enriched.get(r.path);
    if (eb) left.push({ text: "  ", tone: "dim" }, ...formatBranchSegments(eb).right);
    return { value: r.path, match: name, left };
  });
  const picked = await filterableSelect({ message, options: [], stderr: true, breadcrumb }, { rows: pickRows });
  if (!picked) return null;
  return rows.find((r) => r.path === picked) ?? null;
}
```

This is the one place a picker's input changes: the hint used to carry an ANSI-colored string from `formatBranchLabelParts`; it now carries the same glyphs as segments with tones, the form `lib/pickers.ts` and `lib/repo.ts` already send. One wording change rides with it: a disposable tree's reason was the raw code joined with a long dash and is now the copy table's words in brackets, the way `list` writes it. The `disposableReason` field is the dispose code the reactor recorded, so it goes through the same `disposeReason`.

- [ ] **Step 4: Convert `list` and `triage`**

Replace `mergeCleanupOffLine` with:

```ts
function mergeCleanupOffBlocks(gap: MergeCleanupOffRow): Block[] {
  const title = `Merged worktrees are not cleaned up in ${repoLabel(gap.repo)}`;
  if (gap.reason === "no-branches-grant") {
    const mode = gap.mode === "off" ? "poll" : gap.mode;
    return [
      out.line("warn", title, gap.mode === "off" ? "rt is not watching this repo" : "rt watches this repo, but not its pull requests"),
      out.callout("next", out.cmd(`rt repos register ${shellQuote(gap.path)} --track ${mode} --caches ${[...gap.caches, "branches"].join(",")}`)),
    ];
  }
  return gap.forge === "github"
    ? [out.line("warn", title, "rt has no GitHub login"), out.callout("next", out.cmd("rt setup github connect --use-gh"))]
    : [out.line("warn", title, "rt has no GitLab login"), out.callout("next", out.cmd("rt setup gitlab connect"))];
}

const CHECKS: Record<string, Segment> = {
  success: { text: "checks passed", role: "done" },
  success_with_warnings: { text: "checks passed with warnings", role: "warn" },
  failed: { text: "checks failed", role: "failed" },
  running: { text: "checks running", role: "running" },
  pending: { text: "checks waiting", role: "pending" },
  created: { text: "checks waiting", role: "pending" },
  canceled: { text: "checks canceled", role: "off" },
};

function spaced(parts: Segment[]): Segment[] {
  return parts.flatMap((p, i) => (i === 0 ? [p] : [{ text: " " }, p]));
}

function changeCell(r: TreeRow, eb: EnrichedBranch | undefined): Segment[] {
  const mr = eb?.mr ?? r.mr ?? null;
  const parts: Segment[] = [];
  if (mr) parts.push(out.dim(`${changeMarker(r.repoName)}${mr.iid} ${mr.state}`));
  const checks = eb?.mr?.pipeline ? CHECKS[eb.mr.pipeline.status] : undefined;
  if (checks) parts.push(checks);
  if (eb?.linearId) parts.push(out.dim(eb.linearId));
  return spaced(parts);
}

function noteCell(r: TreeRow): Segment[] {
  const parts: Segment[] = [];
  if (r.duplicateBranch) parts.push({ text: "duplicate branch", role: "warn" });
  // A hold only means something while the reactor still sees a terminal MR; past that it is a leftover.
  if (r.state === "claimed" && r.heldReason && (r.mr?.state === "merged" || r.mr?.state === "closed")) {
    parts.push({ text: `held: ${r.heldReason}`, role: "warn" });
  }
  return spaced(parts);
}

function cellIsEmpty(cell: out.CellInput): boolean {
  const parts = Array.isArray(cell) ? cell : [cell];
  return parts.every((p) => (typeof p === "string" ? p : p.text) === "");
}

/** A row ends at its last cell with text, so no line carries trailing spaces. */
function listRow(r: TreeRow, eb: EnrichedBranch | undefined): out.CellInput[] {
  const label = r.state === "disposable" && r.disposableReason ? `disposable (${disposeReason(r.disposableReason).words})` : rowLabel(r);
  const cells: out.CellInput[] = [
    out.strong(`${repoLabel(r.repoName)}/${r.name}`),
    out.dim(label),
    out.key(r.branch ?? "(detached)"),
    out.dim(r.owner ?? ""),
    changeCell(r, eb),
    noteCell(r),
  ];
  while (cells.length > 0 && cellIsEmpty(cells[cells.length - 1]!)) cells.pop();
  return cells;
}
```

In `worktreeList`, replace everything from `if (parsed.json) { ... }` to the end of the function with:

```ts
  if (parsed.json) { out.json({ trees: rows, readyHeldRepos, mergeCleanupOff }, 2); return; }

  const blocks: Block[] = [];
  if (readyHeldRepos.length > 0) {
    blocks.push(
      out.line("needs-you", "The team's setup steps are waiting for your approval", readyHeldRepos.map(repoLabel).join(", ")),
      out.callout("next", out.cmd("rt worktree ready-approve <repo>")),
    );
  }
  for (const gap of mergeCleanupOff) blocks.push(...mergeCleanupOffBlocks(gap));

  if (rows.length === 0) {
    out.print(...blocks, out.line("skipped", "No worktrees"));
    return;
  }

  const enriched = await enrichByPath(rows);
  out.print(...blocks, out.table(rows.map((r) => listRow(r, enriched.get(r.path)))));
}
```

Today the merge-cleanup lines print only when there are rows; they now print in both cases, which is what the held notice already does.

In `worktreeTriage`, replace everything from `if (parsed.json) { ... }` to the end of the function with:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }
  const { rows, banners, counts } = ok.data as {
    rows: Array<Record<string, any>>;
    banners: MergeCleanupOffRow[];
    counts: { needsDecision: number };
  };
  const header = counts.needsDecision === 1 ? "1 worktree needs a decision" : `${counts.needsDecision} worktrees need a decision`;
  out.print(
    out.section(
      header,
      undefined,
      ...(banners ?? []).flatMap(mergeCleanupOffBlocks),
      out.table(
        rows.map((r) => [
          out.strong(`${repoLabel(r.repo)}/${r.tree}`),
          out.dim(r.group),
          out.dim(r.mr ? `${changeMarker(r.repo)}${r.mr.iid} ${r.mr.state}` : ""),
          String(r.verdict),
        ]),
      ),
    ),
  );
}
```

The triage handler builds each banner as `{ repo, path, ...gap }` (`lib/daemon/handlers/worktree-triage.ts:154` and `:171`), the same shape as `list`'s `mergeCleanupOff` rows, so one function words both and the same fact reads the same, as `warn`, in both verbs.

- [ ] **Step 5: Convert `dispose`, `freshen` and `adopt`**

In `worktreeDispose`: the picker cancel becomes `if (!picked) { nothingSelected(); return; }`, and everything from `if (parsed.json) { ... }` to the last `console.log("");` becomes:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  const done = disposed.map((name) => {
    const kept = recoverable?.find((r) => r.tree === name);
    return out.line("done", `${name} cleaned up`, kept ? `you can bring it back until ${kept.until.slice(0, 10)}` : undefined);
  });
  if (done.length > 0) out.print(...done);
  else if (refused.length === 0) out.print(out.line("skipped", "Nothing to clean up"));

  // A guard declining is a refusal; a tree that could not be moved, or was not
  // found, is a failure. Both go to stderr, beside the exit code set above.
  const notes = refused.flatMap((r) => {
    const why = disposeReason(r.reason, r.detail);
    if (!why.failed) return refusalBlocks({ title: r.tree, hint: why.words, next: why.next });
    return [out.line("failed", r.tree, why.words), ...(why.next ? [out.callout("next", why.next)] : [])];
  });
  if (notes.length > 0) out.note(...notes);
```

(the `await maybeOfferClaudeHook(parsed.json);` line after it stays).

In `worktreeFreshen`: the picker cancel becomes `if (!picked) { nothingSelected(); return; }`, and from `if (parsed.json) { ... }` to the last `console.log("");`:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  const ran = (ok.data?.ran ?? []) as string[];
  out.print(...(ran.length === 0 ? [out.line("skipped", "Nothing needed freshening")] : ran.map((name) => out.line("done", `${name} freshened`))));
```

In `worktreeAdopt`, from `if (parsed.json) { ... }` to the end of the function:

```ts
  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data as {
    main: string;
    claimed: string[];
    unmanaged: string[];
    disposed: string[];
    refused: Array<{ tree: string; reason: string; detail?: string }>;
  };
  // Nothing was asked of rt about these trees: cleaning up a parked tree is
  // something adopt tries on its own, so a tree a guard kept is skipped, not
  // refused, and one rt failed to move is a warning, not a failure.
  const left = (r: { tree: string; reason: string; detail?: string }) => {
    const why = disposeReason(r.reason, r.detail);
    return out.line(why.failed ? "warn" : "skipped", `${r.tree} was left as it is`, why.words);
  };
  out.print(
    ...d.claimed.map((name) => out.line("done", name, "now looked after by rt")),
    ...d.unmanaged.map((name) => out.line("skipped", name, "left alone")),
    ...d.refused.map(left),
    out.summary("done", "Adopted this repo's worktrees", [`${d.claimed.length} claimed`, `${d.unmanaged.length} left alone`, `${d.disposed.length} cleaned up`]),
  );
}
```

- [ ] **Step 6: Convert `ready-approve`**

Add above `worktreeReadyApprove`:

```ts
function readyStepsBlock(label: string, hash: string, ladder: Array<{ run: string; when?: string }>): Block {
  return out.section(
    `Setup steps the team wrote for ${label}`,
    `hash ${hash}`,
    out.verbatim(ladder.map((s) => (s.when ? `${s.run}  (${s.when})` : s.run))),
  );
}
```

and add `readyStepsBlock` to the `__test__` export: `export const __test__ = { copyForCode, restorableEntriesBlock, readyStepsBlock, disposeReason };`.

In `worktreeReadyApprove`:

- `if (!repoName) { console.log(...); return; }` after `pickRepoName` becomes `if (!repoName) { nothingSelected(); return; }`.
- The `!info.teamOwned` block becomes:

```ts
  if (!info.teamOwned) {
    if (json) { out.json({ teamOwned: false }); return; }
    out.print(out.line("skipped", `${repoLabel(repoName)} has no team setup steps to approve`));
    return;
  }
```

- The `info.approved` block becomes:

```ts
  if (info.approved) {
    if (json) { out.json({ teamOwned: true, approved: true, hash: info.hash }); return; }
    out.print(out.line("done", "Already approved", info.hash));
    return;
  }
```

- Everything from the `console.log` that prints the "team-authored ready steps" header to the end of the function becomes:

```ts
  out.print(readyStepsBlock(repoLabel(repoName), info.hash, info.ladder));

  if (!(await confirmApprove())) { out.print(out.line("skipped", "Not approved")); return; }
  writeReadyApproval(info.identity, info.hash);
  out.print(out.line("done", "Approved", info.hash));
}
```

If `info.ladder`'s element type has no optional `when`, widen `readyStepsBlock`'s parameter to that type rather than casting.

- [ ] **Step 7: Run the tests**

Run: `bun test commands/__tests__/worktree-json.test.ts commands/__tests__/worktree.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, every test in both files.

Run: `bun run typecheck`
Expected: no errors. The color import's names may now be used only in `each`; trim it to the names still used (`changeMarker` comes from `lib/repo-label.ts` and stays).

Run: `grep -n "r\.reason\|b\.reason\|e\.reason\|disposableReason}" commands/worktree.ts`
Expected: every hit passes the value through `disposeReason`, `RESTORE_REASON` or `mergeCleanupOffBlocks`, or is the `pickRestorableEntry` fallback. A raw code printed anywhere else is a copy table row this task missed.

- [ ] **Step 8: Commit**

```bash
git add commands/worktree.ts commands/__tests__/worktree.test.ts
```

```bash
git commit -m "worktree: list, triage, dispose, ready-approve, freshen and adopt on the layer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `rt worktree each`, and the file leaves the allowlist

**Files:**
- Modify: `lib/worktree-each.ts`
- Modify: `commands/worktree.ts` (`fail`, `worktreeEach`, the color import)
- Modify: `lib/__tests__/worktree-each.test.ts`, `commands/__tests__/worktree.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/worktree.ts"`)

**Interfaces:**
- Consumes: Task 6's `nothingSelected`, `out`, `usageFailure`; `out.section`, `out.summary`.
- Produces, in `lib/worktree-each.ts`:
  - `ParsedEachArgs` gains `errorKind?: "both-flags" | "no-command"`, set whenever `error` is.
  - `export interface EachSummary { status: "done" | "failed"; title: string; counts: string[] }`
  - `export function summarizeEach(results: EachResult[]): EachSummary`
  - `formatSummary` is deleted (its one caller is `worktreeEach`).

- [ ] **Step 1: Write the failing tests**

In `lib/__tests__/worktree-each.test.ts`, replace `formatSummary` with `summarizeEach` in the import list, add to the three arg-error tests one line each:

```ts
    expect(parseEachArgs(["--all", "--on-deck", "ls"]).errorKind).toBe("both-flags");
```

```ts
    expect(parseEachArgs(["--all", "--parked", "ls"]).errorKind).toBe("both-flags");
```

```ts
    expect(parseEachArgs(["--all"]).errorKind).toBe("no-command");
```

and replace the `describe("formatSummary / hasFailures", ...)` block with:

```ts
describe("summarizeEach / hasFailures", () => {
  test("all ok: a done summary that counts the worktrees", () => {
    const r = [{ name: "wt1", code: 0 }, { name: "wt2", code: 0 }];
    expect(summarizeEach(r)).toEqual({ status: "done", title: "Ran in 2 worktrees", counts: [] });
    expect(hasFailures(r)).toBe(false);
  });

  test("one worktree reads as one", () => {
    expect(summarizeEach([{ name: "wt1", code: 0 }]).title).toBe("Ran in 1 worktree");
  });

  test("a failure names each failed worktree with its exit code or its reason", () => {
    const r = [
      { name: "wt1", code: 2 },
      { name: "wt2", code: 0 },
      { name: "wt3", code: 1, reason: "path gone" },
    ];
    expect(summarizeEach(r)).toEqual({ status: "failed", title: "2 of 3 failed", counts: ["1 ok", "wt1: exit 2", "wt3: path gone"] });
    expect(hasFailures(r)).toBe(true);
  });
});
```

In `commands/__tests__/worktree.test.ts`, add `worktreeEach` to the `../worktree.ts` import and add inside the main `describe`:

```ts
  test("each outside a git repo is a failure on stderr, exit 1", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeEach(["--all", "true"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("You are not in a git repo\n  next: Run this from inside the repo whose worktrees you mean\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("each with no command asks for one", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeEach(["--all"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("Which command?\n  next: rt worktree each '<command>'\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("each runs the command in every worktree, under a heading, and sums up", async () => {
    const repoPath = makeGitRepo("each-human");
    process.chdir(repoPath);
    getRepoIdentity();
    installFakeDaemon({
      ok: true,
      data: { trees: [{ name: "one", path: repoPath, kind: "main", branch: "main", repoName: "r" }, { name: "gone", path: join(reposRoot, "no-such-tree"), kind: "ephemeral", state: "claimed", branch: "feature/x", repoName: "r" }] },
    });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeEach(["--all", "true"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
    } finally {
      exitSpy.mockRestore();
    }

    const lines = io.lines();
    expect(lines[0]).toEndWith(" (main)");
    expect(lines[1]).toBe("[ok] Finished");
    expect(lines[2]).toBe("");
    expect(lines[3]).toEndWith(" (feature/x)");
    expect(lines[4]).toBe("[failed] Stopped with an error  this worktree's folder is gone");
    expect(lines[5]).toBe("");
    expect(lines[6]).toStartWith("[failed] 1 of 2 failed  1 ok, ");
    expect(lines[6]).toEndWith(": path gone");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/__tests__/worktree-each.test.ts commands/__tests__/worktree.test.ts`
Expected: FAIL. `summarizeEach` is not exported; `errorKind` is undefined; the `each` tests read an empty capture.

- [ ] **Step 3: Change `lib/worktree-each.ts`**

Add to `ParsedEachArgs`, after `error?: string;`:

```ts
  /** Which rule the args broke, for a caller that words its own message. */
  errorKind?: "both-flags" | "no-command";
```

In `parseEachArgs`, the two error returns gain the field. Keep each `error:` value exactly as it is (the second holds a long dash; do not retype it) and add, on each object, `errorKind: "both-flags"` and `errorKind: "no-command"` respectively.

Replace `formatSummary` and its doc comment with:

```ts
export interface EachSummary {
  status: "done" | "failed";
  title: string;
  counts: string[];
}

/** The closing summary: how many ran, and each failed worktree with its exit code or the reason it never ran. */
export function summarizeEach(results: EachResult[]): EachSummary {
  const ok = results.filter((r) => r.code === 0).length;
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length === 0) return { status: "done", title: `Ran in ${ok} worktree${ok === 1 ? "" : "s"}`, counts: [] };
  return {
    status: "failed",
    title: `${failed.length} of ${results.length} failed`,
    counts: [`${ok} ok`, ...failed.map((r) => `${r.name}: ${r.reason ?? `exit ${r.code}`}`)],
  };
}
```

- [ ] **Step 4: Convert `worktreeEach`**

In `commands/worktree.ts`, change `formatSummary` to `summarizeEach` in the `lib/worktree-each.ts` import and delete the color import on line 18.

Replace the `fail` function with:

```ts
function failEach(f: out.FailureInput): never {
  out.fail(f);
  process.exit(1);
}
```

In `worktreeEach`, replace the function body from `const parsed = parseEachArgs(args);` to the end with the code below. The picker and the child spawn are unchanged; only what is printed differs:

```ts
  const parsed = parseEachArgs(args);
  if (parsed.errorKind === "no-command") failEach(usageFailure("Which command?", "rt worktree each '<command>'"));
  if (parsed.errorKind === "both-flags") failEach({ title: "Choose every worktree or only the spare ones, not both" });

  const identity = getRepoIdentity();
  if (!identity) failEach({ title: "You are not in a git repo", next: "Run this from inside the repo whose worktrees you mean" });

  const repos    = loadRepos();
  const repoPath = repos[identity.identity];
  if (!repoPath) failEach({ title: `rt does not know the ${identity.repoName} repo yet`, next: out.cmd("rt repos register <path>") });

  const bindings = (await bindingsFromDaemon(identity.identity)) ?? bindingsFromGit(repoPath);
  if (bindings.length === 0) {
    out.print(out.line("skipped", `No worktrees in ${identity.repoName}`));
    return;
  }

  let targets: WorktreeBinding[];
  if (parsed.mode === "pick") {
    if (!process.stdin.isTTY) {
      failEach(usageFailure("Which worktrees?", "rt worktree each --all '<command>'", "Without a terminal rt cannot ask, so say all of them or only the spare ones."));
    }
    const pickable = filterTargets(bindings, "pick");
    if (pickable.length === 0) {
      out.print(out.line("skipped", "No worktrees to run in"));
      return;
    }
    const widest  = Math.max(...pickable.map(b => relWorktreeName(repoPath, b.path).length));
    const options = pickable.map(b => ({
      value: b.path,
      label: relWorktreeName(repoPath, b.path).padEnd(widest),
      hint:  b.branch ?? "(detached)",
    }));
    const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
    const selected = await filterableMultiselect({
      message: `Run "${parsed.command}" in which worktrees? (${identity.repoName})`,
      options,
    });
    if (!selected || selected.length === 0) {
      nothingSelected();
      return;
    }
    const set = new Set(selected);
    targets = pickable.filter(b => set.has(b.path));
  } else {
    targets = filterTargets(bindings, parsed.mode);
    if (targets.length === 0) {
      out.print(out.line("skipped", parsed.mode === "on-deck" ? "No spare worktrees to run in" : "No worktrees to run in"));
      return;
    }
  }

  // The result of one worktree and the heading of the next go in one call, so
  // the heading gets its blank line above; the child prints between calls.
  let pending: Block[] = [];
  const results: EachResult[] = [];
  for (const b of targets) {
    const name = relWorktreeName(repoPath, b.path);
    out.print(...pending, out.section(name, b.branch ?? "(detached)"));

    if (!existsSync(b.path)) {
      pending = [out.line("failed", "Stopped with an error", "this worktree's folder is gone")];
      results.push({ name, code: 1, reason: "path gone" });
      continue;
    }

    const res = spawnSync("sh", ["-c", parsed.command], { cwd: b.path, stdio: "inherit" });
    const code = res.status ?? 1;
    pending = [code === 0 ? out.line("done", "Finished") : out.line("failed", "Stopped with an error", `exit ${code}`)];
    results.push({ name, code });
  }

  const summary = summarizeEach(results);
  out.print(...pending, out.summary(summary.status, summary.title, summary.counts.length > 0 ? summary.counts : undefined));
  if (hasFailures(results)) process.exit(1);
}
```

- [ ] **Step 5: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/worktree.ts",`.

Run: `grep -n "console\.\|process\.std\|tui\.ts" commands/worktree.ts`
Expected: the only hits are `process.stdin.isTTY`. Anything else is a site this plan missed: convert it with the block its neighbours use before going on.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test lib/__tests__/worktree-each.test.ts commands/__tests__/worktree.test.ts commands/__tests__/worktree-json.test.ts commands/__tests__/worktree-hydrate-clone.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/worktree-each.ts commands/worktree.ts lib/__tests__/worktree-each.test.ts commands/__tests__/worktree.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "worktree each: a heading per worktree and a summary; worktree.ts leaves the allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `lib/enrich.ts`: one spinner, no ANSI

**Files:**
- Modify: `lib/enrich.ts`
- Create: `lib/__tests__/enrich-fetch-step.test.ts`
- Modify: `lib/__tests__/enrich-branch-segments.test.ts` (the header comment)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"lib/enrich.ts"`)

**Interfaces:**
- Consumes: `withTransientStep<T>(label: string, task: () => Promise<T>): Promise<T>` (`lib/ui/transient-step.ts`, 5a: off a terminal or with no helper the task just runs; nothing is left on screen); Task 7 (no caller of `formatBranchLabelParts` remains).
- Produces: `enrichBranches` and every other export another file imports keep their signatures. `formatBranchLabelParts` and `BranchLabelParts` are deleted. A cold fetch that is not `silent` runs under a step titled `Fetching branch info`; nothing is written to stderr.

- [ ] **Step 1: Confirm nothing else calls the formatter**

Run: `grep -rn "formatBranchLabelParts\|BranchLabelParts" lib commands apps packages --include=*.ts`
Expected: hits only in `lib/enrich.ts` and one comment in `lib/__tests__/enrich-branch-segments.test.ts`. A hit anywhere else means a caller appeared since this plan was written: stop and report it, since that file belongs to another slice or phase.

- [ ] **Step 2: Write the failing test**

Create `lib/__tests__/enrich-fetch-step.test.ts`:

```ts
/**
 * A cold fetch draws one spinner, the Go step, and leaves nothing behind;
 * a silent fetch (a picker is already on screen) draws none.
 */
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { enrichBranches } from "../enrich.ts";
import * as daemonClient from "../daemon-client.ts";
import * as linearModule from "../linear.ts";
import { __test__ as gate } from "../ui/gate.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const FAKE = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
let dir: string;
let record: string;
let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-enrich-step-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  gate.setInteractive(() => true);
  spyOn(daemonClient, "daemonQuery").mockResolvedValue(null as never);
  spyOn(linearModule, "loadSecrets").mockResolvedValue({ linearApiKey: "invented-key" } as never);
  io = captureOut();
});
afterEach(() => {
  io.restore();
  mock.restore();
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a cold fetch runs under a step that is cleared, and writes nothing to stderr", async () => {
  const result = await enrichBranches([{ path: "/x/one", branch: "spinner-probe/cold" }]);

  expect(result.map((r) => r.branch)).toEqual(["spinner-probe/cold"]);
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "Fetching branch info" },
    { t: "done", title: "Fetching branch info", clear: true },
  ]);
  expect(io.stderr()).toBe("");
  expect(io.stdout()).toBe("");
});

test("a silent fetch draws nothing", async () => {
  await enrichBranches([{ path: "/x/two", branch: "spinner-probe/silent" }], undefined, { silent: true });
  expect(existsSync(record)).toBe(false);
  expect(io.stderr()).toBe("");
});

test("with no token there is nothing to wait for, so no step", async () => {
  mock.restore();
  spyOn(daemonClient, "daemonQuery").mockResolvedValue(null as never);
  spyOn(linearModule, "loadSecrets").mockResolvedValue({} as never);
  await enrichBranches([{ path: "/x/three", branch: "spinner-probe/no-token" }]);
  expect(existsSync(record)).toBe(false);
});

test("a missing helper costs the spinner, never the data", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  const result = await enrichBranches([{ path: "/x/four", branch: "spinner-probe/no-helper" }]);
  expect(result.map((r) => r.branch)).toEqual(["spinner-probe/no-helper"]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test lib/__tests__/enrich-fetch-step.test.ts`
Expected: FAIL. No record file is written (the fetch never opens a step), so `sent()` throws. `a silent fetch draws nothing`, `with no token there is nothing to wait for` and `a missing helper costs the spinner` pass already and are guards.

- [ ] **Step 4: Convert `lib/enrich.ts`**

Replace the color import (line 36) with:

```ts
import { withTransientStep } from "./ui/transient-step.ts";
```

Delete `MR_STATE_ICONS`, `PIPELINE_ICONS` and `hexToAnsi`, the `BranchLabelParts` interface with its doc comment, and `formatBranchLabelParts` with its doc comment (everything from the `// ─── Label formatting` banner down to, but not including, `const DEFAULT_BRANCHES`, and then from the `BranchLabelParts` doc comment down to the `// ─── Segment-form label` banner). `DEFAULT_BRANCHES` and `isDefaultBranch` stay: `formatBranchSegments` uses them. Move the `// ─── Label formatting` banner so it sits above `const DEFAULT_BRANCHES`.

In the doc comment of `formatBranchSegments`, the first sentence names the deleted function. Replace its first paragraph with:

```ts
/**
 * The branch label for the rt-ui picker's row model: a leading half (dir,
 * branch or ticket title) and a right-pinned half (pipeline, MR state, ticket
 * id), as segments with tones so the picker can recolor per theme and step
 * cursor-row weight itself. Linear's `stateColor` rides as `hex` because it
 * is a workspace's own truecolor, not one of the picker's named tones.
```

(the two paragraphs after it, about `match` and about which half leads, stay).

Replace `fetchAndCache`'s head, from its signature through the `if (!silent && willFetch && process.stderr.isTTY) { ... }` block, with:

```ts
async function fetchAndCache(
  branches: Array<{ path: string; branch: string }>,
  remoteUrl: string | undefined,
  store: BranchCacheStore,
  silent: boolean,
): Promise<EnrichedBranch[]> {
  const secrets = await loadSecretsForRemote(remoteUrl);
  const willFetch = !!(secrets.linearApiKey || secrets.gitlabToken || secrets.githubToken);
  const fetch = () => fetchFresh(branches, remoteUrl, store, secrets);
  return !silent && willFetch ? withTransientStep("Fetching branch info", fetch) : fetch();
}

async function fetchFresh(
  branches: Array<{ path: string; branch: string }>,
  remoteUrl: string | undefined,
  store: BranchCacheStore,
  secrets: Awaited<ReturnType<typeof loadSecrets>>,
): Promise<EnrichedBranch[]> {
  const identity = identityForRemote(remoteUrl);
```

(the old lines that computed `secrets`, `hasForgeToken`, `willFetch`, `identity` and `showSpinner` inside the function are the ones this replaces; the rest of the body, from `// ── Step 1: Fetch MR/PR data` on, is unchanged).

Delete the closing `if (showSpinner) { ... }` block (the counts and the "loaded" line), so the function ends:

```ts
  writeEnriched(store, enriched);

  return results;
}
```

- [ ] **Step 5: Fix the test comment**

In `lib/__tests__/enrich-branch-segments.test.ts`, replace the header comment with:

```ts
/**
 * formatBranchSegments builds the picker's branch label as segments with
 * tones and hex values. These are golden tests against the glyph vocabulary
 * in docs/design/picker/Enrichment.dc.html.
 */
```

- [ ] **Step 6: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "lib/enrich.ts",`.

- [ ] **Step 7: Run the tests and the guards**

Run: `bun test lib/__tests__/enrich-fetch-step.test.ts lib/__tests__/enrich-ondeck.test.ts lib/__tests__/enrich-branch-segments.test.ts lib/__tests__/enrich-abort.test.ts lib/__tests__/enrich-cache-identity.test.ts lib/__tests__/enrich-refresh-detached.test.ts lib/__tests__/enrich-remote.test.ts lib/__tests__/pickers.test.ts commands/__tests__/worktree.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/enrich.ts lib/__tests__/enrich-fetch-step.test.ts lib/__tests__/enrich-branch-segments.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "enrich: the fetch line is the Go step and leaves nothing; the ANSI label formatter is gone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `rt code`, leaving the opener `rt nav` shares as it is

`openDirectoryInEditor` is `rt nav`'s ctrl-o action, so it, the no-editor branch of `ensureEditor` it reaches and `savePrefs`'s warning print exactly as today. Only `openInEditor` (`rt code`) moves onto the layer. The file stays on the allowlist.

**Files:**
- Modify: `commands/code.ts`
- Create: `commands/__tests__/code-output.test.ts`

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.line`, `out.cmd`, `FailureInput` (`lib/ui/out.ts`).
- Produces: `openInEditor`, `openDirectoryInEditor` and every other export keep their signatures. `ensureEditor` (private) gains a fourth parameter, `onNoEditor: () => never`. Plain strings for `rt code`:
  - `[ok] Opened <folder> in <editor>` (stdout)
  - `<editor> did not open` / `  why: rt ran <cmd> and it failed, or it is not installed.` / `  next: rt settings set rt.workspacePrefs '{}' --scope machine` / `  That clears your saved editor, so rt asks again.` (stderr, exit 1)
  - `rt could not find an editor it can open` / `  why: ...` / `  next: ...` (stderr, exit 1)
- `openDirectoryInEditor` prints today's `\n  ✓ Opened <dir> in <editor>` (green check) or the red "Failed to open" line through `console.error`, and its no-editor path today's two `console.log` lines.

- [ ] **Step 1: Write the failing tests**

Create `commands/__tests__/code-output.test.ts`. The editor is the shell's own `true` or `false`, so nothing opens:

```ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { setSetting } from "../../lib/settings/write.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { openDirectoryInEditor, openInEditor } from "../code.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt code: what a person reads", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let folder: string;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-code-output-home-")));
    folder = realpathSync(mkdtempSync(join(tmpdir(), "rt-code-output-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: folder, stdio: "pipe" });
    process.chdir(folder);
    io = captureOut();
    ui.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  });

  test("opened: one done line naming the folder and the editor", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "true" } }, "machine");

    await openInEditor([]);

    expect(io.stdout()).toBe(`[ok] Opened ${basename(folder)} in true\n`);
    expect(io.stderr()).toBe("");
  });

  test("an editor that fails is a failure on stderr with the command that resets it, exit 1", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "false" } }, "machine");
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(openInEditor([])).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(
        "false did not open\n" +
          "  why: rt ran false and it failed, or it is not installed.\n" +
          "  next: rt settings set rt.workspacePrefs '{}' --scope machine\n" +
          "  That clears your saved editor, so rt asks again.\n",
      );
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("the opener rt nav calls prints as it does today", async () => {
    setSetting("rt.workspacePrefs", { editors: { [basename(folder)]: "true" } }, "machine");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await openDirectoryInEditor(folder);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]![0])).toStartWith("\n  ");
      expect(String(errSpy.mock.calls[0]![0])).toContain(`Opened ${basename(folder)} in true`);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("");
    } finally {
      errSpy.mockRestore();
    }
  });
});
```

The `basename` key is one of the legacy keys both openers pass to `ensureEditor`, so the saved editor is found without a prompt. The third test is a regression guard: it passes before and after this task, and it fails if anyone converts `openDirectoryInEditor`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/code-output.test.ts`
Expected: the first two FAIL (`openInEditor` prints through `console.log`, which the capture does not see); the third PASSES.

- [ ] **Step 3: Convert `openInEditor`**

Add under the color import on line 23 (the import stays: the `rt nav` paths still use it):

```ts
import * as out from "../lib/ui/out.ts";
```

Give `ensureEditor` its caller's no-editor ending. Its signature becomes:

```ts
async function ensureEditor(prefs: Prefs, repoKey: string, legacyKeys: string[], onNoEditor: () => never): Promise<string> {
```

and its `if (installed.length === 0) { ... }` block becomes `if (installed.length === 0) onNoEditor();`. Above `ensureEditor`, add the two endings. The first holds today's two lines, moved with cut and paste, not retyped:

```ts
/** rt nav's path: kept byte for byte until nav moves onto the output layer. */
function noEditorAsToday(): never {
  console.log(`\n  ${red}No supported editor CLI found.${reset}`);
  console.log(`  ${dim}Install one of: code, cursor, zed, codium, subl${reset}\n`);
  process.exit(1);
}

function noEditorFailure(): never {
  out.fail({
    title: "rt could not find an editor it can open",
    why: "It looks for the shell command of VS Code, Cursor, Zed, VSCodium, Windsurf, Sublime Text or a JetBrains editor.",
    next: "Install one of them, or turn on its shell command, then run this again",
  });
  process.exit(1);
}
```

In `openDirectoryInEditor`, change only its `ensureEditor` call, to pass `noEditorAsToday`:

```ts
  const editor = await ensureEditor(prefs, repoKey, [basename], noEditorAsToday);
```

Nothing else in `openDirectoryInEditor` changes, and `savePrefs` is not edited.

In `openInEditor`, its `ensureEditor` call gains `noEditorFailure` as the fourth argument, the success `console.log` becomes:

```ts
    out.print(out.line("done", `Opened ${label} in ${editorLabel}`));
```

and its `else` body becomes:

```ts
    out.fail({
      title: `${editorLabel} did not open`,
      why: `rt ran ${editor} and it failed, or it is not installed.`,
      next: out.cmd("rt settings set rt.workspacePrefs '{}' --scope machine"),
      details: "That clears your saved editor, so rt asks again.",
    });
    process.exit(1);
```

`launchEditor` gives the editor the terminal (`stdio: "inherit"`) and is not touched (spec rule 1). The allowlist line `commands/code.ts` stays.

- [ ] **Step 4: Run the tests and the guards**

Run: `bun test commands/__tests__/code-output.test.ts commands/__tests__/code-prefs.test.ts commands/__tests__/code-launch.test.ts commands/__tests__/code-label.test.ts commands/__tests__/code-pref-key.test.ts commands/__tests__/nav.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, with `code-prefs.test.ts` and `nav.test.ts` unedited.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add commands/code.ts commands/__tests__/code-output.test.ts
```

```bash
git commit -m "code: rt code's opened and failed lines on the layer; the opener rt nav shares is unchanged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `rt settings extension`

**Files:**
- Modify: `commands/extension.ts`
- Create: `commands/__tests__/extension-output.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `"commands/extension.ts"`)

**Interfaces:**
- Consumes: `out.print`, `out.fail`, `out.line`, `out.summary`, `out.callout` (`lib/ui/out.ts`); `openStep(title: string): StepHandle`, whose `done(title?, hint?)` and `fail(title?, hint?)` resolve `true` when rt-ui painted the final line and `false` when the caller must print it (`lib/ui/spawn.ts`); `interactive()` (`lib/ui/gate.ts`); `childEnv()` (`lib/subprocess.ts`); `logCliEvent(level, module, message, context?)` (`lib/cli-logger.ts`).
- Produces: `installExtension(): Promise<void>` unchanged. `export const __test__ = { installInto }`, where
  - `type InstallOutcome = { ok: true } | { ok: false; output: string; timedOut?: true }`
  - `type Installer = (cliPath: string, vsixPath: string) => Promise<InstallOutcome>`
  - `async function installInto(editors: Array<{ name: string; cliPath: string }>, vsixPath: string, install?: Installer): Promise<number>`: one step per editor, in order, then the summary; returns how many editors took the extension.
- The verb's exit code stays 0 on every path, as today. Plain strings off a terminal, each editor's line printed as its install returns:
  - `[ok] Installed in <editor>`
  - `[failed] <editor> did not take the extension  <last non-empty line of its output>`, `  it did not finish within 30 seconds` when the install was killed, or `  it gave no reason`
  - `[ok] RT Context is installed  N of M editors` / `  next: Restart your editor to turn it on`

`openStep` is used directly, not `StepRunner.run`: the runner's off-terminal path writes its own glyph line straight to `process.stdout` (`lib/ui/steps.ts`, `plainLine`) instead of through the layer, and a failing task has to throw out of it, while here one editor's failure must not stop the next. That is phase 1's ruling for a caller that needs its own endings: `openStep`, and `out.print` off a terminal.

- [ ] **Step 1: Write the failing test**

Create `commands/__tests__/extension-output.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { __test__ } from "../extension.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";

const FAKE_UI = resolve(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
const EDITORS = [
  { name: "Sample Code", cliPath: "/apps/sample-code" },
  { name: "Sample Editor", cliPath: "/apps/sample-editor" },
];
const install = async (cliPath: string) =>
  cliPath === "/apps/sample-code" ? { ok: true as const } : { ok: false as const, output: "Installing extensions...\nExtension is not compatible with this build\n" };

let io: ReturnType<typeof captureOut>;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-extension-output-"));
  io = captureOut();
  ui.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

test("off a terminal: one line per editor as it lands, then a count and what to do next", async () => {
  gate.setInteractive(() => false);
  expect(await __test__.installInto(EDITORS, "/x/rt-context.vsix", install)).toBe(1);
  expect(io.lines()).toEqual([
    "[ok] Installed in Sample Code",
    "[failed] Sample Editor did not take the extension  Extension is not compatible with this build",
    "[ok] RT Context is installed  1 of 2 editors",
    "  next: Restart your editor to turn it on",
  ]);
});

test("at a terminal: one step per editor, ended done or failed by the helper", async () => {
  const record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE_UI;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  gate.setInteractive(() => true);

  await __test__.installInto(EDITORS, "/x/rt-context.vsix", install);

  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.t !== "hello");
  expect(sent).toEqual([
    { t: "start", title: "Installing in Sample Code" },
    { t: "done", title: "Installed in Sample Code" },
    { t: "start", title: "Installing in Sample Editor" },
    { t: "fail", title: "Sample Editor did not take the extension", hint: "Extension is not compatible with this build" },
  ]);
  expect(io.lines()).toEqual(["[ok] RT Context is installed  1 of 2 editors", "  next: Restart your editor to turn it on"]);
});

test("when no editor took it there is no installed summary", async () => {
  gate.setInteractive(() => false);
  expect(await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", install)).toBe(0);
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  Extension is not compatible with this build"]);
});

test("an editor that failed without a word says it gave no reason", async () => {
  gate.setInteractive(() => false);
  await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", async () => ({ ok: false, output: "" }));
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  it gave no reason"]);
});

test("an install that was stopped at 30 seconds says it timed out", async () => {
  gate.setInteractive(() => false);
  await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", async () => ({ ok: false, timedOut: true, output: "Installing extensions..." }));
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  it did not finish within 30 seconds"]);
});
```

The fake helper (`lib/ui/__tests__/fake-rt-ui.ts`, verb `steps`) appends every line one step process receives to `record` once that step ends, and each step is its own process, so the record holds the steps in the order they ran.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test commands/__tests__/extension-output.test.ts`
Expected: FAIL, `__test__` is not exported.

- [ ] **Step 3: Convert `commands/extension.ts`**

Replace the color import (line 13) with:

```ts
import { logCliEvent } from "../lib/cli-logger.ts";
import { childEnv } from "../lib/subprocess.ts";
import { interactive } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
```

(`execSync` stays imported: `findVsix` still runs the build with it.)

In `findVsix`, the `console.log` before `execSync("npm run package", ...)` becomes:

```ts
      out.print(out.line("running", "Building the extension from source"));
```

Add above `installExtension`:

```ts
type InstallOutcome = { ok: true } | { ok: false; output: string; timedOut?: true };
type Installer = (cliPath: string, vsixPath: string) => Promise<InstallOutcome>;

const INSTALL_TIMEOUT_MS = 30_000;

/** An editor CLI prints progress first and its verdict last. */
function failureHint(result: { output: string; timedOut?: true }): string {
  if (result.timedOut) return `it did not finish within ${INSTALL_TIMEOUT_MS / 1000} seconds`;
  return result.output.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "it gave no reason";
}

// Spawned, not execSync: the step's spinner runs in its own process, but the
// message that starts it is only sure to reach it while this loop is free.
async function installWithCli(cliPath: string, vsixPath: string): Promise<InstallOutcome> {
  const proc = Bun.spawn([cliPath, "--install-extension", vsixPath, "--force"], { stdout: "pipe", stderr: "pipe", env: childEnv() });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, INSTALL_TIMEOUT_MS);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code === 0 && !timedOut) return { ok: true };
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return timedOut ? { ok: false, output, timedOut: true } : { ok: false, output };
}

function stepFor(title: string): StepHandle | null {
  if (!interactive()) return null;
  try {
    return openStep(title);
  } catch {
    return null;
  }
}

async function installInto(
  editors: Array<{ name: string; cliPath: string }>,
  vsixPath: string,
  install: Installer = installWithCli,
): Promise<number> {
  let installed = 0;
  for (const editor of editors) {
    const step = stepFor(`Installing in ${editor.name}`);
    const result = await install(editor.cliPath, vsixPath);
    if (result.ok) {
      installed++;
      const title = `Installed in ${editor.name}`;
      if (!(step && (await step.done(title)))) out.print(out.line("done", title));
    } else {
      const title = `${editor.name} did not take the extension`;
      const hint = failureHint(result);
      if (!(step && (await step.fail(title, hint)))) out.print(out.line("failed", title, hint));
    }
  }
  if (installed > 0) {
    out.print(
      out.summary("done", "RT Context is installed", [`${installed} of ${editors.length} editors`]),
      out.callout("next", "Restart your editor to turn it on"),
    );
  }
  return installed;
}

export const __test__ = { installInto };
```

Replace the body of `installExtension` with:

```ts
export async function installExtension(): Promise<void> {
  const vsixPath = findVsix();
  if (!vsixPath) {
    out.fail({ title: "rt could not find its editor extension", why: "It ships beside the rt program and is missing there." });
    return;
  }
  logCliEvent("debug", "extension", "vsix found", { path: vsixPath });

  const editors = detectEditors();
  if (editors.length === 0) {
    out.print(out.line("pending", "No editor that takes VS Code extensions was found", "install Cursor, VS Code or a similar editor first"));
    return;
  }

  const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");

  const selected = await filterableMultiselect({
    message: "Select editors to install RT Context into",
    options: editors.map((e) => ({
      value: e.cliPath,
      label: e.name,
      hint: e.appPath,
    })),
  });

  if (!selected || selected.length === 0) {
    out.print(out.line("skipped", "No editors selected"));
    return;
  }

  await installInto(
    selected.map((cliPath) => editors.find((e) => e.cliPath === cliPath)!),
    vsixPath,
  );
}
```

Two behavior notes for the PR body: the install now runs the editor's CLI with an argument list instead of through a shell string (`"<cli>" --install-extension "<vsix>" --force 2>&1`), so a path with a quote in it can no longer break the command; and the error shown is the CLI's own output, which today was lost (`2>&1` moved it to stdout while the code read `err.stderr`, so it nearly always printed "unknown error"). The file's header comment says `rt settings extension`; leave it.

- [ ] **Step 4: Delete the allowlist line**

In `lib/__tests__/raw-output-allowlist.json`, delete the line `  "commands/extension.ts",`.

- [ ] **Step 5: Run the tests and the guards**

Run: `bun test commands/__tests__/extension-output.test.ts lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/extension.ts commands/__tests__/extension-output.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "extension: one step per editor while it installs, and the editor's own error

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Renders and every gate

**Files:**
- Modify: `docs/design/output-layer/README.md`
- Create under `docs/design/output-layer/`: `worktree-dark.png`, `worktree-light.png`, `code-dark.png`, `code-light.png`

`rt cd` and `rt nav` get no render: neither is edited and nothing either prints changes, apart from the cold-fetch spinner `rt cd` shares with every caller of `enrichBranches`, which is the Go step 5a already rendered. AGENTS.md is not edited: this slice adds no rule.

**Interfaces:**
- Consumes: everything above; `ui/dist/rt-ui` built in Task 1.
- Produces: the renders the PR carries.

- [ ] **Step 1: Write the render inputs**

In the session scratchpad (not the repo), write `blocks.ts`. Replace `<repo>` with the worktree's absolute path. All names are invented:

```ts
// usage: bun blocks.ts <worktree|code> > in.ndjson
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";
import { usageFailure } from "<repo>/lib/ui/usage.ts";

const sets: Record<string, object[]> = {
  worktree: [
    out.line("done", "alpha", "~/pool/sample-app/alpha"),
    out.kv("branch", "feature/sample-change", "a new branch, on a spare worktree rt had ready"),
    out.line("needs-you", "The team's setup steps are waiting for your approval"),
    out.callout("next", out.cmd("rt worktree ready-approve")),
    out.line("running", "Still setting up in the background", "install, migrate"),
    out.callout("next", out.cmd("rt worktree await-ready alpha")),
    out.line("warn", "Merged worktrees are not cleaned up in sample-app", "rt has no GitHub login"),
    out.callout("next", out.cmd("rt setup github connect --use-gh")),
    out.table([
      [out.strong("sample-app/sample-app"), out.dim("main"), out.key("main")],
      [out.strong("sample-app/alpha"), out.dim("claimed"), out.key("feature/sample-change"), out.dim("sam"), [out.dim("!41 opened"), { text: " " }, { text: "checks passed", role: "done" }, { text: " " }, out.dim("SAM-12")]],
      [out.strong("sample-app/beta"), out.dim("claimed"), out.key("fix/sample-bug"), out.dim(""), [out.dim("!38 merged"), { text: " " }, { text: "checks failed", role: "failed" }], [{ text: "held: a shell is open inside it", role: "warn" }]],
      [out.strong("sample-app/gamma"), out.dim("disposable (it has changes that are not committed)"), out.key("chore/sample-tidy")],
      [out.strong("sample-app/golden"), out.dim("golden"), out.key("(detached)")],
    ]),
    out.section(
      "2 worktrees need a decision",
      undefined,
      out.line("warn", "Merged worktrees are not cleaned up in sample-kit", "rt has no GitLab login"),
      out.callout("next", out.cmd("rt setup gitlab connect")),
      out.table([
        [out.strong("sample-app/beta"), out.dim("safe"), out.dim("!38 merged"), "Every commit is in main. Only generated files are left."],
        [out.strong("sample-app/gamma"), out.dim("needs you"), out.dim(""), "Two files are changed and not committed."],
      ]),
    ),
    out.line("done", "beta cleaned up", "you can bring it back until 2026-10-08"),
    out.line("refused", "gamma", "it has changes that are not committed"),
    out.line("refused", "delta", "a pipeline run is still working in it (run 20261001-sample, at review)"),
    out.callout("next", out.cmd("rt runs abandon 20261001-sample")),
    out.line("refused", "That worktree is busy right now", "another rt operation is using it"),
    out.callout("next", "Try again in a moment"),
    out.line("needs-you", "The team's setup steps for sample-app need your approval", "approving needs a terminal, so rt can show you the steps first"),
    out.callout("next", out.cmd("rt worktree ready-approve sample-app")),
    out.callout("note", ["From a script: ", out.cmd("rt settings set rt.worktreeReadyApproval '\"4f2a9c\"' --scope user --repo sample-app")]),
    out.section("Setup steps the team wrote for sample-app", "hash 4f2a9c", out.verbatim(["pnpm install", "pnpm db:migrate  (lockfile changed)"])),
    out.line("skipped", "omega was left as it is", "it has commits that are not merged or pushed"),
    out.line("warn", "sigma was left as it is", "it could not be moved away, try again"),
    out.summary("done", "Adopted this repo's worktrees", ["1 claimed", "1 left alone", "0 cleaned up"]),
    out.table([
      [out.strong("alpha"), out.key("feature/sample-change"), out.dim("cleaned up 2026-09-30 by you"), out.dim("kept until 2026-10-07")],
      [out.strong("beta"), out.key("(detached)"), out.dim("cleaned up 2026-09-29 by rt after its merge"), out.dim("kept until 2026-10-06")],
    ]),
    out.section("sample-app/alpha", "feature/sample-change"),
    out.line("done", "Finished"),
    out.section("sample-app/beta", "fix/sample-bug"),
    out.line("failed", "Stopped with an error", "exit 2"),
    out.summary("failed", "1 of 2 failed", ["1 ok", "sample-app/beta: exit 2"]),
    out.failure({ title: "The rt daemon is not running", why: "Worktrees are made and cleaned up by the daemon.", next: out.cmd("rt daemon start") }),
    out.failure(usageFailure("Which worktree?", "rt worktree dispose <tree>")),
    out.line("warn", "The install setup step failed in alpha", "you can use this worktree, but its dependencies may be out of date"),
  ],
  code: [
    out.line("done", "Opened sample-app in Zed"),
    out.failure({ title: "Cursor did not open", why: "rt ran cursor and it failed, or it is not installed.", next: out.cmd("rt settings set rt.workspacePrefs '{}' --scope machine"), details: "That clears your saved editor, so rt asks again." }),
    out.failure({ title: "rt could not find an editor it can open", why: "It looks for the shell command of VS Code, Cursor, Zed, VSCodium, Windsurf, Sublime Text or a JetBrains editor.", next: "Install one of them, or turn on its shell command, then run this again" }),
    out.line("done", "Installed in Sample Code"),
    out.line("failed", "Sample Editor did not take the extension", "Extension is not compatible with this build"),
    out.summary("done", "RT Context is installed", ["1 of 2 editors"]),
    out.callout("next", "Restart your editor to turn it on"),
    out.line("warn", "A worktree setting for sample-app is being ignored", "\"rt.worktrees\" from the team scope is not an object"),
    out.callout("next", out.cmd("rt settings check")),
    out.line("warn", "Running these one at a time", "tmux is not on PATH"),
    out.section("web → dev", undefined),
    out.line("failed", "web → dev stopped with an error", "exit 7"),
  ],
};
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + sets[process.argv[2] ?? "worktree"]!.map(encodeLine).join(""));
```

Also write `ansi-page.ts` in the scratchpad (the same script the 5a plan uses). It turns the helper's ANSI into one HTML page on a dark or a light ground:

```ts
// usage: bun ansi-page.ts <dark|light> <title> < ansi.txt > page.html
const [mode, title] = [process.argv[2] ?? "dark", process.argv[3] ?? "render"];
const page = mode === "light" ? { bg: "#FFFFFF", fg: "#1F1F1F" } : { bg: "#161224", fg: "#E6E0FF" };
const input = await new Response(Bun.stdin.stream()).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
let open = false;
let style: Record<string, string> = {};
const flush = () => {
  if (open) html += "</span>";
  const css = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";");
  open = css !== "";
  if (open) html += `<span style="${css}">`;
};
const tokens = input.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/);
for (const token of tokens) {
  const sgr = token.match(/^\x1b\[([0-9;]*)m$/);
  if (!sgr) {
    html += esc(token);
    continue;
  }
  const codes = sgr[1] === "" ? [0] : sgr[1]!.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) style = {};
    else if (c === 1) style["font-weight"] = "bold";
    else if (c === 4) style["text-decoration"] = "underline";
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      style[c === 38 ? "color" : "background"] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  flush();
}
if (open) html += "</span>";
process.stdout.write(
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:24px;background:${page.bg};color:${page.fg}"><pre style="font:14px/1.45 Menlo,monospace">${html}</pre></body>\n`,
);
```

- [ ] **Step 2: Render four pages**

From the scratchpad, one command at a time, for `worktree` (width 110):

```bash
bun blocks.ts worktree > worktree.ndjson
```

```bash
COLORTERM=truecolor TERM=xterm-256color <repo>/ui/dist/rt-ui render --width 110 < worktree.ndjson > worktree-dark.ansi
```

```bash
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" <repo>/ui/dist/rt-ui render --width 110 < worktree.ndjson > worktree-light.ansi
```

```bash
bun ansi-page.ts dark worktree < worktree-dark.ansi > worktree-dark.html
```

```bash
bun ansi-page.ts light worktree < worktree-light.ansi > worktree-light.html
```

Then the same five for `code` at width 90.

- [ ] **Step 3: Screenshot both schemes and look**

Serve the scratchpad over http on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`; `file:` is blocked) and screenshot each of the four pages with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly). Save the four PNGs into `docs/design/output-layer/` under the names in this task's Files list.

Look at each one and write down, plainly, what reads wrong. Check at least:

- The worktree table: do the columns line up when a middle cell (owner) is empty, and is the branch (lavender) readable on the light page?
- `checks failed` in coral beside a merged, held row: does the row read as "this is broken" when only its checks are? If it shouts, say so in the report rather than changing the role.
- Every `[refused]` line (a tree rt would not clean up, the busy lock) is not coral, and its `next` reads as the way forward rather than as an error.
- The `needs-you` approval note: does the `From a script:` callout wrap cleanly at 110, with the command whole?
- The `warn` line for a tree that is not ready reads as usable-with-a-caveat, not broken.
- The restore list: "cleaned up ... by rt after its merge" is the widest cell; do the columns still line up?
- The `each` headings: is the blank line above the second heading there, and is the child's place between heading and result clear?
- Nothing wider than the pane at 90 and 110 columns.

- [ ] **Step 4: Add the renders to the README**

Append to `docs/design/output-layer/README.md`:

```markdown
## Phase 5c: worktree and navigation

- `worktree-dark.png`, `worktree-light.png`: `rt worktree` provision, list, triage, dispose with its refusals, a busy lock, ready-approve, adopt, the restore list, each, two failures and a not-ready warning.
- `code-dark.png`, `code-light.png`: `rt code`, `rt settings extension`, the worktree config warning and the one-at-a-time fallback.

`rt cd` and `rt nav` have no render: 5c does not change them.
```

- [ ] **Step 5: Run every gate**

Run each alone, from the repo root:

```bash
bun run ui:build
```

```bash
bun run ui:test
```

```bash
bun run typecheck
```

```bash
bun run test
```

```bash
bun run test:e2e
```

```bash
bun run test:pty
```

```bash
bun run picker:check
```

```bash
bun run format:check
```

Expected: all pass. `bun run docs:gen` is not needed: no command description changed. The unit suite has about ten rotating load flakes (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config); a failure in a file this slice did not touch that passes when its file runs alone is a flake, and the report says so with both results. The `rt plugin new` e2e fails on some machines with a mise shim error and is not this slice's.

Then the two checks that no gate makes:

```bash
grep -c "" lib/__tests__/raw-output-allowlist.json
```

Expected: five fewer lines than after Task 1, with `commands/cd.ts`, `commands/nav.ts`, `commands/code.ts` and `lib/pickers.ts` still listed.

```bash
rg -n "[\x{2013}\x{2014}]" commands/worktree.ts commands/code.ts commands/extension.ts lib/pickers.ts lib/enrich.ts lib/herdr-launch.ts lib/worktree/config.ts lib/worktree-each.ts
```

(`rg`, not `grep -P`: macOS grep has no `-P` and fails open.) Expected hits are only lines this slice did not write: the `--json` error strings, the `rt cd` refusal `lib/pickers.ts` keeps, and comments that were already in `commands/worktree.ts`, `lib/pickers.ts`, `lib/enrich.ts`, `lib/worktree/config.ts` and `lib/worktree-each.ts`. Check each hit against `git diff origin/main`: none may be on an added line.

- [ ] **Step 6: Commit**

```bash
git add docs/design/output-layer/README.md docs/design/output-layer/worktree-dark.png docs/design/output-layer/worktree-light.png docs/design/output-layer/code-dark.png docs/design/output-layer/code-light.png
```

```bash
git commit -m "output layer 5c: renders for worktree and code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Ship

**Files:** none.

- [ ] **Step 1: Rebase over main**

Run: `git fetch origin`
Run: `git rebase origin/main`

Resolve `lib/__tests__/raw-output-allowlist.json` by keeping every deletion from both sides. Then re-run:

```bash
bun test lib/__tests__/no-raw-output.test.ts commands/__tests__ lib/__tests__/pickers.test.ts lib/__tests__/repo-index-missing.test.ts lib/__tests__/enrich-fetch-step.test.ts lib/worktree/__tests__/config.test.ts
```

```bash
bun run typecheck
```

Expected: PASS. If phase 3 or 4 landed a test that pins `[failed] <title>` on a line this slice prints, drop the tag there (5a's plain failure rule).

- [ ] **Step 2: Size check**

Run: `git diff --stat origin/main`

If the diff is over about 2,500 changed lines, tell the shepherd before pushing: the cut is (i) `worktree` with its three lib files (Tasks 4 to 9) and (ii) `code`, `extension`, the pickers and the remaining shared files (Tasks 3, 10 and 11). This plan expects about 1,600 (about 900 in `commands/worktree.ts` and its two test files, the rest spread over the other files) and one PR.

- [ ] **Step 3: Push**

Push the branch with the `git_push` MCP tool (it pushes one explicit refspec to the same-named upstream). After a rebase it needs the force-with-lease form the tool offers.

- [ ] **Step 4: Open the PR**

Run `gh pr create` against `m4ttstack/mattstack`, base `main`, titled:

```
RT-369: output layer phase 5c, worktree and navigation
```

The body, in the style of PR 639:

- One framing paragraph: the worktree verbs, `rt settings extension` and `rt code`'s own lines print through the layer; five files leave the allowlist; `rt cd` and `rt nav` are already rt-ui and are not changed, except the cold-cache spinner below.
- **Worktree**: failures on stderr with a next step; a guard that declines (a dirty tree, a held lock, a branch another worktree has, a folder rt will not overwrite) is a `[refused]` line on stderr, not a failure; the list as a table; `each` with headings and a summary; every daemon code and daemon sentence on screen in plain words, `--json` unchanged; `await-ready` on an unready tree is a warning, exit 1 as before; `ready-approve` off a terminal says the steps need you.
- **code and pickers**: `rt code`'s opened, failed and no-editor lines on the layer; `pickFromAllRepos`'s refusals for `rt code --pick` and the worktree context move from stdout to a failure on stderr. Every path `rt cd` and `rt nav` reach in `lib/pickers.ts` and `commands/code.ts` prints as before, so both files stay on the allowlist.
- **Also**: the one deliberate stdout change, `--json` with the daemon down now puts its failure on stderr and leaves stdout empty, exit 1 as before; `rt worktree list` shows the merge-cleanup warnings when there are no worktrees too, and `triage` words the same gap the same way; the branch-info fetch in `lib/enrich.ts` is now a spinner that leaves nothing instead of two lines, for every caller: `rt worktree list` and its leaf pickers, `rt code --pick`, `rt run`'s worktree picker (`commands/run.ts:1036`) and `rt cd`'s worktree picker on a cold cache, which is the one way `rt cd`'s screen changes in this PR; `rt settings extension` shows one step per editor and the editor's own error (its last line, or that it timed out), and runs the editor's CLI with an argument list instead of a shell string; the worktree config warnings are logged and shown once.
- **Follow-up** (pre-existing, found while auditing, not fixed here):
  - `rt cd`'s two-row erase (`commands/cd.ts:236`) wipes the person's typed `rt cd` command line and the row above it on every cached run. It was written for a dispatcher header `fullscreen: true` no longer draws.
  - The comment on `rt cd`'s `fullscreen: true` (`lib/command-tree-def.ts:1158`) says the picker renders inline; it is on the alternate screen.
  - Under `rt nav`, `ensureEditor`'s "No supported editor CLI found" lines are `console.log`, so `dir="$(rt nav)"` takes them as the folder.
  - Three children of `rt nav` inherit fd 1 and can write into `$dir`: the editor ctrl-o launches (`commands/code.ts:342` and `:348`), "open terminal here" (`commands/nav.ts:377`) and "Open with" (`commands/nav.ts:202`).
  - `commands/cd.ts` and `commands/nav.ts` stay on the allowlist; phase 6 decides whether they become permanent exemptions, and with them the `rt cd` paths `lib/pickers.ts` and `commands/code.ts` keep.
  - `lib/worktree/dispose.ts` returns two human sentences as `detail` (`running-run`, `runs-unreadable`) that the CLI now parses and rewords; they should become fields.
- The four renders with what reads wrong in them.
- A verification list: the gate results, and one hand check for Matt before merge: `rt cd` and `rt nav` look and behave as on `main`, and on a cold cache `rt cd`'s worktree picker shows a spinner where it used to show the fetch line.
- The last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

Report the PR url to the shepherd, with: the gate results; any flake with both results; what the renders showed; and the open questions in "Decisions" below. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the scoping document and the spec do not settle

1. **`rt cd` and `rt nav` are not part of 5c** (Matt, 2026-10-01: "it was already a GO rt-ui"; this replaces every earlier ruling on the two verbs, shared item 12 and ruling 3 included). `commands/cd.ts`, `commands/nav.ts` and their tests are not edited. Both files stay on `lib/__tests__/raw-output-allowlist.json`: they are already rt-ui, and phase 6 decides whether they become permanent exemptions. Their stdout swap, shell helper notes, refusals, Quick Look lines and two-row erase stay as they are.
2. **What 5c's files print for `rt cd` and `rt nav` stays as it is today**, with one exception Matt ruled the same day: `enrichBranches`'s fetch line becomes a transient step for every caller, so on a cold cache `rt cd`'s worktree picker (reached through `pickWorktreeFromRepo`, `lib/repo.ts:353`, which does not pass `silent`) shows a spinner that leaves nothing instead of today's line. No special path is kept for `rt cd`.
3. **`lib/pickers.ts` keys "as today" on the `stderr` flag.** `rt cd` is the only caller that passes `stderr: true`, so with it both `pickFromAllRepos` refusals print as today through `console.error`; without it (`rt code --pick`, the dispatcher's worktree context) they become failures on stderr, where today they go to stdout. `resolveWorktreeByBranch` has only `rt cd` as a caller and is not edited. The file stays on the allowlist.
4. **`commands/code.ts` converts `openInEditor` only.** `openDirectoryInEditor` (`rt nav`'s ctrl-o), the no-editor branch of `ensureEditor` it reaches and `savePrefs`'s warning keep their bytes; `ensureEditor` takes the no-editor ending from its caller so `rt code` gets a failure while `rt nav` keeps today's two lines. The file stays on the allowlist.
5. **`rt cd`'s two-row erase is not fixed.** It wipes the typed command line on every cached run; it is named for Matt in the PR's Follow-up with the stale `fullscreen: true` comment beside it.
6. **`--json` with the daemon down.** Today that prints a colored human line on stdout, which no JSON reader can parse. The plan moves it to stderr as a failure and leaves stdout empty, exit 1 as before, the way phase 2 treats an unexpected error under `--json`. Accepted 2026-10-01. This is the one place `--json` stdout changes; it had no envelope to preserve. It is pinned in Task 6 and listed in the PR body under Also.
7. **`formatBranchLabelParts` is deleted** rather than kept behind a re-export. Its only caller was `commands/worktree.ts`. `commands/run.ts` and `commands/daemon.ts` import other names from `lib/enrich.ts`, all untouched.
8. **The leaf pickers of `rt worktree` get segment rows.** Their hint carried an ANSI string; it now carries the same glyphs as segments. This is the only picker input that changes, and it is what lets `lib/enrich.ts` leave the allowlist.
9. **`lib/explain-error.ts` is not edited.** The MCP tools return its strings to agents. The human copy for the same codes lives in `commands/worktree.ts` (`copyForCode`), with `explainError` as the fallback.
10. **`resolveRepoArg`'s messages are not edited** (`lib/repo-arg.ts` is shared and in no slice). A typed result is already there: `tryResolveRepoArg` returns `resolved`, `ambiguous` (with the matches) or `none`. The worktree verbs call it for a person and word their own failure from the kind; under `--json` they still call `resolveRepoArg`, so the envelope's text is unchanged. No phrase matching.
11. **The verb is `rt settings extension`.** The scoping document calls it `code extension`.
12. **`rt settings extension` keeps exit 0** when the extension file is missing or an editor refuses it, although it now prints a failure. Ruling 8 forbids changing an exit code in this phase.
13. **`rt worktree list` shows merge-cleanup warnings with no rows too.** Today they print only when there is at least one tree; the held-steps notice already prints in both cases.
14. **The worktree skill is not edited.** It reads `restore` as text an agent interprets, and the new text keeps `restored` and a failure or `[refused]` line on stderr. Moving the skill to `--json` is a skill change with its own review path and is left for whoever next edits that skill.
15. **Refusal or failure, per daemon code.** The table in Task 2 classifies every code `failResult` can receive. Five are refusals (`busy`, `branch-duplicated`, `branch-attached:*`, `branch-elsewhere`, `path-exists`): in each rt declines by policy (a held lock, a branch two trees hold, a branch another tree holds, a branch or folder it will not overwrite). `no-manifest` and `no-head-sha` stay failures: rt cannot restore, not will not. For dispose, every guard code is a refusal; `remove-failed` and `unknown` are failures.
16. **`adopt` reports a parked tree a guard kept as `skipped`, and one rt failed to move (`remove-failed`, `unknown`) as `warn`.** The person asked rt to adopt the repo's trees; cleaning up parked ones is something adopt tries on its own, so nothing was asked of rt about that tree, and the adopt itself succeeded. Both stay on stdout with the rest of the result, and adopt's exit code (none set today) does not change.
17. **`ready-approve` off a terminal is `needs-you` on stderr.** It exits 1 as today, so a script's stdout must not carry the note; `--json` still prints today's `{ error }` envelope.
18. **`await-ready` on an unready tree is a `warn` line on stdout**, worded like provision's and restore's warning for a failed step, because the tree is usable. Exit 1 as today.
19. **The dispose sentences from `lib/worktree/dispose.ts` are parsed on the CLI side.** `running-run`'s detail is matched with `/^running run (\S+) at (\S+);/` to pull out the run id for the `next` callout; a detail that does not match is shown as it is. That file is not this slice's, so the PR names the two sentences under Follow-up as values that should become fields.
20. **`rt settings extension` spawns the editor's CLI** with an argument list (`Bun.spawn`) instead of `execSync` on a shell string, so the step's spinner starts while the install runs, the error shown is the last non-empty line of the CLI's own output, and a kill at 30 seconds says it timed out.

## Self-Review

**Spec coverage.** Scoping section 3 "5c", as narrowed on 2026-10-01: `commands/worktree.ts` (Tasks 6, 7, 8), `lib/enrich.ts` (Task 9), `lib/herdr-launch.ts` (Task 5), `lib/worktree/config.ts` (Task 4), `commands/code.ts` (Task 10, `rt code`'s paths only), `commands/extension.ts` (Task 11), `lib/pickers.ts` (Task 3, callers other than `rt cd`), `lib/worktree-each.ts` (Task 8). `commands/cd.ts` and `commands/nav.ts` are out (Decisions, 1). Shared items: 12 void; 1 consumed (`warn` in Task 4 with 5a's rows 21 to 23, `out.note` in Tasks 5, 6 and 7); 2 consumed (Task 9); 8 consumed (`usageFailure` in Tasks 6 and 8); 5 pinned (Tasks 3 and 7). "Must not touch": `commands/cd.ts`, `commands/nav.ts`, `lib/ui/pick.ts`, `commands/worktree-hook.ts`, `lib/navigate.ts`, `lib/repo.ts`, `lib/repo-index.ts`, `commands/run.ts`, `commands/daemon.ts` appear in no Files list. Section 5 readers: the shell wrapper (no verb it reads is edited; Tasks 3 and 10 pin the shared paths), `worktree restore` as text (Task 6), `hydrate-clone` (Task 6, unit and e2e), the agent-safe leaves (the byte tests of Task 6). Rulings: 1 (no "loaded" line, Task 9, every caller), 2 (Task 4), 3 withdrawn, 4 (signatures kept, Global Constraints and Task 9 Step 1), 11 (no picker converted). Spec rules: 1 (children untouched), 2 (human text on stdout), 3 (every failure through `out.fail`; every policy refusal a `refused` note on stderr, Tasks 6 and 7), 4 (one spinner, Task 9). Copy style: every `next` command checked against the command tree in Task 2. Guard: five allowlist lines, each deleted in the commit that converts its file; `commands/code.ts` and `lib/pickers.ts` stay listed because they still print raw on the `rt cd` and `rt nav` paths.

**Gaps found and closed while reviewing.** `failText`'s human default would have printed today's flag-heavy strings for ready-approve and adopt until Task 7, so every `failText` call is repointed in Task 6. The tests that ran a verb twice read the first run's text again, because `reset()` does not empty the capture; they call phase 4's `clear()`. Task 6 does not rewrite `JSON output includes readyHeldRepos ...`, whose verb's `--json` door is Task 7's, so every commit is green. A shared function would have changed `rt cd`'s or `rt nav`'s output: the `stderr` flag in `lib/pickers.ts` and the no-editor ending in `ensureEditor` keep those paths as they are, each pinned by a regression guard that passes before and after.

**Placeholder scan.** No TBD or "handle edge cases". Three places name an existing string without quoting it in full (the `--json` error values and the `rt cd` refusal that hold a long dash, Task 3 Step 3, Task 6 Step 6 and Task 8 Step 3); each says exactly which argument or field is added beside it.

**Type consistency.** `failText(json, message, human?)`, `failResult(json, error)`, `copyForCode(error): CodeCopy`, `refusalBlocks({ title, hint?, next? })`, `resolveRepo(json, arg)`, `noRepo(usage)`, `nothingSelected()`, `STALE_DEPS`, `RESTORE_REASON` and `restorableEntriesBlock(entries)` are defined in Task 6 and used with those signatures in Tasks 6, 7 and 8. `disposeReason(reason, detail?): { words, next?, failed? }` is defined in Task 7 Step 3 and used by `pickOneTree`, `listRow`, dispose and adopt in the same task. `enrichByPath` returns `Map<string, EnrichedBranch>` and both of its callers (Task 7) read it that way. `summarizeEach` returns `{ status, title, counts }` in Task 8's lib code, its test and its caller. `__test__` of `commands/worktree.ts` is `{ copyForCode, restorableEntriesBlock }` after Task 6 and `{ copyForCode, restorableEntriesBlock, readyStepsBlock, disposeReason }` after Task 7. `ensureEditor(prefs, repoKey, legacyKeys, onNoEditor)` has both its callers updated in Task 10. `installInto(editors, vsixPath, install?)`, its `Installer` returning a promise and `InstallOutcome` with an optional `timedOut` match between Task 11's code and test.

**Review Focus.** Each of the seven lines names the test that pins it and the task that owns the code: what `rt cd` and `rt nav` print (Tasks 3, 10), a hostile branch name (Task 7), `--json` with the daemon down (Task 6), team steps with escapes (Task 7), rows with empty trailing cells (Task 7), the cold fetch (Task 9), a refusal drawn as a failure (Tasks 6, 7).

**What is not verified.** None of the TypeScript in this plan was compiled. The fixtures most likely to need adjusting on first run are the ambiguous `--repo` test (it depends on two index rows collapsing to one name), the `each` integration test (it depends on the name `relWorktreeName` gives a temp folder), the `enrich` step test (it depends on the fetch path taken with a fake Linear key and no remote), the two `ready-approve` tests (they depend on a team store under a temp HOME being read the way `lib/worktree/__tests__/ready-held.test.ts` reads one) and the `rt code` tests (they depend on a basename key in the saved prefs being adopted without a prompt). Each test states what it asserts, so an implementer who has to change a fixture keeps the assertion.
