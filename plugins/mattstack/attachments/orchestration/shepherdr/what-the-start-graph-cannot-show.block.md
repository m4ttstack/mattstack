---
order: 2
props:
  rules:
    merge: add
    default: ""
---

# What the start graph cannot show

**The herd contract.** Every herd is an rt daemon registry row plus one
chat room and one gate subscription, all made by `herd_start`. Workers ask
through gates (`herd_ask`, `herd_milestone`) and report into the room,
where the daemon also posts `<job> blocked` and `<job> exited`; every call
records job state. Talk to a worker with `chat_dm {to: <the job's handle
from herd_status>, body}`. `herd_status {herd}` is the whole picture; there
is no herd DB or script.

**Resuming.** `herd_resume {herd}` (ids from `herd_list`) re-points the
gate subscription here, continues the shepherd's chat identity with its DMs
and unread (a plain sign-in starts an empty one), and returns the open
gates, the unread count and every job's state (a pre-identity herd may
resume on a fresh identity, leaving old DMs behind). There is no other
resume step; handle each
unread line as if new (a report goes to the lanes graph).

**Brief assembly.** Every brief is assembled by `herd_brief`, never
composed. Its inputs:

- `template`: `${CLAUDE_SKILL_DIR}/references/job-template.md`
- `strategy`: the job's chosen strategy name
- `strategies`: `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`
- `fill`: one `"<slot>=<value>"` string per slot
- `out`: an absolute path in this session's scratchpad, one file per job

`${CLAUDE_SKILL_DIR}` is the absolute directory this skill loaded from;
both paths come from it alone (an installed plugin or pack root). The tool copies the template
and the named strategy body (into `## Method`) verbatim and fills the
`<angle-bracket>` slots from `fill`; an unfilled marker is a refusal
listing the leftovers. `<shepherd handle>` and `<shepherd id>` pass through for
`herd_spawn` to fill from the herd row; never `fill` them. The `out` path
is the brief.

**Domain hook -- the Method copy.** Unbound: as written. A bound domain
part may supply `## Method` (its team's pipeline skill): pass `methodFile:
<path>` instead of `strategy`/`strategies` (mutually exclusive); the
strategies-file slots go unfilled, the report contract is that skill's, and
the rest of the template and both channels stay as they are.

The Method slots are `fill` entries too: `<question-file>`/`<report-file>`
point to the brief's 'Asking the user a question' / 'Publishing a report'
sections (draft path `.superpowers/report-draft.md`); `<strategies-file>`
is `${CLAUDE_SKILL_DIR}/parts/strategy/references/strategies.md`;
`<strategy-skill-file>` is `${CLAUDE_SKILL_DIR}/SKILL.md`, whose strategy
part carries the strategy TABLE.

**Hidden mode.** For a herd out of sight ("invisible", "background",
"headless", "don't clutter my UI"), pass `hidden: true` to `herd_start`.
Worker panes live on the daemon's shared background herdr server (session
`mattstack-bg`) as `bg:<pane>` refs; nothing else changes. `herd_attend {job, herd}`
opens a tab on one worker (the user detaches with `ctrl+b q`; close the
tab afterwards). At wrap-up, offer the Bash command
`rt herd stop --hidden` (no tool runs it); never run it unprompted. The <!-- mcp-lint: allow -->
server is shared: the stop refuses while ANY background claim is live
(another herd, a runner board, an `agent --bg` pane), naming the owners;
report the refusal, never work around it.

**The domain-provisioned spawn.** Unbound, `herd_spawn` provisions the
tree itself (branch `<job>`, disposal `job`). A domain part that owns
provisioning makes the tree its own way and passes its registered name
(the `tree` that `worktree_provision` returns), never a directory, as
`tree`. `herd_spawn` admits only an rt ephemeral tree in state `claimed`
and refuses any other with its kind and state; that refusal goes to the
off-script gate.

**Spawn facts.**

- `herd_start {name: <short-name>, repo, hidden?}` runs once per herd; `repo` is the checkout path, identity or label. Every herd pane is a tab in the one workspace it returns; the user's own is never touched.
- `job` is the job name (lowercase, `[a-z][a-z0-9_-]{0,31}`), also the worker's tab label and chat display name. Each spawn mints a fresh chat identity, so a reused name never inherits an earlier herd's DMs. `herd_status` shows `handle` (the identity id, `chat_dm`'s `to`) and `handleName` (the display name; `<job>-2` while another live session holds the name); a herd tool's `job` field takes the job name. `brief` is the absolute `out` path.
- `herd_spawn` provisions the tree, launches claude with the brief, signs the worker into the room, accepts the trust dialog and records the job. A cold provision (no on-deck tree ready) can take minutes; tell the user.
- **Stagger 4+ spawns**: spawn one, confirm it returned, spawn the next.
- Agents never work in the user's checkout; skip isolation only for read-only jobs or when the user says to work in place. The worker's directory must be a **linked worktree**, which `herd_spawn` guarantees.

{{props.rules}}
