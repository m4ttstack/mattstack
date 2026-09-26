---
name: extending-a-pack
description: Use when a team pack already exists and it should know something new -- "add a rule to our pack", "the pipeline should X on our repo", "make ship run lint first", "add a ship/review/watch-ci verb", "reword the work description" -- or right after a generic stage missed a team rule. Not for creating the pack (see creating-a-pack) or publishing it (see editing-skills).
---

# Extending a pack

One ask per round. The ask lands in exactly one of four places; the rule
itself is written by the author, in their words, as a real skill.

**REQUIRED SUB-SKILL:** `superpowers:writing-skills` for every `context`
skill and every fill. Baseline first, then write, then re-run.

The output of one round, in this order, each part required:

1. the ask sorted to one place (section 1)
2. a RED record: the stage or verb run without the rule, the miss quoted
3. the skill or fill written, in the fill's frontmatter form
4. bound, certified, checked, with the fragment carrying the binding
5. a GREEN record: the same run from the pack source, the miss gone
6. handed to `mattstack:editing-skills` to publish

## 1. Sort the ask

Skills verbs go through `rt_verb {args: [...]}`: `--pack <pack>` sits in
`args`, and the call never carries a `cwd`. `--pack-dir <dir>` rides in
`args` for `check` only; compiling a checkout's or worktree's sources is
the bare Bash `rt skills compile --pack <pack> --pack-dir <dir>`, because
`rt_verb` refuses that flag on compile. `rt skills composition` and
`rt skills packs` refuse `rt_verb` (not agent-safe); run them as plain
Bash, and only as a one-time lookup, not a per-round call.

| the ask is about | goes to |
| --- | --- |
| a rule that holds even outside a pipeline (branch names, forbidden ops, where things live) | `skills/context/SKILL.md`, a hand-authored public skill |
| something one stage or verb should do differently | a fill bound to that stage's `domain` slot (or the review cluster's `criteria` / `reply-rules`) |
| a new door: `ship`, `review`, `watch-ci`, `self-review`, `receive-review`, `shepherdr` | a roster entry in `pack/stubs.jsonc` plus `rt_verb {args: ["skills", "surface", "set", "<verb>", "--public", "--pack", "<pack>"]}` |
| the wording of an existing verb | its `description` in `pack/stubs.jsonc` |

`slots.md` beside this file maps asks to slots and contracts.
`rt skills composition --pack <pack>` (Bash, one-time) is the live list; use
it when the table and the pack disagree.

## 2. Write it (context or fill)

Paths: `<zone>/mattstack/packs/<pack>/skills/context/SKILL.md` for context,
`<zone>/mattstack/packs/<pack>/attachments/<fill>/SKILL.md` for a fill.
`rt skills packs` (Bash, one-time) prints the pack dir.

A fill has this frontmatter and nothing else in it:

```markdown
---
name: <fill>
description: "Use when mattstack:<engine> resolves its <slot> slot here; the pack manifest binds <contract> to this skill. Not for manual invocation."
disable-model-invocation: true
metadata:
  provides: "<contract>"
---
```

RED, in the author's repo, in a worktree: run the stage or verb without the
rule on a small real task (`/<pack>:work` for a stage, `/<pack>:ship` for a
door) and record verbatim where it missed the rule. A worktree isolates
files, not the remote: when the ask concerns `ship`, answer the ship gate
with proceed and stop at the push or MR-create command itself (a ship
fill's rules run after the gate); when it concerns `watch-ci`, run against
a branch and MR that already exist on the remote. Running the tool the rule
is about (the linter, the test runner) in the checkout is not the RED pass;
it tests the tool, not the pipeline. Then write the body: the rule, its
reason, and the decision it changes. The stage keeps its own flow; the fill
carries only what the team adds.

Before a fill tells an agent to run a command, open
`${CLAUDE_SKILL_DIR}/../../../attachments/mcp-tools/reference.md` (the
`mcp-tools` reference): every rt call, forge call and git write a pipeline
needs has a tool there, except the few its header lists as staying on Bash
(`git commit` is one). The fill's sentence names that tool (a push is
`git_push {tree: <checkout>}`), not the command, and `rt skills check`
flags the shell form. `rt skills audit --pack <pack>` is the slower read
for plain-words instructions.

## 3. Bind, certify, check

Call `rt_verb {args: ["skills", "bind", "<stage-or-verb>", "<slot>", "<pack>:<fill>", "--pack", "<pack>"]}`:
it validates `provides`, writes the per-repo manifest AND `pack/skills.jsonc`,
and recompiles. Then run `sh <mattstack-skills>/tests/certify.sh <fill dir> --domain`,
then call `rt_verb {args: ["skills", "check", "--pack", "<pack>"]}`.
A check that comes back `failed (exit 1)` is drift, with only the tail
of its output; run the bare Bash `rt skills check --pack <pack>` to read
what moved.

The write into `pack/skills.jsonc` is what reaches teammates; the per-repo
manifest is regenerated on every materialize. Confirm the fragment carries
the new `bindings` entry before moving on. A `context` skill is certified
the same way, `sh <mattstack-skills>/tests/certify.sh <context dir> --domain`.

A verb-level bind (`mattstack:ship`) needs the door rostered first; the
stage-level bind (`mattstack:stage-ship`) works either way. Bind both when
both exist. `context` needs no bind: it is public by being under `skills/`;
add it to `pack/surface.jsonc`'s `public` list.

GREEN, now that the pack compiles with the rule. The running session still
loads the pack from the installed cache, so GREEN starts a session that
loads the pack source instead, in the worktree, where the pack's verbs come
from its source, not the cache:

```bash
claude --plugin-dir <pack dir>
```

In it, re-run the same stage or verb on the same task with the same stop
point, and record that the miss is gone. The round is not done until this
run has happened.

## 4. Doors and wording

Add a roster entry with the engine name and a trigger-only description in
the team's words, then call `rt_verb {args: ["skills", "surface", "set", "<verb>", "--public", "--pack", "<pack>"]}`
and `rt_verb {args: ["skills", "compile", "--pack", "<pack>"]}`. Rewording is the same edit without the
surface step. A `shepherdr` door also needs its two required slots bound
(`tiering` to `mattstack:model-tiering`, `strategy` to
`mattstack:execution-strategy`) before it compiles.

## 5. Publish

Hand to `mattstack:editing-skills`: bump, commit, push,
`rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}`, restart. The daemon's team snapshot may commit the zone first; that is
fine, the bump and push still go through editing-skills.

## Red flags

- Editing anything under `skills/<verb>/` or `attachments/stage-*/`: compiled
  output, overwritten by the next compile.
- Editing the mattstack engine in the plugin cache: every team's compile
  reads it, and the next update erases the edit.
- Editing `~/.mattstack/repos/<slug>/skills.jsonc` by hand: regenerated on
  the next materialize; the fragment is the source.
- A fill body that restates the engine: the fill carries only what the team
  adds.
- Binding before the fill exists: `rt_verb {args: ["skills", "bind", ...]}` refuses; write first.
- "The next real run is the first live test": that is the RED and GREEN
  pass skipped; run them.
