# Herd tools: respawn, tree spawns, shepherd gate answers, diagnosis, budgets, lanes

## Why

Today the shepherdr skill does a lot of work through raw shell lines and
counters it keeps in its head. It respawns workers with
`rt herd spawn --dir`, answers gates with `rt gate answer --by shepherd`,
reads raw pane scrollback to work out why a worker is stuck, and counts
respawns, nudges and reviewer rounds in its own context. Those counts reset
when the shepherd compacts or resumes, so its loop budgets do not hold. It
measures drift with a `cd` plus `git diff` loop per tree, and checks merge
state by hand, one forge at a time.

This wave gives the shepherd real tools for that work. It adds no skill
edits; the skill shrinks in wave 3.

One bug fix rides along. `buildPluginRoots` keys plugin roots by name. A
second install of the same plugin in another scope (a stale project-scope
copy) overwrites the user-scope root, so `herd_brief` refuses the skill dir
that is actually loaded.

## Goals

- `herd_respawn {job, brief?, model?, effort?, account?}` relaunches a job
  in its own tree. It keeps the model, effort and account the job last ran
  with unless the call overrides them.
- `herd_spawn` takes an optional `tree`: a registered tree name, never a raw
  dir. Domain packs keep owning per-ticket provisioning; they hand
  `herd_spawn` the tree they made.
- `herd_gate_answer` and `herd_gate_park`: shepherd-only twins of the gate
  answer and park verbs. The answer records `by: shepherd`.
- `herd_diagnose {job}` classifies a stuck worker on the daemon side.
  Raw pane text never reaches the shepherd.
- `herd_nudge {job, gate}` runs the nudge ladder: a DM first, then a typed
  line in the pane when that is safe.
- Per-job budgets (respawns, blocked notices, nudges, reviewer rounds,
  unmerged reports) live in the daemon's herd store. The watchdog's strike
  ladders, in memory today, persist there too.
- `herd_lanes` is one read that returns drift, cross-job file collisions and
  merge state, on GitHub and GitLab.
- `buildPluginRoots` keeps every installed root.

## Non-goals

- No skill edits under `plugins/mattstack`. The only plugin changes are
  the regenerated tools reference and the patch bump CI requires (see
  Constraints).
- No new `rt herd` CLI verbs. The tools call daemon verbs directly. The CLI
  keeps `--dir` for people.
- No write fence on the job row and no `outsideFence` drift field. The
  brief does not store a fence.
- No account picking in the daemon (`pick-account.py` stays script-side).
- No `herd_wrap_up` stop-holders work.
- No budgets for answer retries or brief retries. The brief names five
  counters; a refusal that lists the valid values makes answer retries
  rare.

## Anti-goals

These would make the work a failure even if it ran:

- A tool that acts on a spent budget. A tool never refuses, escalates,
  closes, respawns or notifies because a budget ran out. A spent budget
  comes back as a field, and the skill's graph routes it to its off-script
  gate. When the user approves "take the proposed move", the graph calls
  the same tool again, and it must do the move.
- Raw pane text in any tool result.
- A spawn into a caller-chosen directory. The daemon auto-accepts the
  trust dialog, so a tree must be one rt registered.
- A tool that presses keys into a modal or a form.
- A tool that answers a gate on its own.

## Constraints

- **Write fence.** `lib/mcp/herd-tools.ts`, `lib/daemon/**` herd units and
  the watchdog, `commands/herd.ts`, `lib/herd-brief.ts`, `lib/herdr/**`,
  `lib/skills/sources.ts` (buildPluginRoots only),
  `lib/mcp/temp-root-guard.ts`, and `lib/mcp/tools.ts` (one contiguous
  block). The shepherd widened it (gate 722599c6) to add
  `packages/rt-client/src/{commands,client,index}.ts`, herd entries only,
  one contiguous block each, plus a `dist/` rebuild; and `lib/daemon.ts`,
  herd wiring lines only.
- **Plugin CI.** Any `lib/mcp/` change makes CI regenerate the MCP tools
  reference and compare it. Per Matt's herd-wide ruling (gate 64b9877a),
  this PR regenerates `plugins/mattstack/attachments/mcp-tools/reference.md`,
  bumps `plugins/mattstack/.claude-plugin/plugin.json` by one patch
  version, and adds the new tool names to `EXPECTED_TOOL_NAMES` in
  `e2e/tests/mcp-serve.test.ts`. On a version conflict at merge, take the
  higher version and regenerate. No other plugin edits.
- **Sibling lanes.** gate-tools owns `gate_ask`/`gate_answer` and the gate
  handler and store. This work calls `gate:answer` and `gate:park` as they
  are and changes neither.
- **Live daemon.** This herd runs on the live daemon. Never restart it, and
  never run a built binary outside an isolated HOME.
- **Additive store changes.** `herds.db` changes are idempotent column and
  table additions, in the style of the existing `shepherdPane` migration.

## Design

### Daemon verbs and rt-client

Four new daemon verbs: `herd:respawn`, `herd:diagnose`, `herd:nudge` and
`herd:lanes`. `herd:spawn` gains `tree?: string`. Each verb gets a typed
`Commands` entry, a `COMMAND_NAMES` entry and a client function
(`herdRespawn`, `herdDiagnose`, `herdNudge`, `herdLanes`), exported from
the rt-client index. `herd_gate_answer` and `herd_gate_park` need no new
verb: they compose `herd:gates` (to check membership), `gate:answer` and
`gate:park`.

### Job row: launch settings

`herd_jobs` gains `model`, `effort` and `account`, all nullable. Every spawn
writes what it launched with. On respawn, each value is the call's value if
given, else the stored one, else none (agent:start's default). They also
show in `herd_status` and in `rt herd status --json`, since status spreads
the row. The frozen human bytes are unchanged.

### `herd_spawn {tree}`

- `herd:spawn` resolves `tree` against `loadRegistry(herd.repo)`. Tree
  names are unique per repo only, so the herd's repo scopes the lookup.
- Admission: only an `ephemeral` tree in state `claimed` is accepted.
  Everything else is refused with its kind and state: an unknown name, a
  `main` or `golden` tree (a worker would share it), an `unmanaged` tree
  (reconcile registers any `git worktree add` folder that way, so its
  `.claude/settings.json` is unvetted), and an ephemeral tree still
  `creating`, `on-deck` or `disposable` (the pool may reset it under a
  running worker).
- The tree's path becomes the job's worktree, and the row's `branch` comes
  from the registry record.
- **Ownership.** If another job in this herd already holds the same tree
  (a non-closed row with that `tree`), the new job is a guest: its row
  keeps `tree: null`, so `herd_wrap_up` can never dispose the host's tree
  through it. Otherwise the job owns the tree and the row stores its name.
- **Reviewer rounds.** A guest spawn credits one reviewer round to the
  host job. The round is keyed by the host's latest milestone artifact
  (`meta.artifact` on its last milestone gate, or `""` when it has none).
- The MCP tool still refuses `dir`. It now also refuses an existing job
  whose worktree still exists on disk when no `tree` is given, pointing at
  `herd_respawn`. That spawn would provision `branch: <job>` again and fail
  `branch-attached`. A job whose tree was disposed can be spawned fresh
  under the same name. A reviewer's second round reuses its job name with
  a `tree`, so it still works.

### `herd_respawn`

- Needs an existing job row whose worktree still exists on disk and is
  still a registered tree that passes the same admission rule as a tree
  spawn (`findTreeByPath`, then kind and state). A worktree that fails
  either check is refused with its path.
- **The old session's gates.** Each spawn runs a new claude session, and
  `herd:answer` consumes a gate only for the session it nudges, so gates
  from the old session can never settle. Before launching, respawn closes
  the job's open gates as `abandoned` through `gate:close` (the new worker
  re-asks), and stamps its answered-but-unconsumed gates consumed through
  the store's `markConsumed`, so neither the watchdog nor a nudge chases
  them. Both are existing verbs; the gate schema is untouched.
- Reuses the row's worktree, branch, tree and disposable flag, and never
  provisions. It closes the old pane (as spawn does), reuses the stored
  brief unless `brief` names a new one, and launches with the inherited
  settings.
- Ticks `respawns`.
- Returns the spawn data plus `launch: {model, effort, account}` and
  `budget: {used, cap, spent}`.
- Internally, `herd:spawn` and `herd:respawn` share one launch routine; the
  difference is where the worktree comes from.

### Budgets

A new `herd_budgets` table in `herds.db` holds one row per (herd, job,
counter, key) with a `used` count. The caps are constants in a new
`lib/daemon/herd-budgets.ts`. They match the counts the skill draws today:

| Counter | Key | Cap | What ticks it |
|---|---|---|---|
| `respawns` | none | 2 | each `herd:respawn` |
| `blockedNotices` | none | 3 | the lifecycle's `<job> blocked` room post |
| `nudges` | gate id | 2 | each delivered `herd:nudge` |
| `reviewerRounds` | milestone artifact | 2 | a guest spawn into the job's tree |
| `unmergedReports` | report id | 2 | `herd:lanes` measuring a done job's latest report as unmerged; at most once per report id; capped on the count of report ids |

Every view of a counter reads `{used, cap, spent}`, where
`spent = used >= cap`, and counts past the cap keep counting. No tool reads
`spent` to decide anything. `herd_diagnose` returns all of the job's
budgets; each mutating tool returns the one it ticked. Budgets never reset
while the job lives.

### Watchdog ladders persist

`HerdWatchdog` takes an optional `persist` dependency that loads the
ladders and saves each change: the ladders (strikes, `lastPokeAt`,
`since`, `parked`), `lastActionAt` and `notifiedAt`. It defaults to the
in-memory maps, which is how existing tests construct it. `lib/daemon.ts`
wires a `herds.db`-backed store (a new `herd_watchdog` table keyed by
party, plus marks). Two behaviors stay as they are: disabling the
watchdog clears everything, and a healthy verdict deletes the party's
ladder. A daemon restart therefore resumes a ladder at its real strike.
The class comment that calls memory "by design" changes to say so.

### `herd_diagnose {job}`

- Reads the job row and the pane's herdr status, both on the job's own
  socket.
- Lists the job's open gates: subject `herd:<id>/<job>`, plus run gates in
  its worktree. Each comes with `kind`, `presentation` and `owner`.
- Also reads the last gate's status and whether it was consumed, the
  watchdog ladder, and the budgets.
- It reads screen text only for an idle pane. The text is checked against
  Claude Code's own message lists and then dropped.

It returns `verdict`, the first of these that applies:

1. `no-pane`: the job has no pane.
2. `gone`: herdr no longer lists the pane.
3. `dead`: the pane is open but runs no claude.
4. `at-gate`: an open gate is waiting on the job; present it.
5. `parked-modal`: the job is `stuck-at-modal`.
6. `needs-human`: the pane is blocked with no gate behind it, so a prompt
   only a person can answer is up (a permission prompt, a bare form).
7. `working`.
8. `rate-limited` or `login-expired`, matched on the idle screen.
9. `idle`.

**Matching the screen.** Only the lines above the composer's bottom rule
count, the same region rule `backgroundTask` uses, with the transcript
gutter (`⎿`) trimmed.

- Rate limit: a line starting with one of Claude Code's limit prefixes,
  taken verbatim from the 2.1.301 bundle's limit list:
  - `You've hit your`
  - `You've reached your`
  - `You're out of usage credits`
  - `Your org is out of usage`
  - `Your seat type doesn't include`
  - `Your usage allocation has been disabled`
  - `Your group's usage limit is set to $0`
  - `You're out of extra usage`
  - `… requires usage credits.`

  The warning-only prefixes (`You've used`, `You're close to`) do not
  count.
- Expired login: a line with `Please run /login` or `Run /login`, or one
  starting with `Login expired`, `OAuth token revoked` or `Not logged in`.

The fixtures are those bundle strings set in a screen layout. They are not
captured screens, and the spec says so in the tests.

### `herd_nudge {job, gate}`

- The gate must be the job's: `herd:<id>/<job>`, or a run gate in its
  worktree. It must be answered, not yet consumed, and nudge the job's
  current session (a gate from a session a respawn replaced is refused as
  stale). Anything else is refused, as input validation, and nothing
  ticks.
- **Rung 0** (`used == 0`): the daemon DMs the job's handle from the
  shepherd's handle through `chat:dm`, with the body
  `call herd_answer for <gate>`.
- **Rung 1 and later:** when the pane reads idle and the job has no open
  form-presentation gate, the daemon types
  `shepherd: gate <gate> is answered; call herd_answer {gate: "<gate>"} and act on it.`
  into the pane through `injectIntoPane`. Delivery counts only when the
  injector reports `accepted`. Otherwise nothing ticks, and it returns
  `delivered: false`, `needsHuman: true` and a `why` (`pane-busy`,
  `form-open`, `pane-gone`, `not-claude`, `refused`).
- A delivered nudge ticks `nudges[gate]`. The result carries `rung`,
  `delivered`, the counter and `why`.

### `herd_lanes {job?}`

- Runs per non-closed job whose worktree exists. `job` narrows the
  returned rows. Collisions are still computed across every job.
- `base`: `remoteDefaultRef(worktree)`, such as `origin/main`.
- `commits`: `git rev-list --count <base>..HEAD`.
- `drift`: from `git diff --numstat --merge-base <base>`, which covers
  committed and uncommitted tracked changes since the merge base. It
  returns `{files: [{path, added, removed}], filesChanged, insertions,
  deletions}`.
- `collisions`: herd-wide `[{path, jobs}]`, with a per-job `collidesWith`.
- `merge`: `{forge, state: open|merged|closed|none|unknown, url, number,
  mergedAt, error?}`, read from the job's branch:
  - **GitHub:** `GitHubProvider.fetchPullRequestByBranch(projectPath,
    branch, "all")`, with the token from `forgeTokenFor`.
  - **GitLab:** `listMrsLive` with `sourceBranch` and `state: "all"`, newest
    first.

  The forge comes from the worktree's `origin` URL. A failed read is
  `unknown` with the error; it is never `none`.
- **Guests.** A guest job (row `tree: null` sharing another job's
  worktree) gets no row of its own: drift, collisions and merge state are
  measured once per worktree, on the host's row.
- `budgets.unmergedReports`: ticks for a done, non-guest job whose latest
  report reads `open`, `closed` or `none`. `merged` never ticks, and
  neither does `unknown`, so a forge outage cannot spend the budget.

The git and forge reads sit behind injectable deps in a new
`lib/daemon/herd-lanes.ts`.

### Shepherd gate answers

- `herd_gate_answer {gate, answers}` answers only a gate that
  `herd:gates` lists for this herd, open or parked (a parked gate leaves
  only by an answer or a close, as with the CLI's `--by shepherd` line). It takes no `override`: that flag
  stamps the answer as a human override, which an agent tool must not
  claim, and the shepherd session already passes the owner check for its
  own herd's gates. It posts `gate:answer` with
  `by: "shepherd"` and this session.
- It validates values against the gate's own options before posting. A bad
  value comes back as
  `{status: "refused", invalid: [{question, got, validValues}]}`.
- A recorded answer returns `{status: "recorded", gate, answer}`.
- A lost race returns `{status: "conflict", winner: {answers, by}}`.
- Closed, ownership and not-found errors keep `gate_answer`'s wording.
- `herd_gate_park {gate}` parks a gate `herd:gates` lists for this herd,
  through `gate:park`. It records no `by`: neither `gate:park` nor the gate
  row has the field, and that schema belongs to the gate-tools lane
  (gate 722599c6).

### MCP tool rules

- All seven new or changed herd tools refuse a worker pane (`HERD_JOB`)
  and run only from the herd's recorded shepherd session.
- They take the herd from input, then `HERD_ID`, then the sole active herd,
  like the others.
- `model`, `effort` and `account` keep the plain-token check.
- `brief` keeps the read-root confinement and the leading-`-` check.
- Every new tool declares `shellForms: { none: <reason> }`. A
  `rt gate park` form would make `rt skills check --strict` flag the
  skill's existing park lines before wave 3 can rewrite them, and the
  `--by shepherd` answer line is skipped by `KEPT_ON_BASH` anyway.
- `lib/mcp/tools.ts` needs no change; `herdToolDefs()` already spreads in.
  The `gate_answer` shell-form note ("the shepherd's --by shepherd answer
  stays on Bash") goes stale, but that block belongs to gate-tools. Report
  it.

### `buildPluginRoots`

- `PluginRoots` gains an optional `dirs: string[]`: the realpath of every
  installed entry whose `installPath` exists, deduplicated, in listing
  order.
- `byName` behaves as before.
- `temp-root-guard`'s plugin roots read `dirs`.
- A test pins the case that bit: a user-scope entry and a stale
  project-scope entry (whose `projectPath` is `$HOME`) for the same plugin
  both stay roots.

## Left to the builder

- Exact SQL, column order and the store method names.
- How the shared launch routine splits out of `herd:spawn`.
- How the lifecycle reaches the store to tick `blockedNotices`.
- Test layout, following the existing harnesses (`herd-handlers.test.ts`'s
  `harness`, the `fake` in `herd-tools.test.ts`, the watchdog `sensors`
  factory).
- Pruning watchdog rows for herds that are no longer active.

## Calls I made (not asked)

- Caps are constants equal to the skill's current counts, not settings.
- Tools never refuse on a spent budget, because "make the recorded move
  once" reuses the same tool.
- Reviewer rounds count guest spawns, keyed by the host's latest
  milestone artifact.
- `herd:lanes` counts unmerged reports, once per report id.
- No `recommended` field and no `includeTail` option on `herd_diagnose`:
  the skill routes on `verdict`.
- Merge state carries `mergedAt` and no merge sha; neither provider
  exposes one today.
- `herd_respawn` requires a registered tree path, so a CLI `--dir` job is
  respawned from the CLI.
- No new CLI verbs. Model, effort and account appear in status JSON as
  additive fields.
