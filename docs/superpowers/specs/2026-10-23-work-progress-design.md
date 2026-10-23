# work-progress: one progress view for any long-running work

## Intent

`mattstack:herd-progress` renders a good view of a herd: header, overall bar,
one table row per job with spec/plan/exec/review marks, a task bar and a "now"
signal. Matt wants that same view for any long-running work, not only herds:
a single superpowers plan running under SDD, or an epic made of several plans
(skill-blocks: one spec, four numbered plans, one branch). Today the script
needs `--herd <id>` and fails without one, so a peer had to build the epic
view by hand.

The skill is renamed `mattstack:work-progress` and becomes the one place an
agent goes for "where is this work at".

## Goals

- One skill, `work-progress`, that renders a herd, one plan, or several plans
  as one view, in today's format.
- A finished plan still reads as done after SDD deletes its workspace
  (`references/final-review.md` in superpowers SDD: `rm -rf <workspace>` once
  the final review is clean).
- Matt's statusline and work-progress read the same record of plans, so they
  never disagree about whether a plan finished.

## Non-goals

- Progress for a `direct-tdd` or `trivial` job outside a herd. With no brief
  and no report draft there is nothing to count; the skill says so in one line.
- An alias. `herd-progress` is removed, not kept as a pointer.
- rt deciding what an epic is. The script never groups plans on its own.

## Anti-goals

- rt watching or managing agents. rt records facts a hook hands it and answers
  queries; it never drives a loop (rt's boundary: a subroutine layer of fast
  JSON verbs for skills).
- A second hand-rolled state format beside rt's state db.
- A view that claims done for a plan that was abandoned or whose tree was
  disposed.

## Decisions Matt made

| Question | Ruling |
| --- | --- |
| Input | Nothing. The calling agent knows what it is working on and decides what to show: a herd id, or the plan paths that make up its work. The SKILL.md teaches it how to pick. |
| Epic grouping | Flexible, the agent's call. No prefix or spec rule in code. |
| Done signal once the ledger is gone | One shared record, written while ledgers are live, read by both work-progress and the statusline. |
| Who owns the record | rt (state db plus verbs). Chosen over a file format written from bash and Python, and over the Python script owning it. |
| Alias | Clean rename, no alias. |
| Solo direct-tdd / trivial | Out of scope. |

## Approaches considered

1. **File format plus a plugin hook.** One file per plan under `~/.mattstack`,
   written by a hook and by the statusline in bash, read by Python. No rt
   release. Rejected: no other durable fact in `~/.mattstack` is a hand-rolled
   file written from two languages; plugin hooks only write throwaway stamps
   in `$TMPDIR` and reach real state through rt.
2. **The Python script owns the record and the statusline calls it.** One
   implementation, but a skill script would own durable state (no precedent),
   and the statusline would run a script from a versioned plugin cache path
   every render.
3. **rt owns it (chosen).** A `kv` namespace in `~/.mattstack/rt/state.db`
   behind two verbs. The plugin hook records through rt and fails open, the
   way `hooks/pipeline-gate-stop.sh` already reaches runs. The script reads
   through rt's JSON, the way `herd_progress.py` already reads herds. Costs:
   ships with an rt release, so the plugin's engine floor rises; each rt call
   pays a bun start-up.

## Design

### 1. rt: the plan record

A `kv` namespace (`lib/state/kv-blob.ts`), so no `SCHEMA_VERSION` claim.
One record per (tree, plan stem):

| Field | Meaning |
| --- | --- |
| `tree` | absolute worktree root the ledger lives in |
| `branch` | the tree's branch when last recorded |
| `plan` | the plan file path from the ledger's first line |
| `stem` | the workspace directory name (`.superpowers/sdd/<stem>`) |
| `done`, `total` | finished tasks and the plan's `Task N` heading count |
| `latest` | the ledger's latest meaningful line |
| `firstSeen`, `lastSeen` | epoch ms |
| `finishedAt` | epoch ms, set by `record` when it sees the ledger directory gone while the tree is still on `branch`; null until then |

Two verbs (names are my call; the builder may rename to fit the command tree):

- `rt progress record --tree <root>`: scans `<root>/.superpowers/sdd/*/progress.md`,
  parses each with the same rules the script uses today, and upserts its record.
  Silent on success, `--json` for tests. Cheap when there is no `.superpowers/sdd`.
  For every existing record of that tree whose ledger directory is now gone:
  if the tree's current branch equals the record's `branch`, it sets
  `finishedAt` (SDD deletes the workspace only after a clean final review).
  Done is therefore stored at the moment it is observed, and survives the tree
  later moving to another branch or being disposed.
- `rt progress list [--tree <root>] [--plan <path>] [--refresh] --json`:
  `--refresh` runs `record` for the named tree first, so the caller gets
  fresh live counts from the same parser in one call. Each record carries a
  `state`:
  - `done`: `finishedAt` is set. Reports `done = total`.
  - `running`: the ledger directory exists.
  - `tree-gone`: no `finishedAt`, and the tree is gone or now on a different
    branch (a pool tree disposed and re-provisioned at the same path). Shown
    with the last counts, never as done.

No `FINAL`-line rule: superpowers SDD 7.0.1 never writes one. The statusline's
`^FINAL` check is a leftover and is dropped with the rest of its state code.

Retention: a record not seen for 30 days is dropped on the next `record`.
My call; adjust freely.

Ledger parsing moves into rt (one implementation), and the Python script and
statusline stop parsing finished plans. Split sub-tasks (`Task 8a: complete`,
`Task 8b: complete`) count Task 8 done only when `Task 8: complete` appears or
every lettered part of 8 does. Today's script regex ignores lettered lines.

### 2. Plugin hook: recording

A `PostToolUse` entry in `plugins/mattstack/hooks/hooks.json` running a small
`sh` script:

- Throttled per session (a stamp in `$TMPDIR`, like `inject-time.sh`), at most
  once a minute.
- Resolves the session's tree from the hook input's `cwd` (git toplevel) and
  runs `rt progress record --tree <root>` only when `<root>/.superpowers/sdd`
  exists.
- Fails open on every path: no rt, old rt without the verb, no python, slow
  disk. Exit 0, no output.

The last task's completion and the workspace delete can land inside one
throttle window, so the final recorded count may lag. That is fine: `done` is
decided by "tree present, ledger gone", not by the count.

### 3. The script: `work_progress.py`

Renamed from `herd_progress.py`, in `plugin/skills/work-progress/scripts/`.

- `--herd <id>`: today's behaviour, unchanged, except a ledger-method job whose
  ledger is gone gets its counts from `rt progress list --tree <job tree>`.
- `--plan <path>` (repeatable), with optional `--title <text>`: one row per
  plan, in the order given.
  - Optional `--tree <root>` names the tree that runs the plans when it is not
    the tree holding the plan file (a herd worker running a plan committed on
    main). Default: the plan file's own tree. Records match on tree plus plan
    stem; no cross-tree stem matching.
  - Counts come from one `rt progress list --tree <root> --refresh --json`
    call per tree, so the script never parses ledgers itself. `done` → done
    row with `total/total`. `tree-gone` → its own status with the last counts.
    No record → not started, `0/<plan task count>`.
  - rt too old for the verb: fall back to today's in-script ledger parse for
    live plans, and show a plan with no ledger as `not started or finished (rt
    has no record)`. No guessing.
- Neither flag: exit non-zero with a one-line reason telling the agent to name
  a herd or plans.

Plan-row view, matching the herd view's shape:

```
**skill-blocks** · branch skill-blocks-design · worktree thorin · 19 of 40 tasks done · nothing stuck

Overall `█████████░░░░░░░░░░░` 48%

| plan | status | spec | plan | exec | review | tasks | now |
```

- spec: ✓ when the plan names a spec that exists, else `·`.
- plan: ✓ (the file exists).
- exec: ▸ while the ledger is live, ✓ once done.
- review: ✓ when done, ▸ when every task is complete and the ledger is live.
- status: running, done, not started, *quiet* (ledger untouched 30+ minutes,
  like today's "ledger quiet"), tree gone.
- now: the ledger's latest line, with `Ruling:` and fix-round lines surfaced
  the way lawson's hand-built view did.

The overall bar for plans is by tasks; for a herd it stays by finished jobs.

### 4. The skill: `work-progress/SKILL.md`

Rewritten through `superpowers:writing-skills` (RED baseline, GREEN) and
`mattstack:editing-skills`:

- How the agent picks the input: a shepherd names its herd (`herd_list` when it
  does not know the id). An agent on a plan or epic passes the plan paths it is
  working through, grouping them as its own context says (one spec's plans, a
  numbered family, everything on the branch) and naming the group with
  `--title`.
- The reply rules from today (verbatim output, one or two lines on rows that
  need the user) carry over, extended to plan statuses.
- The description triggers on progress, status, "where is X at" for a herd, a
  plan or an epic, so "herd progress" still triggers it.
- Solo direct-tdd/trivial: one line saying there is nothing to measure.

### 5. Matt's statusline

`~/.claude/statusline-command.sh` keeps reading the live ledger itself (cheap,
every render), with its task regex updated to the same lettered sub-task rule.
Its finished-plan memory in `~/.claude/statusline-state/` is replaced by
`rt progress list --tree <root> --json`, called only when no live ledger is
found AND `<root>/.superpowers/sdd` exists (SDD removes only the plan's own
folder), so trees that never ran SDD pay no bun start-up. A plan rt calls done
shows ✅ for a day, as today. The state folder and the `^FINAL` check are
removed.

Matt chose this edit (the "share one record" option named it). The
implementer edits the file on Matt's machine as a plan task: copy the current
file to the session scratchpad first, then verify by rendering the statusline
in a tree with a live ledger, a finished plan and no SDD at all.

### 6. Rename touchpoints

From `git grep herd-progress`, excluding `docs/superpowers/tests/` (history):
`plugins/mattstack/.claude-plugin/plugin.json`, `surface.jsonc`,
`CERTIFICATION.md`, `tests/desc-test-scenarios.json`,
`lib/skills/__tests__/sources.test.ts`,
`attachments/orchestration/shepherdr/SKILL.md` and the compiled
`skills/shepherdr/SKILL.md`.

The shepherdr edit is the name only. lawson's `skill-blocks-design` branch
turns shepherdr into a block tree (the line lives in
`what-the-watch-loop-cannot-show.block.md` there), so the exact changed line is
DMed to lawson to carry over at merge.

### 7. Release and versions

- rt verbs and the hook ship together; the plugin's `minEngine` rises to the rt
  version that has `rt progress`. The script and hook still work below it,
  with the fallback above.
- `plugin.json` is bumped one past main right before merging (lawson's branch
  also bumps it; whoever merges second re-bumps).
- Targeted tests only locally: the new store and verbs, the hook script,
  `sources.test.ts`, the script against fixture trees. `certify.sh` and
  `rt skills check --strict` for the plugin.

## Calls I made after the builder check

- Tree reuse: done is stored when observed (`finishedAt`, same branch), and a
  tree that is gone or on another branch without it reads `tree-gone`.
- One parser: rt parses ledgers for the script (`--refresh`); the statusline
  keeps a live bash parse with the same lettered rule, since it renders every
  turn.
- Cross-tree plans: an explicit `--tree`, no stem matching across trees.
- Statusline cost: rt is called only when `.superpowers/sdd` exists.
- `FINAL` lines are not a signal.

## Left to the builder

- Exact verb and namespace names, flag spellings and JSON shape.
- Hook matcher (all tools or Bash only) and the throttle interval.
- Whether `record` also runs from the daemon's existing worktree sweep. Allowed
  only if it stays a plain scan, never agent watching.
- Fixture design for the script tests.
