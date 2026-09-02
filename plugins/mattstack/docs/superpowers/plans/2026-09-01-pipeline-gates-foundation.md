# Pipeline Gates, Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pieces every later gate stands on: the wrap-up include and its compiled door, the Stop hook that blocks a mid-run turn from ending in prose, the gate contract text, `RT_RUN_DB` teardown at close, and the retirement of the personal wrap-up skill.

**Architecture:** One attachment (`attachments/wrap-up/SKILL.md`) is both an include target for engines and the engine of a compiled public door (`skills/wrap-up/`). A plugin-shipped `Stop` hook finds this session's running run through `rt runs snapshot` and exits 2 when the turn would end without a form. The contract text lands in the convention reference as stage contract v3. Gate sites in engines are plan 2; standalone verbs as runs are plan 3.

**Tech Stack:** Markdown skills with YAML frontmatter; `rt skills compile` (Bun, repo-tools); POSIX `sh` plus `python3` for the hook (the doorbell hook's pattern); bash for hook tests; `tests/certify.sh`, `tests/repo-purity.sh`, `bun tests/desc-test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-01-pipeline-gates-design.md` (sections 1, 2, 5, 6, Plans, Testing, Release order). Executors read the spec's section for each task before starting it.

## Global Constraints

- Every skill directory touched passes `sh tests/certify.sh <dir>` (exit 0) and the tree passes `sh tests/repo-purity.sh`. The certify gate bans the word `Matt` (word-boundary), `/Users/matt`, and the domain terms; write "the user" and use `$HOME`.
- No em dashes or en dashes anywhere (certify fails on them). Use a comma, a colon, or parentheses.
- An include target is a flat `attachments/<name>/SKILL.md` with `type: pipeline-step`, NO `slots` key at all (an empty `slots: {}` is rejected by the compiler's `loadInclude`), and no `{{` anywhere in its body.
- Compile-native engines under `attachments/` may carry `{{placeholder}}` markers; nothing under `plugin/skills/` or `hooks/` may contain `{{`.
- Work in the worktree `.worktrees/pipeline-gates` (branch `pipeline-gates`, rebased onto `main` at 0.10.16). Commit after every task; push after every commit (`git push`).
- Follow superpowers:writing-skills for every skill edit: baseline (RED) before the text exists, verify (GREEN) after. Follow the clean-code comment rule: script comments state constraints, never narrate lines.
- The hook never writes to stdout and fails open (exit 0) on every error path except the one designed block (exit 2 with the message on stderr).
- The `rt` binary is `command -v rt || $HOME/.local/bin/rt`; never assume PATH inside a hook.

---

### Task 1: Probe: does a Stop hook fire while AskUserQuestion is waiting?

This task needs a human at an interactive terminal (a form has to be answered). A subagent cannot run it; the executor sets it up and the operator drives the session. If the probe fails, STOP the plan and report: section 5 of the spec is redesigned before anything else is built.

**Files:**
- Create: `$HOME/.mattstack/probe/stop-hook-settings.json` (temporary, outside the repo)
- Create: `$HOME/.mattstack/probe/stop.log` (written by the probe hook)
- Modify: `docs/superpowers/specs/2026-09-01-pipeline-gates-design.md` (section 5, one sentence recording the result)

**Interfaces:**
- Produces: the verified fact the hook in Task 4 relies on (Stop does not fire during a pending `AskUserQuestion`), or a stop signal for the plan.

- [ ] **Step 1: Write the probe settings file**

```bash
mkdir -p "$HOME/.mattstack/probe"
cat > "$HOME/.mattstack/probe/stop-hook-settings.json" <<'EOF'
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh -c 'printf \"%s %s\\n\" \"$(date +%H:%M:%S)\" \"$(cat)\" >> \"$HOME/.mattstack/probe/stop.log\"'",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
: > "$HOME/.mattstack/probe/stop.log"
```

- [ ] **Step 2: Start a fresh interactive session with the probe hook, in a second terminal**

Run (operator, in a terminal, not inside another Claude session):

```bash
cd "$HOME" && claude --settings "$HOME/.mattstack/probe/stop-hook-settings.json"
```

Type this prompt verbatim:

```
Call the AskUserQuestion tool with exactly one question ("Probe: pick one") that has two options, A and B. Do not write anything before the tool call. After I answer, reply with the single word done.
```

- [ ] **Step 3: While the form is on screen, read the log from the first terminal**

Run: `cat "$HOME/.mattstack/probe/stop.log"; echo "lines: $(wc -l < "$HOME/.mattstack/probe/stop.log")"`
Expected: `lines: 0`. A non-zero count here means Stop fired with the form up: record it, answer the form, exit the session, and stop the plan (report to the operator with the log contents).

- [ ] **Step 4: Answer the form (pick A), wait for "done", read the log again**

Run: `cat "$HOME/.mattstack/probe/stop.log"; echo "lines: $(wc -l < "$HOME/.mattstack/probe/stop.log")"`
Expected: `lines: 1`, and the line contains `"hook_event_name":"Stop"` and `"stop_hook_active":false`. Exit the probe session (`/exit`).

- [ ] **Step 5: Record the result in the spec**

In section 5 of the spec, replace the paragraph that begins `**Prerequisite probe, before any of this is built.**` with:

```markdown
**Prerequisite probe, run 2026-09-DD.** A temporary user-level Stop hook
logging its stdin recorded zero Stop events while an `AskUserQuestion` was
on screen and exactly one after the answer and the final message, with
`stop_hook_active` false. The design's premise holds on the runtime this
estate runs.
```

(Write the real date.)

- [ ] **Step 6: Remove the probe files and commit**

```bash
rm -rf "$HOME/.mattstack/probe"
cd /Users/matt/Documents/GitHub/mattstack-skills/.worktrees/pipeline-gates
git add docs/superpowers/specs/2026-09-01-pipeline-gates-design.md
git commit -m "spec: Stop hook probe run; the hook does not fire during a pending form"
git push
```

---

### Task 2: The wrap-up include

**Files:**
- Create: `attachments/wrap-up/SKILL.md`
- Test: `sh tests/certify.sh attachments/wrap-up`; a RED/GREEN subagent pair (below)

**Interfaces:**
- Produces: the include name `wrap-up`, referenced by engines as `{{include:wrap-up}}` (plan 2) and by `pack/stubs.jsonc` as `"engine": "wrap-up"` (Task 3).

- [ ] **Step 1: RED, baseline without the include**

Dispatch one fresh general-purpose subagent (no model override) with exactly this prompt and record its reply verbatim in `docs/superpowers/plans/red-wrap-up-baseline.md` (this file is committed as evidence and is not a skill; it must not contain the word `Matt`):

```
You are finishing a task for a user who is in a hurry and said "be quick". You have set up a local HTTPS app but three things are undecided: the port (8787 or 3000), whether to publish it publicly, and the domain slug ("local-app" or "training"). Two steps remain: running `lcl add`, and a health check. You have the AskUserQuestion tool available. Write your final reply to the user now, exactly as you would send it. Do not explain your reasoning; produce the reply only.
```

Expected: the reply is prose or a list, not a tool call (that is the failure this include fixes). If the subagent calls AskUserQuestion unprompted, run it once more with "You have already spent a long time on this and the user asked for a quick summary" appended; record both. Note every sentence that justifies prose (those are rationalization rows).

- [ ] **Step 2: Write the include**

Create `attachments/wrap-up/SKILL.md` with exactly this content, then add one rationalization row per distinct justification the RED reply used that the table does not already cover:

````markdown
---
name: wrap-up
description: "Use when wrapping up a session, checking in before continuing, ending a turn with open decisions, when the user asks what you need from them, what decisions are open, or what the next steps are, when they invoke wrap-up or check-in, or when a pipeline gate needs its decision presented as a form."
type: pipeline-step
---

# Wrap-up

The reply is one optional sentence of context, then a form, then stop. Wait
for the answers before doing more work.

The form is this runtime's structured-question tool (`AskUserQuestion` in
Claude Code). One question per open item, in three buckets; omit an empty
bucket:

| Bucket | The question is | Options |
|---|---|---|
| Important details | a confirmation or pick among facts that still matter | concrete values |
| Decisions | a choice only the user can make | the real alternatives, recommended first and labelled `(Recommended)` |
| Next steps | whether or in what order to do remaining work | do now / later / skip |

Single or multiple choice as the item needs. If the tool caps how many
questions fit in one call, fill the first call and wait; the rest go in the
next call after the answers return, never into the context sentence.

| Thought | Reality |
|---|---|
| "A summary with the options listed is just as clear" | A list is text the user has to type back. The form is the answer channel. |
| "They asked me to be quick, so a compact list" | The form is the quick version: one tap per item. |
| "The options are obvious, prose is faster" | Obvious to you. The form records which one they picked. |
| "Next steps can go in prose after the form" | Next steps are questions: do now / later / skip. |
````

- [ ] **Step 3: Certify and check the word budget**

Run: `sh tests/certify.sh attachments/wrap-up && awk 'f{print} /^---$/{c++; if(c==2) f=1}' attachments/wrap-up/SKILL.md | wc -w`
Expected: every line `ok`, exit 0, and a body of about 300 words or fewer on this measure, 320 at most (the spec's "two hundred" counts prose; `wc -w` also counts every table pipe, and each RED row adds about twenty).

- [ ] **Step 4: GREEN, the same scenario with the include**

Dispatch one fresh general-purpose subagent with the Step 1 prompt, prefixed by the include's body (everything after the frontmatter) under the heading `Your standing instruction:`. Expected: the reply is an `AskUserQuestion` call with three or four questions (port, publish, slug, next steps), recommended options labelled, nothing after it. Append the result to `docs/superpowers/plans/red-wrap-up-baseline.md` under `## GREEN`. If it still writes prose, read its justification, add the row, and rerun; do not proceed until it complies.

- [ ] **Step 5: Commit**

```bash
git add attachments/wrap-up/SKILL.md docs/superpowers/plans/red-wrap-up-baseline.md
git commit -m "wrap-up: add the form-contract include"
git push
```

---

### Task 3: The compiled door

Execution note (2026-09-01): the include source was moved to
`attachments/wrap-up-form/` and the stub's engine points there, because the
compiler removes `attachments/<verb>/` before writing a public verb (the
ledger records the ruling). Read `attachments/wrap-up/` below as
`attachments/wrap-up-form/` and the include as `{{include:wrap-up-form}}`.

**Files:**
- Modify: `pack/stubs.jsonc` (add the `wrap-up` verb)
- Modify: `surface.jsonc` (add `"wrap-up"` to `public`)
- Create (by the compiler): `skills/wrap-up/SKILL.md`
- Modify: `tests/desc-test-scenarios.json` (two scenarios)
- Test: `rt skills check --pack mattstack ...`, `sh tests/certify.sh skills/wrap-up`, `bun tests/desc-test.ts`

**Interfaces:**
- Consumes: `attachments/wrap-up/SKILL.md` from Task 2.
- Produces: the public skill `mattstack:wrap-up`, invocable as `/mattstack:wrap-up`; the stub's description is the door's description.

- [ ] **Step 1: Add the verb to the pack roster**

Edit `pack/stubs.jsonc` so the `verbs` object reads (the `shepherdr` entry unchanged, `wrap-up` added after it, comments preserved):

```jsonc
    "shepherdr": {
      "engine": "shepherdr",
      "description": "Use when fanning work out across parallel Claude Code agents in herdr panes in a repo no team pack covers -- 'shepherdr', 'fan out', 'spawn agents', 'split this across agents', 'run these in parallel', 'spread this across my accounts'. Domain-unbound: where a team pack compiles its own shepherdr, that verb wins. Requires a running herdr instance."
    },
    "wrap-up": {
      "engine": "wrap-up",
      "description": "Use when wrapping up a session, checking in before continuing, ending a turn with open decisions, when the user asks what you need from them, what decisions are open, or what the next steps are, when they invoke wrap-up or check-in, or when a pipeline gate needs its decision presented as a form."
    }
```

- [ ] **Step 2: Add the door to the public surface**

Edit `surface.jsonc` so the list reads:

```jsonc
  "public": [
    "subagent-review-loop",
    "editing-skills",
    "getting-current-time",
    "shepherdr",
    "wrap-up"
  ]
```

- [ ] **Step 3: Dry-run the compile from the worktree**

`--pack-dir` and `--mattstack-dir` are hidden flags (`commands/skills.ts` in repo-tools calls them test-only escape hatches); both point at this worktree so the compiler reads the branch's engines, not the canonical checkout's.

Run:

```bash
W="$PWD"
rt skills compile --pack mattstack --verb wrap-up --pack-dir "$W" --mattstack-dir "$W" --dry-run --json
```

Expected: a JSON result whose row for the verb reads `{"name":"wrap-up","status":"compiled","files":[{"path":"SKILL.md"}],"side":"skills"}` (the `side` says it lands under `skills/`), no error. An error mentioning `loadInclude` or `slots` means the include's frontmatter has a `slots` key; remove it. An error that `wrap-up` is not found under `attachments/*` means the directory name or `type: pipeline-step` is wrong.

- [ ] **Step 4: Compile for real and inspect the door**

```bash
rt skills compile --pack mattstack --pack-dir "$W" --mattstack-dir "$W"
sed -n 1,12p skills/wrap-up/SKILL.md
grep -c '{{' skills/wrap-up/SKILL.md || true
grep -n 'disable-model-invocation' skills/wrap-up/SKILL.md || echo "invocable: yes"
rt skills check --pack mattstack --pack-dir "$W" --mattstack-dir "$W"
```

Expected: the frontmatter has `name: "wrap-up"`, the stub's description, and `metadata.compiled: "mattstack@<the version in .claude-plugin/plugin.json, 0.10.16 today>"`; the `{{` count is 0; `invocable: yes` (the door must stay model-invocable; if the compiler copied a `disable-model-invocation` line, the include source must not carry one); `check` reports every verb `current`.

- [ ] **Step 5: Certify the door and add the selection scenarios**

Append to the array in `tests/desc-test-scenarios.json` (keep valid JSON, comma after the previous last object):

```json
  {
    "task": "Give me a wrap-up: what decisions are still open and what do you need from me",
    "expect": "wrap-up"
  },
  {
    "task": "Check in before you continue; what is left and what should I decide",
    "expect": "wrap-up"
  }
```

Run: `sh tests/certify.sh skills/wrap-up && bun tests/desc-test.ts --reps 5`
Expected: certify exit 0; every rep of every scenario picks its expected skill. A miss on a wrap-up scenario means the description lost a trigger: tighten the stub description (and the include's, they are the same text) and recompile; a miss on another skill's scenario means the new description shadows it: narrow the wrap-up description.

- [ ] **Step 6: Purity sweep and commit**

```bash
sh tests/repo-purity.sh
git add pack/stubs.jsonc surface.jsonc skills/wrap-up tests/desc-test-scenarios.json
git commit -m "wrap-up: compile the public door from the include"
git push
```

---

### Task 4: The Stop hook

**Files:**
- Create: `hooks/pipeline-gate-stop.sh`
- Create: `hooks/tests/test-pipeline-gate-stop.sh`
- Modify: `hooks/hooks.json` (add the `Stop` entry)
- Modify: `hooks/README.md` (one table row under the plugin-delivered table)

**Interfaces:**
- Consumes: `rt runs find --session <id> --running` JSON: `{ok:true, runs:[{repo, runId, runDb, status, current_stage, started_at, ended_at}]}` newest first (rt PR #175; an older rt without the verb prints a run listing instead, which is the fallback signal); `rt runs snapshot` JSON: `{ok, run:{id, status, current_stage, started_at, ...}, stages:[{name, status, attempt, started_at, ...}], fields:[{key, value, at, ...}], decisions:[...]}`; the hook's stdin: `{session_id, stop_hook_active, ...}`.
- Produces: exit 2 with the block message on stderr when this session's run is `running` and not held; exit 0 otherwise.

- [ ] **Step 1: Write the failing tests**

Create `hooks/tests/test-pipeline-gate-stop.sh`:

```bash
#!/usr/bin/env bash
# Offline tests for pipeline-gate-stop.sh.
#
# `rt` is stubbed: `rt runs snapshot` prints the JSON stored beside the run's
# state.db (state.db.snapshot.json), so each case controls exactly what the
# hook sees. Nothing here touches the real runs root or the real rt.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../pipeline-gate-stop.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/runs"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
[ -f "${RT_STUB_USAGE:-/nonexistent}" ] && { echo "usage: rt runs ..."; exit 2; }
if [ "$1" = "runs" ] && [ "$2" = "find" ]; then
  # With the find fixture present, behave like rt >= PR 175; without it,
  # behave like an older rt whose dispatcher falls through to the listing.
  if [ -f "${RT_STUB_FIND:-/nonexistent}" ]; then cat "$RT_STUB_FIND"; exit 0; fi
  echo "RUN            REPO   STATUS"; exit 0
fi
[ "$1" = "runs" ] && [ "$2" = "snapshot" ] || exit 2
cat "$RT_RUN_DB.snapshot.json"
STUB
chmod +x "$SANDBOX/bin/rt"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

mkrun() { # repo runId status session [hold_value hold_at] -> writes a fixture run
  local d="$SANDBOX/runs/$1/$2"; mkdir -p "$d"; : > "$d/state.db"
  local hold=""
  [ -n "${5:-}" ] && hold=",{\"key\":\"hold\",\"value\":\"$5\",\"produced_by\":\"work\",\"at\":$6}"
  cat > "$d/state.db.snapshot.json" <<EOF
{"ok":true,
 "run":{"id":"$2","repo":"$1","work_type":"feature","pipeline":"feature","status":"$3","current_stage":"ship","started_at":${7:-1000}},
 "stages":[{"name":"plan","status":"done","attempt":1,"started_at":1000},{"name":"ship","status":"running","attempt":1,"started_at":2000}],
 "fields":[{"key":"claude-session","value":"$4","produced_by":"run","at":1000}$hold],
 "decisions":[]}
EOF
}

run() { # stdin-json -> "exit=<code> err=<stderr first line> out=<stdout>"
  local out err code
  out="$(printf '%s' "$1" | env -i HOME="$SANDBOX/home" PATH="$SANDBOX/bin:/usr/bin:/bin" RT_RUNS_ROOT="$SANDBOX/runs" ${RT_STUB_USAGE:+RT_STUB_USAGE="$RT_STUB_USAGE"} ${RT_STUB_FIND:+RT_STUB_FIND="$RT_STUB_FIND"} sh "$HOOK" 2>"$SANDBOX/err")"
  code=$?
  err="$(head -1 "$SANDBOX/err" 2>/dev/null)"
  printf 'exit=%s err=%s out=%s' "$code" "$err" "$out"
}

SID="11111111-2222-3333-4444-555555555555"
STOP="{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":false}"
STOP_ACTIVE="{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":true}"

# No runs root at all: silent.
rm -rf "$SANDBOX/runs"
check "no runs root exits 0" "exit=0 err= out=" "$(run "$STOP")"
mkdir -p "$SANDBOX/runs"

# No run matches this session: silent.
mkrun repo-a 20260901-000001-aaaa-1 running other-session
check "other session's run exits 0" "exit=0 err= out=" "$(run "$STOP")"

# This session's running run: blocked, message names the run and the stage.
mkrun repo-a 20260901-000002-bbbb-2 running "$SID"
r="$(run "$STOP")"
case "$r" in exit=2*20260901-000002-bbbb-2*) echo "ok   running run exits 2 naming the run";; *) echo "FAIL running run exits 2 naming the run"; echo "       got : $r"; fails=$((fails+1));; esac
case "$r" in *"stage \`ship\`"*) echo "ok   message names the stage";; *) echo "FAIL message names the stage"; fails=$((fails+1));; esac
case "$r" in *"Four exits"*) echo "ok   message lists the exits";; *) echo "FAIL message lists the exits"; fails=$((fails+1));; esac
case "$r" in *"out=") echo "ok   no stdout on block";; *) echo "FAIL no stdout on block"; fails=$((fails+1));; esac

# stop_hook_active does not open a side door.
r="$(run "$STOP_ACTIVE")"
case "$r" in exit=2*) echo "ok   stop_hook_active still exits 2";; *) echo "FAIL stop_hook_active still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac

# A finished run is not this session's problem.
rm -rf "$SANDBOX/runs/repo-a/20260901-000002-bbbb-2"
mkrun repo-a 20260901-000003-cccc-3 done "$SID"
check "done run exits 0" "exit=0 err= out=" "$(run "$STOP")"

# Two matching running runs: the newer started_at is the one named.
mkrun repo-a 20260901-000004-dddd-4 running "$SID" "" "" 5000
mkrun repo-a 20260901-000005-eeee-5 running "$SID" "" "" 9000
r="$(run "$STOP")"
case "$r" in exit=2*20260901-000005-eeee-5*) echo "ok   newest of two matches is named";; *) echo "FAIL newest of two matches is named"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000004-dddd-4" "$SANDBOX/runs/repo-a/20260901-000005-eeee-5"

# A held run (hold newer than the latest stage start, not the cleared sentinel) may end its turn.
mkrun repo-a 20260901-000006-ffff-6 running "$SID" "parked for the night" 3000
check "held run exits 0" "exit=0 err= out=" "$(run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000006-ffff-6"

# A cleared hold (`-`) does not count.
mkrun repo-a 20260901-000007-gggg-7 running "$SID" "-" 3000
r="$(run "$STOP")"
case "$r" in exit=2*) echo "ok   cleared hold still exits 2";; *) echo "FAIL cleared hold still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000007-gggg-7"

# A stale hold (older than the latest stage start) does not count.
mkrun repo-a 20260901-000008-hhhh-8 running "$SID" "old" 1500
r="$(run "$STOP")"
case "$r" in exit=2*) echo "ok   stale hold still exits 2";; *) echo "FAIL stale hold still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000008-hhhh-8"

# A run dir untouched for more than 48 hours is not scanned.
mkrun repo-a 20260901-000009-iiii-9 running "$SID"
touch -t 202601010000 "$SANDBOX/runs/repo-a/20260901-000009-iiii-9/state.db"
check "old run dir is not scanned" "exit=0 err= out=" "$(run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000009-iiii-9"

# With `rt runs find` available, the scan is skipped: an old run dir the scan
# would ignore is still found through find, and a run find does not return is
# not blocked even though the scan would see it.
mkrun repo-a 20260901-000011-kkkk-11 running "$SID"
touch -t 202601010000 "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11/state.db"
printf '{"ok":true,"runs":[{"repo":"repo-a","runId":"20260901-000011-kkkk-11","runDb":"%s","status":"running","current_stage":"ship","started_at":1000,"ended_at":null}]}' "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11/state.db" > "$SANDBOX/find.json"
r="$(RT_STUB_FIND="$SANDBOX/find.json" run "$STOP")"
case "$r" in exit=2*20260901-000011-kkkk-11*) echo "ok   find result is used over the scan";; *) echo "FAIL find result is used over the scan"; echo "       got : $r"; fails=$((fails+1));; esac
mkrun repo-a 20260901-000012-llll-12 running "$SID"
printf '{"ok":true,"runs":[]}' > "$SANDBOX/find-empty.json"
check "empty find result exits 0 without scanning" "exit=0 err= out=" "$(RT_STUB_FIND="$SANDBOX/find-empty.json" run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11" "$SANDBOX/runs/repo-a/20260901-000012-llll-12" "$SANDBOX/find.json" "$SANDBOX/find-empty.json"

# rt printing usage instead of JSON: silent.
mkrun repo-a 20260901-000010-jjjj-10 running "$SID"
: > "$SANDBOX/usage-flag"
RT_STUB_USAGE="$SANDBOX/usage-flag" r="$(RT_STUB_USAGE="$SANDBOX/usage-flag" run "$STOP")"
check "rt printing usage exits 0" "exit=0 err= out=" "$r"
rm -f "$SANDBOX/usage-flag"

# rt missing entirely: silent.
mv "$SANDBOX/bin/rt" "$SANDBOX/bin/rt.off"
check "rt missing exits 0" "exit=0 err= out=" "$(run "$STOP")"
mv "$SANDBOX/bin/rt.off" "$SANDBOX/bin/rt"

# Malformed and empty stdin: silent.
check "malformed stdin exits 0" "exit=0 err= out=" "$(run 'not json')"
check "empty stdin exits 0" "exit=0 err= out=" "$(run '')"

[ "$fails" -eq 0 ] && echo "all pipeline-gate-stop tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `chmod +x hooks/tests/test-pipeline-gate-stop.sh && hooks/tests/test-pipeline-gate-stop.sh`
Expected: every case FAILs (the hook file does not exist yet, so `sh` exits 127 with an error on stderr for every payload, so even the exit-0 cases see a non-empty `err=`); the script ends with a failure count.

- [ ] **Step 3: Write the hook**

Create `hooks/pipeline-gate-stop.sh`:

```sh
#!/bin/sh
# Stop hook: a session whose pipeline run is still `running` cannot end its
# turn in prose. Exit 2 blocks the stop and hands stderr to Claude as the
# instruction to continue; every other path exits 0 and prints nothing, so a
# broken rt or a slow disk can never trap a session. Claude Code's own cap
# (eight consecutive blocks) is the loop guard; stop_hook_active is
# deliberately not honoured, or the second stop would slip through in prose.
set -u

INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

ROOT="${RT_RUNS_ROOT:-$HOME/.mattstack/runs}"
[ -d "$ROOT" ] || exit 0

SESSION="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("session_id") or "")
except Exception:
    pass
' 2>/dev/null)"
[ -n "$SESSION" ] || exit 0

START=$(date +%s)

# `rt runs find` (rt >= PR 175) answers the session question directly, newest
# first. An older rt falls through to the run listing, which is not JSON with
# ok:true, so the candidates come from a directory scan instead: run dirs
# written in the last 48 hours, since a snapshot costs a bun start-up each and
# the budget below is three seconds in total.
CANDIDATES="$("$RT" runs find --session "$SESSION" --running 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
if d.get("ok") is not True or not isinstance(d.get("runs"), list):
    raise SystemExit(1)
for r in d["runs"]:
    if isinstance(r, dict) and r.get("runDb"):
        print(r["runDb"])
' 2>/dev/null)"
FOUND=$?
if [ "$FOUND" -ne 0 ]; then
  CANDIDATES="$(find "$ROOT" -mindepth 3 -maxdepth 3 -name state.db -mmin -2880 2>/dev/null)"
fi

BEST=""
for DB in $CANDIDATES; do
  [ $(( $(date +%s) - START )) -lt 3 ] || break
  [ -f "$DB" ] || continue
  SNAP="$(RT_RUN_DB="$DB" "$RT" runs snapshot 2>/dev/null)" || continue
  LINE="$(printf '%s' "$SNAP" | python3 -c '
import json, sys
sid = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
run = d.get("run") or {}
if run.get("status") != "running":
    raise SystemExit(1)
fields = {f.get("key"): f for f in (d.get("fields") or []) if isinstance(f, dict)}
if (fields.get("claude-session") or {}).get("value") != sid:
    raise SystemExit(1)
last_start = max([int(s.get("started_at") or 0) for s in (d.get("stages") or [])] or [0])
hold = fields.get("hold") or {}
held = hold.get("value") not in (None, "", "-") and int(hold.get("at") or 0) > last_start
print("%d|%s|%s|%s" % (int(run.get("started_at") or 0), run.get("id") or "?", run.get("current_stage") or "unknown", "held" if held else "open"))
' "$SESSION" 2>/dev/null)" || continue
  [ -n "$LINE" ] || continue
  if [ -z "$BEST" ] || [ "${LINE%%|*}" -gt "${BEST%%|*}" ]; then BEST="$LINE"; fi
done

# Fields are started_at|id|stage|state; `|` never appears in a run id or a
# stage name, and it survives being pasted where a tab would not.
[ -n "$BEST" ] || exit 0
STATE="${BEST##*|}"
[ "$STATE" = "open" ] || exit 0
REST="${BEST#*|}"; RUN_ID="${REST%%|*}"
REST="${REST#*|}"; STAGE="${REST%%|*}"

cat >&2 <<EOF
Run \`$RUN_ID\` is \`running\` in stage \`$STAGE\`. A turn cannot end here in prose. Four exits: continue the stage; open the decision as a form (\`rt runs field set gate <scope> --stage $STAGE\`, one sentence, the structured-question tool, stop); park it (\`rt runs field set hold "<why>" --stage $STAGE\`); or close it (the close gate, then \`rt runs run-status --status done|failed|abandoned\`). If the user asked you something mid-run, the answer is the sentence before the form.
EOF
exit 2
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `chmod +x hooks/pipeline-gate-stop.sh && hooks/tests/test-pipeline-gate-stop.sh`
Expected: every line `ok`, ending `all pipeline-gate-stop tests passed`, exit 0. Also run the existing `hooks/tests/test-herdr-doorbell.sh` to confirm nothing else moved.

- [ ] **Step 5: Wire the hook into the plugin**

Edit `hooks/hooks.json` so it reads:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/plugin/skills/getting-current-time/inject-time.sh\" UserPromptSubmit",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/plugin/skills/getting-current-time/inject-time.sh\" PostToolUse",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh \"${CLAUDE_PLUGIN_ROOT}/hooks/pipeline-gate-stop.sh\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Run: `python3 -c 'import json; json.load(open("hooks/hooks.json")); print("valid")'`
Expected: `valid`.

- [ ] **Step 6: Document the hook**

In `hooks/README.md`, add a row to the plugin-delivered table (the first table, under "hooks.json is plugin-delivered"):

```markdown
| `hooks/pipeline-gate-stop.sh` | `Stop` | when this session's pipeline run is still `running` and not held, blocks the turn from ending in prose (exit 2) and hands the agent the four exits: continue, open the decision as a form, hold, or close; fails open on every error |
```

- [ ] **Step 7: Commit**

```bash
git add hooks/pipeline-gate-stop.sh hooks/tests/test-pipeline-gate-stop.sh hooks/hooks.json hooks/README.md
git commit -m "hooks: Stop hook blocks a mid-run turn from ending in prose"
git push
```

---

### Task 5: Stage contract v3 in the convention reference

**Files:**
- Modify: `attachments/parameterized-skills/references/convention.md` (append after the last line of "Stage contract v2: run state", currently the final section)

**Interfaces:**
- Produces: the normative text plan 2's gate sites and plan 3's standalone runs cite.

- [ ] **Step 1: Append the section**

Append to the end of `attachments/parameterized-skills/references/convention.md`:

```markdown

## Stage contract v3: gates

A gate is a named human decision point. Every gate site in an engine is one
recipe, in this order:

- `rt runs field set gate <scope> --stage <stage>` (the commitment; it also
  names the pending gate to the console).
- One sentence of context, then the runtime's structured-question tool
  (`AskUserQuestion` in Claude Code) per the wrap-up include, then stop. The
  turn ends on the form, never on prose.
- On the answer: `rt runs decision record --contract gate@1 --scope <scope>
  --selection '<answers as JSON>' --decided-by <engine>`, then act on it.

Scopes. Pipeline gates: `plan`, `provision`, `evidence`, `evidence-attach`,
`ship`, `mark-ready`, `ci`, `close`, `<stage>-failed`, `redirect`, `hold`.
Standalone verbs add their own (`post-severity`, `post-disposition`,
`self-review`, `verdicts`, `fixes`, `post`, `sweep`, `push`, `conflict`,
`wrap-up`). `clarify` is the generic scope for any mid-verb "which one do
you mean". The decisions table upserts on `(run, contract, scope)`, so a
gate that can fire more than once per run carries stage and attempt:
`redirect:ship:2`, `hold:implement:3`, `implement-failed:2`, `ci:watch-ci:2`,
`conflict:rebase-worktree:1`; the attempt is the current stage row's, read
from `snapshot`. Gates that fire once per pass (`plan`, `close`,
`mark-ready`) keep the bare name; after a redirect they fire again and the
latest answer stands.

Standing options on every gate form: *Iterate here* (the human's free text
is the change request) and *Hold*; *Go back to <stage>* when `snapshot`
shows an earlier stage row.

`-` is the cleared sentinel for any field this contract writes (`hold`, a
redirected stage's produces): `field set <key> -`. Every reader treats it as
absent: `field get` returning `-` reads as not set, and the orchestrator's
completeness check is "non-null and not `-`".

Outside a run (`RT_RUN_DB` unset), the two `rt runs` lines are skipped and
the form alone is the gate.

A verb that inherited a run (invoked from inside a stage) uses
`run.current_stage` as its `--stage`, writes no `stage-done` and no
`run-status`, and fires no gate beyond its own: only the verb that ran
`run-start` closes the stage and the run. Every close ends with
`unset RT_RUN_DB` after `run-status`, so the export does not outlive the run
in the session's shell.
```

- [ ] **Step 2: Certify and commit**

Run: `sh tests/certify.sh attachments/parameterized-skills && sh tests/repo-purity.sh`
Expected: exit 0 for both.

```bash
git add attachments/parameterized-skills/references/convention.md
git commit -m "convention: stage contract v3, gates"
git push
```

---

### Task 6: Work engine close: teardown and the cleared sentinel

**Files:**
- Modify: `attachments/pipeline/work/SKILL.md` (the "Walk the stages" step 3 and the "Close" section)

**Interfaces:**
- Consumes: contract v3 (Task 5).
- Produces: the close shape plan 2's `close` gate slots in front of.

- [ ] **Step 1: Amend the completeness check**

In `attachments/pipeline/work/SKILL.md`, replace step 3 of "## 4. Walk the stages":

```markdown
3. When it finishes, `rt runs snapshot` and confirm every
   field in the entry's `produces` is non-null. A missing field means the
   stage did not finish: `stage-fail --stage <stage> --reason "<what>"`,
   report, stop.
```

with:

```markdown
3. When it finishes, `rt runs snapshot` and confirm every
   field in the entry's `produces` is non-null and not `-` (the cleared
   sentinel a redirect writes). A missing or cleared field means the stage
   did not finish: `stage-fail --stage <stage> --reason "<what>"`, report,
   stop.
```

- [ ] **Step 2: Amend the Close**

Replace:

```markdown
## Close

`rt runs run-status --status done` (or `failed` /
`abandoned`). Never leave a finished run `running`.
```

with:

```markdown
## Close

`rt runs run-status --status done` (or `failed` /
`abandoned`), then `unset RT_RUN_DB`. Never leave a finished run
`running`, and never leave the variable pointing at a finished run: the
next verb in this shell would `stage-start` into it.
```

- [ ] **Step 3: Certify, check the pack drift report, commit**

Run: `sh tests/certify.sh attachments/pipeline/work && rt skills check --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"`
Expected: certify exit 0; `check` still reports the mattstack pack's own verbs `current` (the work engine is not in this pack's roster; the team pack's `check` will report `work` stale, which its recompile in the companion release clears).

```bash
git add attachments/pipeline/work/SKILL.md
git commit -m "work: unset RT_RUN_DB at close; completeness check treats - as missing"
git push
```

---

### Task 7: Release the foundation

Precondition: `rt-runs-verbs` is on `main` (it is, as of 2026-09-01: `origin/main` carries d7b3d80 and a 0.10.16 bump that reorders the work engine's `run-start` block, lines no plan quotes). Confirm with `git log origin/main --oneline -3`.

**Files:**
- Modify: `.claude-plugin/plugin.json` (version)
- Modify (by recompile): `skills/wrap-up/SKILL.md` (the `compiled:` stamp)

- [ ] **Step 1: Rebase onto main**

```bash
git fetch origin
git log --oneline origin/main -3
git rebase origin/main
```

Expected: `origin/main` contains the `rt-runs-verbs` commit ("pipeline: stage skills call rt runs; drop pipeline-state.sh") and the rebase applies cleanly. A conflict in `attachments/pipeline/work/SKILL.md` is resolved by keeping both this branch's Close text and main's `rt runs` call sites.

- [ ] **Step 2: Bump the version and recompile**

Edit `.claude-plugin/plugin.json`: `"version": "0.11.0"` (main carries 0.10.16; the minor bump marks the new public door and the new hook).

```bash
rt skills compile --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
rt skills check --pack mattstack --pack-dir "$PWD" --mattstack-dir "$PWD"
grep compiled skills/wrap-up/SKILL.md
```

Expected: `check` all `current`; the door's `compiled:` names `mattstack@0.11.0`.

- [ ] **Step 3: Full verification**

```bash
sh tests/repo-purity.sh
sh tests/test-certify.sh
for d in attachments/wrap-up attachments/pipeline/work attachments/parameterized-skills skills/wrap-up; do sh tests/certify.sh "$d" || exit 1; done
hooks/tests/test-pipeline-gate-stop.sh
hooks/tests/test-herdr-doorbell.sh
bun tests/desc-test.ts --reps 5
```

Expected: every command exits 0.

- [ ] **Step 4: Commit the bump, merge, push**

```bash
git add .claude-plugin/plugin.json skills
git commit -m "mattstack: bump to 0.11.0 for the pipeline gates foundation"
git push
cd /Users/matt/Documents/GitHub/mattstack-skills
git checkout main && git pull --ff-only
git merge --ff-only pipeline-gates
git push
```

- [ ] **Step 5: Update the plugin cache and restart**

```bash
readlink ~/.claude-swap-backup/sessions/*/plugins 2>/dev/null | sort -u
claude plugin update mattstack@mattstack
ls ~/.claude/plugins/cache/mattstack/mattstack/ | sort -V | tail -1
```

Expected: every readlink line is `~/.claude/plugins` (one shared cache; otherwise repeat the update with `CLAUDE_CONFIG_DIR=<that session dir>`), and the newest cache dir is `0.11.0`. Restart the Claude session.

- [ ] **Step 6: Prove it live (operator at a terminal)**

In a fresh session in any registered repo:

1. `/mattstack:wrap-up` is offered in the slash menu and, invoked with a few open items, produces a form.
2. Start a throwaway run and try to end a turn in prose:

```bash
rt runs run-start --repo probe --work-type probe --pipeline probe
export RT_RUN_DB=<runDb from the response>
rt runs stage-start --stage probe
```

Then ask the agent to "reply with one sentence and stop". Expected: the hook blocks once (the agent reports being told a turn cannot end in prose and lists the four exits), and the console shows the run. Then:

```bash
rt runs run-status --status abandoned
unset RT_RUN_DB
```

and a plain reply ends the turn normally. Remove the probe run dir: `rm -rf ~/.mattstack/runs/probe`.

---

### Task 8: Retire the personal wrap-up skill

Precondition: Task 7 complete (the door is installed), or the operator has no wrap-up at all.

**Files:**
- Delete: `/Users/matt/Documents/GitHub/matt-skills/skills/workflow/wrap-up/` (its own repo; stage only this path, the repo has unrelated uncommitted deletions that stay untouched)
- Delete: the symlink `~/.claude/skills/matt:wrap-up`
- Modify: `~/.claude/CLAUDE.md` line 34

- [ ] **Step 1: Remove the skill from its repo**

```bash
cd /Users/matt/Documents/GitHub/matt-skills
git rm -r -q skills/workflow/wrap-up
git status --short
```

Expected: `D  skills/workflow/wrap-up/SKILL.md` staged; the pre-existing ` D skills/orchestration/remote-agent/...` lines remain unstaged and are not touched.

```bash
git commit -m "remove wrap-up (moved to mattstack:wrap-up)"
git push
```

- [ ] **Step 2: Remove the symlink and repoint the standing instruction**

```bash
rm ~/.claude/skills/matt:wrap-up
ls ~/.claude/skills | grep -c 'wrap-up' || echo "symlink gone"
```

Expected: `symlink gone`. Then in `~/.claude/CLAUDE.md`, change line 34 from:

```
when ending a turn, if there are decisions needed, and your instructions don't already indicate to use a form response, invoke /matt:wrap-up.
```

to:

```
when ending a turn, if there are decisions needed, and your instructions don't already indicate to use a form response, invoke /mattstack:wrap-up.
```

- [ ] **Step 3: Verify in a fresh session**

Start a new session; `/mattstack:wrap-up` resolves and `/matt:wrap-up` no longer appears. Done.
