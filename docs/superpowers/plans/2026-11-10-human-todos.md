# Human Todos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Human Todos spike as a standalone Claude Code plugin, `human-todos`, that the mattstack plugin depends on.

**Architecture:** One hooks module (`plugins/human-todos/hooks/register.tsx`) composed from focused files: a pure item model, state and persistence, the agent contract (tools, permission, prompt section), the pane UI, and two script runners (herdr and local) behind one runner front. Everything outside the module goes through `$`.

**Tech Stack:** Claude Code mod API (`claude-code`, `claude-code/testing`), TypeScript/TSX, `claude plugin test` / `claude plugin validate`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-10-human-todos-design.md`

**Reference implementation:** the spike at `~/.claude/dev-mods/0870298e-6352-41e8-bc2e-c1874fb062dd/human-todo/` (`hooks/register.tsx`, `types/index.d.ts`). Every behaviour below already works there; lift code from it, restructured into the files this plan names. If that folder is gone, the spec is the source of truth.

## Global Constraints

- Plugin name `human-todos`; folder `plugins/human-todos/` (repo root, like `plugins/mattstack`: the CI rule `scripts/__tests__/no-plugin-ci-jobs.test.ts` and `scripts/release/marketplace.sh` both read `plugins/`).
- Pane title and message prefix: `Human Todos`. Messages to the agent start `[Human Todos] `.
- Commands: `/todos` (open the pane), `/todos-runner auto|herdr|local`.
- Tools: `add`, `list`, `withdraw`, registered with `isDeferred: false`; guidance text names each tool by the full name `$.tool.register` returns.
- Kinds and buttons exactly as the spec's table: `task` Done/Skip; `run` Run/Copy/Done/Skip; `terminal` Copy/Done/Skip; `link` Open/Done/Skip.
- Statuses: `open`, `confirming`, `running`, `done`, `failed`, `skipped`.
- Script clipped to 2 rows; run output reported to the agent as the last 30 lines; live tail 3 lines (herdr) and 15 lines (local).
- herdr wrapper, verbatim: `zsh -c 'trap : INT; zsh -lc "$1"; printf "\n__todo_exit_<token> %s\n" $?' todo '<script>'`; poll every 1000 ms; a run with no marker ends after 2 consecutive idle polls.
- Spinner frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 100 ms.
- Button handlers return at once; long work runs detached (`void`), never awaited in `onPress` (the engine cuts handlers at 10 s).
- Saved lists keyed by session id in `$.store`, dropped after 30 days untouched.
- No status-line entry; no failed-command nudge.
- Public repo: nothing employer-specific in code, tests, README or PR text.
- CI pins `@anthropic-ai/claude-code@2.1.322` for this plugin's job (the spike's build).

## Review Focus

- A script with single quotes, double quotes, `$`, backslashes or a newline must reach the shell unchanged through the herdr wrapper and the local runner (test in Task 6 and Task 7).
- The herdr tab or workspace closed by the person mid-run: `pane read` fails, and the run must end as "ended without an exit code", not spin forever (test in Task 7).
- Two `run` items running at once: each has its own tab or child, token and poller; finishing one never touches the other (test in Task 7).
- A resume while an item was `confirming`, or `running` on the local runner: it comes back `open`; a herdr run comes back `running` and is watched again (test in Task 2 and Task 7).
- The pane closed when a run finishes: the agent still gets its message and the band shows the waiting count (test in Task 4 and Task 5).

---

### Task 1: Plugin scaffold, item model and CI job

**Files:**
- Create: `plugins/human-todos/.claude-plugin/plugin.json` (`name`, `version` `0.1.0`, `description`, `author` Matthew Goodwin, `license` MIT, `types` `./types/index.d.ts`)
- Create: `plugins/human-todos/LICENSE` (MIT, copy `plugins/mattstack/LICENSE`)
- Create: `plugins/human-todos/.gitignore` (`tsconfig.json` and `.claude-plugin/types/`, as in `plugins/mattstack/.gitignore`: loading the plugin writes them, and the MCP types file lists this machine's connected servers, which must never reach the public repo)
- Create: `plugins/human-todos/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`)
- Create: `plugins/human-todos/hooks/register.tsx` (composes the module files; this task registers nothing yet)
- Create: `plugins/human-todos/types/index.d.ts`
- Create: `plugins/human-todos/hooks/items.ts`
- Test: `plugins/human-todos/hooks/items.test.ts`
- Modify: `.github/workflows/checks.yml` (job `plugin-human-todos`; add it to the `checks` job's `needs`)
- Modify: `marketplace/marketplace.json` (entry `{ "name": "human-todos", "source": "./plugins/human-todos", "description": ... }`)

**Interfaces:**
- Produces (types): `AddInput = { kind: TodoKind; title: string; detail?: string; script?: string; url?: string; cwd?: string }`; `TodoKind = 'task' | 'run' | 'terminal' | 'link'`; `TodoStatus = 'open' | 'confirming' | 'running' | 'done' | 'failed' | 'skipped'`; `Todo = { id; kind; title; detail?; script?; url?; cwd?; status; exitCode?; outputTail?; liveTail?: string[]; note?; isStopping?; runner?: 'herdr' | 'local'; paneId?; tabId?; token?; logPath? }`.
- Produces (`items.ts`): `checkKind(input: AddInput): string | undefined` (refusal reason or none); `toTodo(id: string, input: AddInput): Todo` (drops fields that do not belong to the kind); `buttonsFor(todo: Todo): readonly ButtonId[]` where `ButtonId = 'run' | 'open' | 'copy' | 'done' | 'skip' | 'confirm' | 'cancel' | 'show' | 'stop' | 'openLog'`; `isActionable(t: Todo): boolean` (open, confirming, running); `hardWrap(text: string, width: number): string[]`; `tail(out: string, lines = 30): string`; `describe(list: readonly Todo[]): string`; `quote(text: string): string` (POSIX single-quote).

- [ ] **Step 0: Scaffold** `plugin.json`, `LICENSE`, `.gitignore`, `hooks/hooks.json` and an empty `register.tsx` (exports `register` and hooks nothing), before any test run, so the first run fails on missing exports rather than a missing plugin.
- [ ] **Step 1: Write the failing tests** in `items.test.ts` (`import { test, expect } from 'claude-code/testing'`):
  - `checkKind({ kind: 'run', title: 'x' })` → `'kind run needs a script.'`; `terminal` same wording; `link` with `url: 'ftp://x'` → `'kind link needs an http(s) url.'`; `task` → `undefined`.
  - `toTodo('3', { kind: 'task', title: 't', script: 'ls', url: 'https://a' })` has no `script` and no `url`; `toTodo` for `run` keeps `script` and `cwd`, drops `url`; `status` is `'open'`.
  - `buttonsFor`: open `run` → `['run','copy','done','skip']`; open `terminal` → `['copy','done','skip']`; open `link` → `['open','done','skip']`; open `task` → `['done','skip']`; `confirming` → `['confirm','cancel']`; herdr `running` → `['show','stop']`; local `running` → `['openLog','stop']`; `running` with `isStopping` → `['show']` (herdr) / `['openLog']` (local).
  - `hardWrap('$ abcdef', 4)` → `['$ ab','cdef']`; `tail` keeps the last 30 lines; `quote("it's")` → `'it'\''s'`.
- [ ] **Step 2: Run** `claude plugin test plugins/human-todos` from the repo root. Expected: FAIL, `items.ts` exports missing.
- [ ] **Step 3: Implement** `items.ts` and `types/index.d.ts` (lift from the spike's `kindOf`, `checkKind`, `hardWrap`, `tail`, `describe`, `quote`; drop the legacy `isInteractive` inference, since every item now has a kind).
- [ ] **Step 4: Add the CI job** `plugin-human-todos` modelled on `plugin-mattstack`: same `needs: scope` and comma-wrapped `if` on `plugins/human-todos`; steps checkout (depth 2), setup-bun 1.4.4, `bun scripts/ci/plugin-version-bumped.ts --base HEAD^1 --plugin plugins/human-todos` (PRs only), `npm install -g @anthropic-ai/claude-code@2.1.322`, `claude plugin test plugins/human-todos`, `claude plugin validate plugins/human-todos`. Add `plugin-human-todos` to the `checks` job's `needs`, and in that job add the env entry `HUMAN_TODOS: ${{ needs.plugin-human-todos.result }}`, a `[ "$HUMAN_TODOS" = success ] || [ "$HUMAN_TODOS" = skipped ] || exit 1` line beside the `MATTSTACK` and `HERDR_CHAT` ones, and `HUMAN_TODOS` to its echo line (the gate runs `if: always()`, so `needs` alone never fails it).
- [ ] **Step 5: Run** `claude plugin test plugins/human-todos`, `claude plugin validate plugins/human-todos` and `bun test scripts/__tests__/no-plugin-ci-jobs.test.ts`. Expected: all pass.
- [ ] **Step 6: Commit** `human-todos: scaffold plugin, item model and CI job`.

### Task 2: State, ids and persistence across resume

**Files:**
- Create: `plugins/human-todos/hooks/store.ts`
- Test: `plugins/human-todos/hooks/store.test.ts`
- Modify: `plugins/human-todos/types/index.d.ts` (`PluginState['human-todos']`)

**Interfaces:**
- Consumes: `Todo`, `AddInput`, `isActionable` (Task 1).
- Produces: atoms `todos` (`Shaped<Todo[]>`, shape `'todos-1'`), `nextId` (number), `expanded` (string[]), `isPaneOpen` (boolean), `frame` (number), `workspace` (string | null), `runnerPref` (`'auto' | 'herdr' | 'local'`); `addTodo($, input: AddInput): Promise<Todo>` (assigns `String(nextId)` then increments; ids never repeat within a session, clears included); `patchTodo($, id: string, change: Partial<Todo>): Promise<void>`; `removeTodos($, pick: (t: Todo) => boolean): Promise<Todo[]>` (returns the removed ones); `saveList($): Promise<void>`; `restoreList($): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - Add three items, remove all, add one: its id is `'4'`.
  - After `addTodo`, `$.store` holds `{ todos, nextId, savedAt }` under key `list:<sessionId>` (stub `session.id`).
  - `restoreList` with a saved list for the current session id restores items and `nextId`; an item saved as `confirming` comes back `open`; a `running` item with `runner: 'local'` comes back `open` with `note: 'Ended without an exit code.'`; a `running` herdr item stays `running`.
  - `restoreList` with no saved entry for this session id leaves the list empty (a new session starts empty).
  - `restoreList` deletes any `list:*` entry whose `savedAt` is more than 30 days before `$.clock.now()` (use `mock.clock`).
- [ ] **Step 2: Run** `claude plugin test plugins/human-todos`. Expected: FAIL.
- [ ] **Step 3: Implement** `store.ts`; every write through `addTodo`/`patchTodo`/`removeTodos` calls `saveList`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `human-todos: state, monotonic ids and resume persistence`.

### Task 3: Agent contract

**Files:**
- Create: `plugins/human-todos/hooks/contract.ts`
- Test: `plugins/human-todos/hooks/contract.test.ts`
- Modify: `plugins/human-todos/hooks/register.tsx`

**Interfaces:**
- Consumes: `checkKind`, `toTodo`, `describe` (Task 1); `addTodo`, `removeTodos`, `restoreList` (Task 2); `openPane($)` arrives in Task 4 and `cleanup($, gone)` in Task 5, so call them through a hook-up object passed into `registerContract(on, deps)` with `deps: { openPane($): Promise<void>; cleanup($, gone: readonly Todo[]): Promise<void> }`.
- Produces: `registerContract(on, deps)`; `guidance(names: { add: string; list: string; withdraw: string }): string`; `addDescription(paneTitle: string): string`.

- [ ] **Step 1: Write the failing tests:**
  - On `session.start`, three tools register with `isDeferred: false`; `add`'s `inputSchema.required` is `['kind','title']` and `kind.enum` is the four kinds.
  - `add` with a mismatched kind returns `{ deny: 'kind run needs a script.' }` and adds nothing; a valid call returns `{ result: 'Added #1 …' }` and calls `deps.openPane`.
  - `withdraw` removes the item and calls `deps.cleanup` with it; `list` returns `describe(list)`.
  - `tool.check` on each of the three tools answers `{ decision: 'allow' }`; `tool.check` on `Bash` passes through untouched.
  - `prompt.compose` appends one section with id `human-todos:guidance`, scope `session`, whose text contains the full `add` name returned by `$.tool.register` (stub it to return `mcp__x__add`).
  - `addDescription('Human Todos')` mentions all four kinds and "never ask them to type \"done\"".
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `contract.ts`. Register tools before `next(e)` in `session.start` (the reference API example registers first); call `restoreList` there too. Lift the description and guidance text from the spike's `ADD_DESCRIPTION` and `GUIDANCE`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `human-todos: tools, self-allow and prompt guidance`.

### Task 4: Pane, band and transcript rows

**Files:**
- Create: `plugins/human-todos/hooks/pane.tsx`
- Test: `plugins/human-todos/hooks/pane.test.tsx`
- Modify: `plugins/human-todos/hooks/register.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 atoms and writers, `buttonsFor`.
- Consumes via deps (wired in `register.tsx`): `press($, todo: Todo, button: ButtonId, surface): Promise<void>` and `cleanup($, gone: readonly Todo[]): Promise<void>`, both from Task 5.
- Produces: `registerPane(on, deps: { press; cleanup })`; `openPane($): Promise<void>` (opens `{ id: 'human-todos', title: 'Human Todos' }`, sets `isPaneOpen` from `isPlaced`); `closePane($)`.

- [ ] **Step 1: Write the failing tests** (mount the `Pane` on `terminal` and `desktop`, per the reference's test guidance):
  - Header shows `Human Todos` and a `Close` button that closes the pane and sets `isPaneOpen` false; `ui.close` from the engine's own mark does the same.
  - An open `run` item draws its title, detail, the script clipped to 2 rows with `… +N more` and a `Show all` button that toggles `Show less`; buttons appear in `buttonsFor` order, each keyed `<button>-<id>`, and pressing one calls `deps.press` with that button id.
  - A `note` draws under the detail; a `running` item draws the live tail and a spinner frame.
  - Finished items draw `✓` (colour `success`), `✗` (`error`), `–` (`inactive`) with the title dimmed and `(exit N)` only when N ≠ 0, then a blank row, then `Clear finished`, which removes finished items and calls `deps.cleanup` for them.
  - The band's N counts items whose status is `open` or `confirming`. With the pane closed and 1 such item, `AbovePrompt` draws `○ 1 Human Todo` and an `Open` button; with 2, `○ 2 Human Todos`; with the pane open, it passes (`next(e)`).
  - A `UserMessage` from origin `{ kind: 'plugin', name: 'human-todos' }` with three lines draws one row: `Human Todos ` then the first line without the `[Human Todos] ` prefix and `(+2 lines, ctrl+o)`; with `isExpanded` it passes; another plugin's row passes.
  - `/todos` opens the pane.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `pane.tsx`, lifting the spike's render (padding 2/1, indented body, blank row before buttons, `Text` spacer before `Clear finished`).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Render check:** load the plugin in an interactive session (`claude --plugin-dir plugins/human-todos`), add one item of each kind, screenshot the pane in a dark and a light terminal theme, and write down anything that reads wrong before moving on.
- [ ] **Step 6: Commit** `human-todos: pane, band and compact transcript rows`.

### Task 5: Actions, confirm and reporting

**Files:**
- Create: `plugins/human-todos/hooks/actions.ts`
- Test: `plugins/human-todos/hooks/actions.test.ts`
- Modify: `plugins/human-todos/hooks/register.tsx`

**Interfaces:**
- Consumes: Task 2 writers; `Runner` interface from this task, implemented in Tasks 6 and 7.
- Produces: `Runner = { start($, todo: Todo): Promise<void>; stop($, todo: Todo): Promise<void>; show($, todo: Todo): Promise<void>; cleanup($, todo: Todo): Promise<void> }`; `registerActions(on, deps: { runners: Record<'herdr' | 'local', Runner> }): { press; cleanup }` (also registers `/todos-runner`); `cleanup($, gone: readonly Todo[]): Promise<void>` (calls each item's runner's `cleanup`, by `todo.runner`); `chooseRunner($): Promise<'herdr' | 'local'>`; `report($, todo: Todo, outcome: Outcome): Promise<void>` where `Outcome = { kind: 'done' | 'skipped' } | { kind: 'ran'; exitCode: number; outputTail: string } | { kind: 'stopped'; outputTail: string } | { kind: 'ended'; outputTail: string }`; `actions.press($, todo, button, surface)`.

- [ ] **Step 1: Write the failing tests:**
  - `run` → status `confirming`, no runner started, nothing sent to the agent; `cancel` → `open`, nothing sent; `confirm` → the chosen runner's `start` is called and the handler returns before `start` resolves (stub `start` with a promise that never settles; the press still resolves).
  - `done` → status `done` and `$.prompt.submit` with `[Human Todos] #1 "T": the user marked it done.`; `skip` → `skipped` and `…: the user skipped it.`
  - `report` for `ran` exit 0 → `done`, exit 3 → `failed`, text `[Human Todos] The user ran #1 "T" from the pane: exit 3.` followed by a fenced block of the tail; `stopped` → `open`, note `Stopped`, text `… before it finished. It is open again.`; `ended` → `open`, note `Ended without an exit code.`
  - `stop` → `isStopping` true, a `Stopping #1` toast, then the runner's `stop`.
  - `open` on a `link` item runs `open <url>` only for `http(s)` URLs; `copy` copies the script to the press's surface; `openLog` runs `open -t <logPath>`.
  - `cleanup` calls `cleanup` on the runner each item ran under (stub runners), and skips items that never ran.
  - `chooseRunner`: `runnerPref` `herdr`/`local` wins; `auto` returns `herdr` only when `HERDR_SOCKET_PATH` is set and `herdr workspace list` exits 0 (stub `process.run`).
  - `/todos-runner local` sets the pref; `/todos-runner` with no argument reports the current one.
  - Pane closed when `report` runs: the message is still submitted.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `actions.ts`. In `register.tsx`, pass stub runners until Tasks 6 and 7 land (each method resolves and does nothing), and hand `press` and `cleanup` to `registerPane` and `registerContract`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `human-todos: actions, run confirm and reports`.

### Task 6: Local runner

**Files:**
- Create: `plugins/human-todos/hooks/runner-local.ts`
- Test: `plugins/human-todos/hooks/runner-local.test.ts`

**Interfaces:**
- Consumes: `Runner`, `report` (Task 5); `patchTodo`, `frame` (Task 2).
- Produces: `localRunner: Runner`.

- [ ] **Step 1: Write the failing tests** (stub `process.spawn` as an async generator, `mock.clock`):
  - `start` spawns `['/bin/zsh', '-lc', 'print -u2 "__human_todo_pid__$$"; <script>']` with the item's `cwd`; the pid line is stripped from output; chunks update `liveTail` (last 15 non-empty lines) at most once per second and the log file (`$.fs.write`) under `<cache>/human-todos/<session>-<id>-<token>.log`.
  - A script `echo 'a "b" $HOME \\ c'` reaches the spawn argv byte for byte.
  - Exit code 2 → `report` with `{ kind: 'ran', exitCode: 2 }`.
  - `stop` after the pid is known runs `pkill -TERM -P <pid>; kill -TERM <pid>` and the ending is reported as `stopped`; `stop` before the pid is known toasts `Still starting; try Stop again in a moment`.
  - `show` does nothing (local items have no Show button).
  - `cleanup` deletes the item's log file with `rm -f <logPath>` through `process.run` (the mod API has no delete).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `runner-local.ts` (lift the spike's `runLocal`; cache folder from `$.env.get('XDG_CACHE_HOME')`, else `<HOME>/Library/Caches` with HOME from `$.env.get('HOME')`; the module has no `~` expansion). Replace the stub `local` runner in `register.tsx` with `localRunner`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `human-todos: local runner`.

### Task 7: herdr runner

**Files:**
- Create: `plugins/human-todos/hooks/runner-herdr.ts`
- Test: `plugins/human-todos/hooks/runner-herdr.test.ts`
- Modify: `plugins/human-todos/hooks/register.tsx` (replace the stub `herdr` runner), `plugins/human-todos/hooks/contract.ts` (`session.start` calls `resumeWatching` after `restoreList`)

**Interfaces:**
- Consumes: `Runner`, `report` (Task 5); `patchTodo`, `workspace`, `frame` (Task 2); `quote` (Task 1).
- Produces: `herdrRunner: Runner` (its `cleanup` closes the item's tab); `resumeWatching($): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (stub `process.run` by argv; herdr JSON replies shaped like `workspace create`'s `{ result: { workspace: { workspace_id }, root_pane: { pane_id, tab_id } } }`):
  - First `start` creates a workspace labelled `Human Todos` with `--no-focus` and renames its tab to `#<id> <title>` (40 chars max); a second item reuses the workspace with `tab create --workspace <ws> --no-focus`; a stored workspace that `workspace get` rejects is replaced.
  - The text sent by `pane run` is exactly the Global Constraints wrapper with the item's token and `quote(script)`; a script with `'`, `"`, `$` and a newline round-trips through `quote`.
  - Polls each 1000 ms: reads `--source recent-unwrapped --lines 400`; lines after the echoed command and before `__todo_exit_<token> N` set `liveTail` (last 15) until the marker appears, then `report` `{ kind: 'ran', exitCode: N, outputTail }`.
  - Two items running at once each finish with their own exit code and tail.
  - No marker and `pane process-info --pane <id>` idle (`foreground_process_group_id === shell_pid`) on 2 consecutive polls → `report` `{ kind: 'ended' }`; a `pane read` that fails on 2 consecutive polls (tab closed) also ends as `ended`.
  - `stop` sends `pane send-keys <pane> ctrl+c`; the marker that follows reports `stopped`.
  - `show` runs `herdr workspace focus <ws>` and `herdr tab focus <tab>`, then `rt pane focus <pane>` only when `command -v rt` succeeds.
  - `herdrRunner.cleanup` runs `herdr tab close <tab>` when the item has one.
  - `resumeWatching` starts a poller for every `running` herdr item, and a `session.start` with a restored running herdr item calls it.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `runner-herdr.ts` (lift the spike's `paneFor`, `runInHerdr`, `watch`, `poll`, `paneIsIdle`, `stopTodo`, `showTodo`, `closeTabs`; herdr and rt are called through `/bin/zsh -lc` so the login PATH applies).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Live check:** with herdr running, load the plugin interactively, add a `run` item whose script prints a line a second for 20 seconds, Confirm, press Show, then Stop; confirm the tab shows `^C`, the item returns to open with `Stopped`, and the agent's message arrives.
- [ ] **Step 6: Commit** `human-todos: herdr runner`.

### Task 8: mattstack dependency, README and release wiring

**Files:**
- Create: `plugins/human-todos/README.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`dependencies`, version bump one past main)
- Possibly modify: the setup step that installs mattstack's plugins (only if Step 1 finds dependencies are not installed automatically)

**Interfaces:**
- Consumes: the finished plugin.

- [ ] **Step 1: Verify dependency install.** In a scratch `HOME` (`env -i HOME=<temp> PATH=$PATH claude …`), add a local marketplace containing both plugins, with `mattstack` declaring `"dependencies": ["human-todos"]`, install only `mattstack`, then `claude plugin list --json`. Record whether `human-todos` is installed, and which `dependencies` form the CLI accepts (`"human-todos"` or `"human-todos@mattstack"`); Step 2 uses that form.
- [ ] **Step 2: Wire the dependency.** Add `dependencies` in the form Step 1 found to `plugins/mattstack/.claude-plugin/plugin.json` and bump its version one past main (re-check main's version just before merging; the version race is real). If Step 1 showed no automatic install, also add `human-todos` to the plugins rt setup installs, following `.claude/rules/setup.md` (read it first), with that row's test.
- [ ] **Step 3: Write the README:** what it is, a screenshot, the install lines for people without mattstack (`/plugin marketplace add m4ttstack/mattstack-marketplace`, then `/plugin install human-todos@mattstack`), the four kinds, `/todos` and `/todos-runner`, and that herdr is optional.
- [ ] **Step 4: Run** `claude plugin validate plugins/human-todos`, `claude plugin validate plugins/mattstack` (also under the `plugin-mattstack` job's pinned CLI, `npx @anthropic-ai/claude-code@2.1.318 plugin validate plugins/mattstack`; if that older validator rejects `dependencies`, raise the job's pin in this task) and `scripts/release/marketplace.sh --dry-run`. Expected: all pass, and the dry run stages `plugins/human-todos`.
- [ ] **Step 5: Managed-account check:** on an account with managed settings, start a session with the plugin and ask the agent whether it sees the `# To-dos for the user` section and the `add` description. Record the answer in the PR; a missing section is acceptable (the description is the fallback).
- [ ] **Step 6: Commit** `human-todos: mattstack dependency, README and marketplace entry`.
