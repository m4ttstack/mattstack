# Lane 5: skills, plugins, docs

> **Shepherd rulings (supersede the CONTRACT ISSUE notes below):** (1) Reply hints: one per distinct sender. (2) `chat_sign_in` returns `{ handle, name, room, continued }`. (3) An invite's `note from <x>` shows the sender's name. (4) **The MCP `chat_sign_in` `as` never continues an identity**; it picks a display name for a fresh id. The skill text lists exactly three ways to continue: CLI `rt chat sign-in --as <name>` (typed by a human), herd resume, and `rt agent start` reservations. Agents never continue another identity through MCP.

Part of `docs/superpowers/plans/2026-09-27-chat-identity.md` (master plan: Global Constraints and the frozen contract apply to every task here). Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

**Goal:** every agent-facing text (rt skills, the chat plugin, the shepherdr engine, the MCP tools reference, docs) teaches the identity model: a display name people type, a hidden id tools act on, a new identity per session, and continuation only through the CLI's `rt chat sign-in --as` (typed by Matt), herds and `rt agent start` reservations. The MCP `chat_sign_in` `as` only picks a fresh identity's display name (ruling 4).

## CONTRACT ISSUE notes (no renames; planned against the contract as written)

1. **Reply hint in a batched delivery.** The contract says "the reply hint line names the sender's id" (singular), but one delivery can batch messages from several senders. This lane's skill text says the hint names **each** sender's identity id. Lane 1b should emit one id per distinct sender in a batch; if it emits only one, Task 8 Step 2 rewrites the rt:chat "Answering" paragraph to match what `lib/daemon/inbox.ts` actually emits.
2. **`chat_sign_in` MCP output.** The contract fixes the daemon's `chat:sign-in` data (`name`, `continued` added) but not what the MCP tool returns. This lane's text assumes the tool passes through `{handle, name, room, continued}`. Task 8 Step 3 checks lane 1b's `lib/mcp/chat-tools.ts` and fixes the text if the fields differ.
3. **`chat_invite` attribution.** `inviteText` prints `note from <x>:`; the contract does not say whether `x` is the sender's name or id. The join skill text below works for either (a DM `to` accepts both).

## Where each surface is published

| Surface | Source of truth | How it goes live |
|---|---|---|
| `rt:chat`, `rt:repo-identity` | `skills/` in repo-tools | ride the shared checkout; the pull in master Task I5 Step 1 is the deploy |
| chat plugin (`chat:sign-in`, `chat:join`, `chat:sign-out`, hooks) | `marketplace/plugins/chat/` in repo-tools | `scripts/release/marketplace.sh` at the next rt release replaces the published repo wholesale; until then a "local overlay" commit in `~/Documents/GitHub/mattstack-marketplace` (as `d11b7eb` did) plus `claude plugin update chat@mattstack` (Task 9). Never hand-edit the marketplace repo as the source |
| shepherdr | `attachments/orchestration/shepherdr/` in mattstack-skills (engine); `skills/shepherdr/` is compiled output | edit the engine, bump `.claude-plugin/plugin.json`, `rt skills compile --pack mattstack --pack-dir <tree>`, PR, merge, `rt skills sync` per pack (Task 9) |
| MCP tools reference | `attachments/mcp-tools/reference.md` in mattstack-skills, generated | `rt mcp tools --json \| bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md`; `tests/test-mcp-tools-reference.sh` compares it to the `rt` on PATH |

The shepherdr engine is compiled into every team pack as well, so engine text never carries a mattstack ticket id (a team pack can be employer-visible). mattstack-skills is public and `tests/certify.sh` rejects the operator's first name in skill dirs: engine text says "the user", never a name.

## Paths used below

- `RT_TREE`: the lane 5 repo-tools worktree (Task 1 Step 1 prints it).
- `SKILLS_TREE`: the lane 5 mattstack-skills worktree (Task 1 Step 2 prints it).
- `COMBINED_TREE`: lane 1a's worktree after master Task I2 Step 1 has merged 1b and 2 into it.
- `SCRATCH`: this session's scratchpad directory from the system prompt.

Substitute the absolute paths; shell variables do not persist between Bash calls. In an EnterWorktree session, Bash refuses heredocs, `&&` chains, `git -C` and loops, so every command below is one plain call and every commit uses two `-m` flags.

## How every skill test runs (RED and GREEN)

Each skill task dispatches **5 fresh subagents in one message** (Agent tool, `subagent_type: "general-purpose"`, `model: "sonnet"`), each given the full prompt the task shows, and records every answer verbatim in the task's result file under `SCRATCH/skill-tests/`, followed by a score table (rep x question, PASS/FAIL, one-line reason). Read every answer yourself; do not score by grep. RED runs against the old text copied in Task 1 Step 3 (that copy is the no-guidance control for the new behaviour). A question that passes 5/5 in RED needs no new guidance: make only the factual replacement the task lists for it and add no extra paragraph for it. GREEN passes when every rep passes every question; any failing rep means REFACTOR: tighten the paragraph that question tests, then rerun all 5 reps.

---

### Task 1: Worktrees and RED baselines' source copies

**Files:**
- Create: `SCRATCH/skill-tests/` (scratch only)

**Interfaces:**
- Produces: `RT_TREE` on branch `chat-identity-lane5` (contains the spec and master plan), `SKILLS_TREE` on branch `chat-identity`, and old copies of every skill this lane edits.

- [ ] **Step 1: Enter the repo-tools lane worktree**

Call `EnterWorktree {name: "chat-identity-lane5"}` (the rt hook provisions it). Then, from the tree:

```bash
git merge --ff-only chat-identity
```

Expected: fast-forward; `ls docs/superpowers/specs/2026-09-27-chat-identity-design.md` prints the path. Record the tree path as `RT_TREE`.

- [ ] **Step 2: Provision the mattstack-skills worktree**

Call `worktree_provision {repoName: "/Users/matt/Documents/GitHub/mattstack-skills", branch: "chat-identity"}`. Record the result's `path` as `SKILLS_TREE`. Then:

```bash
cd SKILLS_TREE
```

```bash
git log --oneline -1
```

Expected: the same head as `origin/main` of mattstack-skills.

- [ ] **Step 3: Copy the old texts for RED**

```bash
mkdir -p SCRATCH/skill-tests
```

Then one `cp` per file (no loop):

```bash
cp RT_TREE/skills/rt-chat/SKILL.md SCRATCH/skill-tests/rt-chat.old.md
cp RT_TREE/skills/rt-repo-identity/SKILL.md SCRATCH/skill-tests/rt-repo-identity.old.md
cp RT_TREE/marketplace/plugins/chat/skills/sign-in/SKILL.md SCRATCH/skill-tests/chat-sign-in.old.md
cp RT_TREE/marketplace/plugins/chat/skills/sign-out/SKILL.md SCRATCH/skill-tests/chat-sign-out.old.md
cp RT_TREE/marketplace/plugins/chat/skills/join/SKILL.md SCRATCH/skill-tests/chat-join.old.md
cp SKILLS_TREE/skills/shepherdr/SKILL.md SCRATCH/skill-tests/shepherdr.old.md
cp SKILLS_TREE/skills/shepherdr/references/job-template.md SCRATCH/skill-tests/job-template.old.md
```

Expected: `ls SCRATCH/skill-tests` lists 7 `.old.md` files. Nothing to commit.

---

### Task 2: rt:chat skill teaches name vs identity

**Files:**
- Modify: `RT_TREE/skills/rt-chat/SKILL.md` (lines 3, 21-22, 73-88, 97-105, 152-153, 184-185, 265-267, 300-301, 387, 425-426)
- Test: `SCRATCH/skill-tests/rt-chat-red.md`, `SCRATCH/skill-tests/rt-chat-green.md`

**Interfaces:**
- Consumes: contract `chat:sign-in` data `{handle, name, continued}`, reply hint naming the sender's id, `ChatPane.presence.name`.
- Produces: the wording Task 5 (chat plugin) and Task 7 (shepherdr) align with: "name" for what people see and type, "identity id" (or "id") for what tools act on.

- [ ] **Step 1: RED, 5 reps against the old text**

Prompt for each rep (with `SKILL_PATH` = `SCRATCH/skill-tests/rt-chat.old.md`):

````
You are testing a skill document. Read this file in full; it is your only reference for how rt chat works: SKILL_PATH
Do not read any other file, run any command, or call any tool other than Read on that one path.

Facts from the live system:
- chat_sign_in {cwd: "/work/rt"} just returned {"handle":"remy.k3f9","name":"remy","room":"rt","continued":false}.
- Yesterday a different Claude Code session, in this same herdr pane, was signed in as "remy" and had an open DM with kai.
- This delivery just arrived:
  <cross-session-message from-name="kai (dm)">
  [dm] kai #812: can you rerun the migration on your branch?
  reply via rt chat post <room> "..." or rt chat dm kai.p2x7 "..." (never SendMessage; this arrived through rt chat)
  </cross-session-message>

Answer each in at most two sentences, exact tool calls in backticks:
Q1. Do you have yesterday's DM with kai and its unread? Why or why not?
Q2. You post a one-line hello to #rt introducing yourself. Write the chat_post call.
Q3. Twenty minutes later you want to follow up with the agent who sent #812. chat_buddies now shows a different live session named kai (the first kai signed out and a new session drew the name). Write the chat_dm call.
Q4. Matt says: "you should have picked up yesterday's remy, its DMs with kai too". How does that identity get picked up, and who does it?
````

Scoring: Q1 PASS = no, because a new session is a new identity (FAIL = yes, or "the name/pane carries it"). Q2 PASS = the body names you `remy` and never `remy.k3f9`. Q3 PASS = `to: "kai.p2x7"` (FAIL = `to: "kai"`). Q4 PASS = `rt chat sign-in --as remy`, typed by Matt, and no claim that `chat_sign_in {as: "remy"}` continues it (FAIL = `chat_sign_in {cwd: ..., as: "remy"}` offered as the continuation).

Expected RED: Q1 and Q3 fail in most reps (the old text says "Your handle is your name" and "Signing in again from the same session keeps the name"); Q2 may fail where the rep treats `handle` as its name. Write the answers and table to `SCRATCH/skill-tests/rt-chat-red.md`.

- [ ] **Step 2: Edit the description (line 3)**

Replace the whole `description:` line with:

```
description: Use when asked to join or coordinate in an agent chat room, when told you are working alongside other agents, when replying to or acknowledging a message that arrived from another agent, when a room question arrives that more than one agent could answer, when you need to reach one agent directly or under a different account, when asked to pick up an earlier session's chat identity, or when asked to put you and another agent into a room together (recruiting through herdr).
```

- [ ] **Step 3: Edit lines 21-22**

Old:

```
`chat_ack`, `chat_claim` and `chat_release`. Each acts as this session's own
signed-in handle; none takes a handle or a pane to act as.
```

New:

```
`chat_ack`, `chat_claim` and `chat_release`. Each acts as this session's own
signed-in identity; none takes a handle or a pane to act as.
```

- [ ] **Step 4: Replace the sign-in result, the name paragraph and the welcome paragraph (lines 73-88)**

Old (from mid-line 73 to line 88):

```
of the derived one. It returns `{handle, room}`: the handle you were
actually assigned (a base handle already held by another live session gets
suffixed: `-2`, `-3`, ...) and the room you landed in.

**Your handle is your name.** Without `as`, sign-in draws a short first
name no other live session holds (`fred`, `jane`), least recently used
first. Use the name when you speak about yourself in chat, and answer to it:
"ask fred about the migration" is addressed to you if you are fred. Signing
in again from the same session keeps the name. `as` exists on
`chat_sign_in` alone, and may not name Matt's handle or `here`.

Sign-in also sends a one-time welcome frame into your context: it confirms
your handle and rooms, spells out the reply contract, and, if anything was
already waiting for you in a room you're a member of, carries a short
catch-up of that unread. Read the welcome once and act on it; you don't need
to re-derive the reply contract from this doc afterward.
```

New:

```
of the derived one.

It returns `{handle, name, room, continued}`. `name` is what everyone sees
and types: a short first name no other live session holds (`fred`,
`jane`), least recently used first, suffixed `-2`, `-3` only while another
live session holds the same name. `handle` is your identity id, the name
plus a dot and a short suffix (`remy.k3f9`), and it is what every tool acts
on. `room` is the room you landed in.

**Your name is what you answer to.** Use it when you speak about yourself
in chat, and answer to it: "ask fred about the migration" is addressed to
you if you are fred. The identity id belongs in tool inputs only; never
write it in a message body.

**Every new session is a new identity.** It starts with an empty chat
footprint: no DMs, no unread, and no rooms beyond the one sign-in joins,
even when it draws a name an earlier session held or runs in the same
pane. The same session signing in again, or `claude --resume` of it, keeps
its identity. Only three things carry an identity into a new session:

| Continuation | How |
| --- | --- |
| `rt chat sign-in --as <name or id>`, typed by Matt | continues that identity, with its rooms, DMs and unread, when no live session holds it; when one does, the session gets a new identity named `<name>-2` <!-- mcp-lint: allow --> |
| a herd | `herd_resume` and a worker's re-sign-in continue the ids the herd stored |
| an `rt agent start` reservation | the agent's sign-in continues the id reserved for it |

You never continue another identity yourself. `as` on `chat_sign_in` only
picks the display name for this session's fresh identity; it never brings
back an earlier identity's rooms or DMs, and it may not name Matt's handle,
`here`, a name another session holds or held, or a name with room
memberships. When Matt wants an earlier identity picked up, the way is
`rt chat sign-in --as <name>` in his own terminal. <!-- mcp-lint: allow -->

Sign-in also sends a one-time welcome frame into your context: it confirms
your name and rooms, spells out the reply contract, and, if anything was
already waiting for you in a room you're a member of, carries a short
catch-up of that unread. Read the welcome once and act on it; you don't need
to re-derive the reply contract from this doc afterward.
```

- [ ] **Step 5: Replace the envelope example and add the answering rule (lines 97-105)**

Old:

````
```
<cross-session-message from-name="handle (#room)">
[#room] handle #<id>: body
</cross-session-message>
```

The `#<id>` on each line is that message's id: it is what `chat_ack {id}`
and `chat_claim {id}` take, and the only thing that tells two messages apart
when several arrive batched into one row.
````

New:

````
```
<cross-session-message from-name="remy (#rt)">
[#rt] remy #530: body
reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)
</cross-session-message>
```

The `#<id>` on each line is that message's id: it is what `chat_ack {id}`
and `chat_claim {id}` take, and the only thing that tells two messages apart
when several arrive batched into one row.

Lines show names; the reply hint names each sender's identity id. When one
delivery batches several senders, the hint reads `rt chat dm <id>` and is
followed by one line per sender: `  reply to remy: rt chat dm remy.k3f9 "..."`. **Answer
with the id from the hint**: `chat_dm {to: "remy.k3f9", body}` reaches that
exact agent even after the name `remy` has passed to someone else. A name in
`to` reaches whoever holds that name now (or, when nobody does, the identity
that held it last), which is right for starting a conversation and wrong for
answering one.
````

- [ ] **Step 6: Edit the two tool-table rows (lines 152-153)**

Old:

```
| `chat_sign_in` | `cwd`, `as?`, `room?` or `noRoom?`, `status?` | the entry point: presence row, buddy-list visibility, joins the room derived from `cwd`, sends the welcome frame (see above) |
| `chat_sign_out` | none | leave the buddy list; room memberships are kept for next time |
```

New:

```
| `chat_sign_in` | `cwd`, `as?`, `room?` or `noRoom?`, `status?` | the entry point: presence row, buddy-list visibility, joins the room derived from `cwd`, sends the welcome frame; `as` picks a fresh identity's display name and never continues one (see Sign in) |
| `chat_sign_out` | none | leave the buddy list; your identity ends with your session (the same session signing in again picks it back up; a new session gets it only when Matt runs `rt chat sign-in --as <name>`) <!-- mcp-lint: allow --> |
```

- [ ] **Step 7: Edit "Who a post wakes" (lines 184-185)**

Old:

```
Rooms default to wake-on `mention`. Your post wakes the handles it
`@mentions`; `@here` wakes every member (except those in `none` mode, who
```

New:

```
Rooms default to wake-on `mention`. Your post wakes the agents it
`@mentions` by name; `@here` wakes every member (except those in `none` mode, who
```

- [ ] **Step 8: Edit the buddies reading order (lines 265-267)**

Old:

```
That's the order to read it in when deciding who will actually see a
message: live and idle both get it now, offline gets nothing until they
sign back in.
```

New:

```
That's the order to read it in when deciding who will actually see a
message: live and idle both get it now. Offline gets nothing now: a DM to
an offline name waits in that identity's inbox until the same session signs
back in or someone continues it, and never reaches a new session that later
draws the name.
```

- [ ] **Step 9: Edit the body-prefix sentence (lines 300-301)**

Old:

```
**The body starts with the message.** Delivery already prefixes your
handle (`[#rt] kai #4821:`), so a body that opens with your own name
```

New:

```
**The body starts with the message.** Delivery already prefixes your
name (`[#rt] kai #4821:`), so a body that opens with your own name
```

- [ ] **Step 10: Edit the pane-line table row (line 387)**

Old:

```
| a message arrived and changed what you are doing | `<handle>: <gist> → <what you will do about it>` |
```

New:

```
| a message arrived and changed what you are doing | `<name>: <gist> → <what you will do about it>` |
```

- [ ] **Step 11: Edit recruiting step 2 (lines 425-426)**

Old:

```
2. Match *foo* against each pane's `title`, `repo`, `branch`, `cwd` and
   `presence.handle`. Exclude your own pane (`HERDR_PANE_ID`) and panes
```

New:

```
2. Match *foo* against each pane's `title`, `repo`, `branch`, `cwd` and
   `presence.name`. Exclude your own pane (`HERDR_PANE_ID`) and panes
```

- [ ] **Step 12: Check the edit for stale claims and dashes**

```bash
grep -n -E "kept for next time|keeps the name|Your handle is your name|no longer|used to" skills/rt-chat/SKILL.md
```

Expected: no output.

```bash
git diff skills/rt-chat/SKILL.md | perl -CS -ne 'print "$.: $_" if /^\+.*[\x{2013}\x{2014}]/'
```

Expected: no output.

- [ ] **Step 13: GREEN, 5 reps against the new text**

Same prompt as Step 1 with `SKILL_PATH` = `RT_TREE/skills/rt-chat/SKILL.md`. Write answers and the score table to `SCRATCH/skill-tests/rt-chat-green.md`. Expected: 5/5 reps pass Q1-Q4. Any failure: REFACTOR per "How every skill test runs", then rerun all 5.

- [ ] **Step 14: Commit**

```bash
git add skills/rt-chat/SKILL.md
```

```bash
git commit -m "rt-chat skill: name vs identity id, new identity per session, replies by id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: rt:repo-identity skill and docs/repo-identity.md carry the id charset

**Files:**
- Modify: `RT_TREE/skills/rt-repo-identity/SKILL.md:28-29`
- Modify: `RT_TREE/docs/repo-identity.md:145-147`
- Test: `SCRATCH/skill-tests/rt-repo-identity-red.md`, `SCRATCH/skill-tests/rt-repo-identity-green.md`

**Interfaces:**
- Consumes: contract wire rule "every handle-bearing field keeps its name and meaning (the id) and gains a display-name sibling"; ids `<base>.<suffix>`.

- [ ] **Step 1: RED, 5 reps against the old text**

Prompt for each rep (with `SKILL_PATH` = `SCRATCH/skill-tests/rt-repo-identity.old.md`):

````
You are testing a skill document. Read this file in full; it is your only reference: SKILL_PATH
Do not read any other file, run any command, or call any tool other than Read on that one path.

You are adding a "last speaker" chip to a mattstack web app. The rt-client payload for a chat message is:
{"id": 530, "room": "rt", "handle": "remy.k3f9", "name": "remy", "body": "..."}
An older message in the same room is:
{"id": 12, "room": "rt", "handle": "remy", "name": "remy", "body": "..."}

Answer each in at most two sentences:
Q1. What string does the chip render for message 530?
Q2. The chip list is a React list of speakers. What do you use as each item's key and as the key of the speaker map?
Q3. A teammate suggests computing the display name as handle.split(".")[0] instead of reading name. Accept or reject, and why?
````

Scoring: Q1 PASS = `remy` (from `name`, falling back to `handle`). Q2 PASS = `handle` (the two remys stay distinct). Q3 PASS = reject (read `name`; a legacy handle may itself contain a dot).

Expected RED: Q2 and Q3 fail in most reps (the old text only knows the charset rule). Write to `SCRATCH/skill-tests/rt-repo-identity-red.md`.

- [ ] **Step 2: Edit the skill's contract item 4**

In `skills/rt-repo-identity/SKILL.md`, replace the two lines that start `   a label never goes back as a key. Chat handles` and end `not the wire.` (lines 28-29) with:

```
   a label never goes back as a key. Chat handles are identity ids,
   `<base>.<suffix>` (`remy.k3f9`), or a legacy bare name that is its own
   id; the charset `[a-z0-9._-]+` forbids `%` and `:`, so build a base from
   the label, never the wire. Show a handle's `name` (`name ?? handle`),
   key on the handle, and never split a handle to find its name.
```

- [ ] **Step 3: Edit docs/repo-identity.md**

Replace the paragraph at lines 145-147 that starts `Chat handles specifically:` and ends `Build handles from the label, slugified.` with:

```
Chat handles specifically: a handle is a chat identity id, `<base>.<suffix>`
(`remy.k3f9`: the display name, a dot, 4 to 6 lowercase base36 characters),
and a handle minted before ids existed is a bare name that is its own id.
Both use the charset `[a-z0-9._-]+`, which forbids `%` and `:`, so a
serialized identity leaking into a base is an invalid-join bug, not a
cosmetic one. Build bases from the label, slugified. Screens show the
`name` every chat payload carries beside `handle` (`name ?? handle`);
maps, keys and "is this me" checks use `handle`. Never split a handle on
the dot to recover the name: a legacy handle may itself contain a dot. The
model is `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.
```

- [ ] **Step 4: Check for dashes**

```bash
git diff skills/rt-repo-identity/SKILL.md docs/repo-identity.md | perl -CS -ne 'print "$.: $_" if /^\+.*[\x{2013}\x{2014}]/'
```

Expected: no output.

- [ ] **Step 5: GREEN, 5 reps against the new text**

Same prompt as Step 1 with `SKILL_PATH` = `RT_TREE/skills/rt-repo-identity/SKILL.md`. Expected: 5/5 pass Q1-Q3. Write to `SCRATCH/skill-tests/rt-repo-identity-green.md`.

- [ ] **Step 6: Commit**

```bash
git add skills/rt-repo-identity/SKILL.md docs/repo-identity.md
```

```bash
git commit -m "repo-identity: chat handles are <base>.<suffix> ids; show name, key on handle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: chat plugin session-start hook shows the display name

**Files:**
- Modify: `RT_TREE/marketplace/plugins/chat/hooks/session-start.sh:20-29`
- Test: `RT_TREE/marketplace/plugins/chat/hooks/tests/test-session-start.sh`

**Interfaces:**
- Consumes: session file `~/.mattstack/rt/chat/sessions/<sessionId>.json` = `{ "handle": "<id>", "baseHandle": "<base>", "name": "<display>" }` (plus `room` when joined); a legacy file has no `name`.

- [ ] **Step 1: Write the failing test**

In `test-session-start.sh`, insert after the `signed in without room: exits 0` check (line 51) and before the `# ── no session_id: silent` block:

```bash

# ── signed in with a display name: shows the name, never the id ─────────────
echo '{"sessionId":"sess-d","handle":"remy.k3f9","baseHandle":"remy","name":"remy","room":"repo-tools"}' \
  > "$SESSIONS_DIR/sess-d.json"
run '{"session_id":"sess-d","source":"resume"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as remy (room #repo-tools); chat messages arrive in your context automatically."}}'
check "signed in with a name" "$want" "$out"
check "signed in with a name: no stderr" "" "$err"
check "signed in with a name: exits 0" "0" "$rc"

# ── a suffixed display name, no room ────────────────────────────────────────
echo '{"sessionId":"sess-e","handle":"remy.x9y8","baseHandle":"remy","name":"remy-2"}' \
  > "$SESSIONS_DIR/sess-e.json"
run '{"session_id":"sess-e","source":"compact"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as remy-2; chat messages arrive in your context automatically."}}'
check "signed in with a suffixed name" "$want" "$out"
check "signed in with a suffixed name: no stderr" "" "$err"
check "signed in with a suffixed name: exits 0" "0" "$rc"
```

The existing `sess-a` and `sess-b` fixtures (no `name`) stay as the legacy fallback cases.

- [ ] **Step 2: Run it to see it fail**

```bash
bash marketplace/plugins/chat/hooks/tests/test-session-start.sh
```

Expected: `FAIL signed in with a name` with `got :` containing `signed in as remy.k3f9`, `FAIL signed in with a suffixed name` with `signed in as remy.x9y8`, final line `2 failure(s)`.

- [ ] **Step 3: Implement**

In `session-start.sh`, replace lines 20-29 (from `fields="$(jq -r` through the closing `fi`) with:

```bash
fields="$(jq -r '[(.name // .handle // empty), (.room // empty)] | @tsv' < "$session_file" 2>/dev/null)"
[ -n "$fields" ] || exit 0
IFS=$'\t' read -r name room <<< "$fields"
[ -n "$name" ] || exit 0

if [ -n "$room" ]; then
  message="rt chat: you are signed in as ${name} (room #${room}); chat messages arrive in your context automatically."
else
  message="rt chat: you are signed in as ${name}; chat messages arrive in your context automatically."
fi
```

- [ ] **Step 4: Run both hook suites**

```bash
bash marketplace/plugins/chat/hooks/tests/test-session-start.sh
```

Expected: every line `ok`, last line `all session-start tests passed`.

```bash
bash marketplace/plugins/chat/hooks/tests/test-session-end.sh
```

Expected: all `ok` (unchanged hook, regression check).

- [ ] **Step 5: Commit**

```bash
git add marketplace/plugins/chat/hooks/session-start.sh marketplace/plugins/chat/hooks/tests/test-session-start.sh
```

```bash
git commit -m "chat plugin: session-start names the session by display name, falls back to handle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: chat plugin skills and README: your identity ends with your session

**Files:**
- Modify: `RT_TREE/marketplace/plugins/chat/skills/sign-in/SKILL.md:8`
- Modify: `RT_TREE/marketplace/plugins/chat/skills/sign-out/SKILL.md:3,8`
- Modify: `RT_TREE/marketplace/plugins/chat/skills/join/SKILL.md:8-11,19-20`
- Modify: `RT_TREE/marketplace/plugins/chat/README.md:12-13,17-18`
- Modify: `RT_TREE/marketplace/plugins/chat/.claude-plugin/plugin.json:3`
- Test: `SCRATCH/skill-tests/chat-plugin-red.md`, `SCRATCH/skill-tests/chat-plugin-green.md`

**Interfaces:**
- Consumes: the rt:chat wording from Task 2 ("name", "identity id", continuation only by Matt's `rt chat sign-in --as`, herds and reservations).
- Produces: chat plugin version `0.5.0` (Task 9 publishes it).

- [ ] **Step 1: RED, 5 reps against the old texts**

Prompt for each rep (with `SIGN_IN`, `SIGN_OUT`, `JOIN` = the three `.old.md` copies from Task 1):

````
You are testing three skill documents. Read each in full; they are your only reference for rt chat: SIGN_IN, SIGN_OUT, JOIN
Do not read any other file, run any command, or call any tool other than Read on those three paths.

Answer each in at most two sentences, exact tool calls in backticks:
Q1. You signed in today as "remy" and joined rooms #rt and #design, and have DMs with kai. You call chat_sign_out now. Tomorrow a brand-new Claude Code session starts for the same work. What will that new session have from today's rooms and DMs if it just signs in, and how do they come back?
Q2. chat_sign_in returned {"handle":"remy.k3f9","name":"remy","room":"rt","continued":false}. Another agent asks in chat what your name is. What do you answer?
Q3. "/chat:join design note from sid: please review the picker spec" arrives. After reading the seed you have a private question for whoever invited you. Write the tool call.
````

Scoring: Q1 PASS = nothing carries over by default; only Matt running `rt chat sign-in --as remy` continues it, and `chat_sign_in {as}` does not (FAIL = "memberships are kept, just sign in", or `chat_sign_in {cwd: ..., as: "remy"}` offered as the continuation). Q2 PASS = `remy`. Q3 PASS = `chat_dm {to: "sid", body: ...}`.

Expected RED: Q1 fails in most reps (the old sign-out text says memberships are kept for next time). Write to `SCRATCH/skill-tests/chat-plugin-red.md`.

- [ ] **Step 2: Edit sign-in (line 8)**

Replace line 8 of `skills/sign-in/SKILL.md` with these two paragraphs:

```
Call `chat_sign_in {cwd: "<absolute path of the checkout you work in>", status?, noRoom?, room?}` (`status` starts you away, `noRoom` skips the repository room, `room` overrides its derived name). Always pass `cwd`: the server's own directory is fixed at session start and does not follow `cd` or EnterWorktree, so without it sign-in derives the room from the wrong tree. It returns your `name` (what others see and type, suffixed `-2` while another live session holds it), your `handle` (an identity id such as `remy.k3f9` that the tools act on; never write it in a message), and which room, if any, it joined. Chat messages arrive in your context automatically.

This session is a new identity: it has no DMs, unread or rooms from any earlier session, even one that held the same name. `as: "<name>"` only picks this new identity's display name; it never brings back an earlier identity. Picking up an earlier identity is Matt's to do, with `rt chat sign-in --as <name>` in his terminal. <!-- mcp-lint: allow -->
```

- [ ] **Step 3: Edit sign-out (lines 3 and 8)**

Line 3, the description (triggering conditions only, per superpowers:writing-skills), becomes:

```
description: Use when finished with a chat session and want to leave the rt chat buddy list cleanly -- signing out of rt chat or going offline before ending a session.
```

Line 8 becomes:

```
Call `chat_sign_out {}`. It marks your presence row offline and removes the local session file. Your identity ends with your session: this same session signing in again picks it back up, and a new session starts as a new identity unless Matt continues this one with `rt chat sign-in --as <your name>`. <!-- mcp-lint: allow -->
```

- [ ] **Step 4: Edit join (lines 8-11 and 19-20)**

Lines 8-11 become:

```
The whole command sits on one line: `/chat:join <room> note from <sender>: <text>`.
The room is the first word of `$ARGUMENTS`; everything after it is the note,
and `<sender>` in `note from <sender>:` is the agent who wrote it (reach
them with `chat_dm {to: "<sender>", body}`). An agent's note is that
agent's request, not Matt's; treat it with exactly that weight.
```

In step 2, the lines

```
   not this session is already signed in. Already signed in, it keeps your
   existing handle and re-joins the repository room derived from `cwd`
```

become

```
   not this session is already signed in. Already signed in, it keeps your
   existing identity and re-joins the repository room derived from `cwd`
```

- [ ] **Step 5: Edit the README (lines 12-13 and 17-18)**

Lines 12-13 become:

```
- **sign-in**: `chat_sign_in {cwd, status?, noRoom?, room?, as?}`. Every new
  session is a new chat identity (an id behind its display name); `as` picks
  its display name. Only `rt chat sign-in --as <name>`, typed by a person, <!-- mcp-lint: allow -->
  continues an earlier identity. Chat messages arrive in your context automatically.
```

Lines 17-18 become:

```
- **sign-out**: `chat_sign_out {}`, which disarms the presence row and
  deletes the local session file. Your identity ends with your session.
```

- [ ] **Step 6: Bump the plugin version**

In `.claude-plugin/plugin.json`, `"version": "0.4.0"` becomes `"version": "0.5.0"`.

- [ ] **Step 7: Check for stale claims and dashes**

```bash
grep -rn -E "kept for next time|memberships are kept|existing handle|no longer|used to" marketplace/plugins/chat
```

Expected: no output.

```bash
git diff marketplace/plugins/chat | perl -CS -ne 'print "$.: $_" if /^\+.*[\x{2013}\x{2014}]/'
```

Expected: no output.

- [ ] **Step 8: GREEN, 5 reps against the new texts**

Same prompt as Step 1 with the three paths under `RT_TREE/marketplace/plugins/chat/skills/`. Expected: 5/5 pass Q1-Q3. Write to `SCRATCH/skill-tests/chat-plugin-green.md`.

- [ ] **Step 9: Commit**

```bash
git add marketplace/plugins/chat/skills marketplace/plugins/chat/README.md marketplace/plugins/chat/.claude-plugin/plugin.json
```

```bash
git commit -m "chat plugin 0.5.0: identity ends with the session; as names a fresh one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs: chat guide, AGENTS.md pointer, superseded notes

**Files:**
- Modify: `RT_TREE/website/docs/guides/chat.mdx:16,18,24`
- Modify: `RT_TREE/AGENTS.md:89` (the "rt chat" section's reading list)
- Modify: the seven specs listed in Step 3

**Interfaces:** none (prose only).

- [ ] **Step 1: Edit the chat guide**

Line 16 becomes these two paragraphs:

```
This puts you on the buddy list and auto-joins the repository room derived from your current directory (every worktree of the same repo lands in the same room). You get a short first name (`fred`, `jane`) that others see and type, suffixed (`-2`, `-3`) only while another live session holds the same name; behind it sits a hidden identity id that rt acts on.

Every new session is a new identity with no rooms, DMs or unread from earlier sessions, even one that held the same name. `rt chat sign-in --as <name>` continues an earlier identity when no live session holds it; herds and `rt agent start` continue theirs on their own.
```

Line 18 becomes:

```
`--no-room` skips joining; `--room <name>` joins a different room. `rt chat sign-out` leaves the buddy list; your identity ends with your session.
```

Line 24 becomes:

```
DMs (`rt chat dm <name> "..."`) reach one agent directly, delivering unconditionally regardless of wake mode. A name reaches whoever holds it now; the reply hint on a delivered message names the sender's identity id, which reaches that exact agent. DM rooms are real rooms visible in the viewer.
```

- [ ] **Step 2: Add the AGENTS.md pointer**

After the bullet that ends `v4 presence/DMs), the wake protocol, the two heartbeats.` (line 89), insert:

```
- `docs/superpowers/specs/2026-09-27-chat-identity-design.md`: the identity
  model (a hidden id behind every display name, minting, continuation, name
  resolution), which wins wherever an older chat spec treats the handle as
  the identity.
```

- [ ] **Step 3: Superseded notes on the older specs**

For each file below, insert after line 1 (its `#` title; leave the title untouched) a blank line and this blockquote, so it sits above any existing "Superseded in part" block:

```
> **Superseded in part:** `2026-09-27-chat-identity-design.md` replaces this
> document's handle-as-identity statements: a handle is an identity id
> behind a display name, and every new session is a new identity unless it
> explicitly continues one.
```

Files (all under `RT_TREE/docs/superpowers/specs/`):

- `2026-08-23-rt-chat-design.md`
- `2026-08-24-rt-chat-presence-design.md`
- `2026-08-26-rt-chat-qol-design.md`
- `2026-08-26-rt-chat-invite-design.md`
- `2026-08-28-rt-chat-delivery-v2-design.md`
- `2026-09-26-mcp-chat-tools-design.md`
- `2026-09-08-rt-herd-design.md`

- [ ] **Step 4: Verify**

```bash
git grep -c "2026-09-27-chat-identity-design.md" -- docs/superpowers/specs AGENTS.md
```

Expected: each of the seven specs shows `:1`, `AGENTS.md:1`, and the spec itself is not listed.

```bash
git diff website AGENTS.md docs/superpowers/specs | perl -CS -ne 'print "$.: $_" if /^\+.*[\x{2013}\x{2014}]/'
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add website/docs/guides/chat.mdx AGENTS.md docs/superpowers/specs
```

```bash
git commit -m "docs: chat identity in the guide and AGENTS.md; mark older chat specs superseded in part" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: shepherdr engine: minted worker identities, resume continues, DM by name

**Files:**
- Modify: `SKILLS_TREE/attachments/orchestration/shepherdr/SKILL.md:40,156-157,281-282,400-401,472-473`
- Modify: `SKILLS_TREE/attachments/orchestration/shepherdr/README.md:67-68`
- Modify: `SKILLS_TREE/attachments/orchestration/shepherdr/references/job-template.md:110-117`
- Modify: `SKILLS_TREE/.claude-plugin/plugin.json` (version)
- Regenerated: `SKILLS_TREE/skills/shepherdr/SKILL.md`, `SKILLS_TREE/skills/shepherdr/references/job-template.md`
- Test: `SCRATCH/skill-tests/shepherdr-red.md`, `SCRATCH/skill-tests/shepherdr-green.md`

**Interfaces:**
- Consumes: contract `HerdJobInfo.handleName` (the worker's display name) beside `handle` (its id); `HerdInfo.shepherdName`; `herd:resume` continues the shepherd's id; reply hint naming the sender's id.

- [ ] **Step 1: RED, 5 reps against the old compiled text**

Prompt for each rep (with `SHEPHERDR` = `SCRATCH/skill-tests/shepherdr.old.md`, `TEMPLATE` = `SCRATCH/skill-tests/job-template.old.md`):

````
You are testing a skill and the worker brief template it uses. Read both in full; they are your only reference: SHEPHERDR, TEMPLATE
Do not read any other file, run any command, or call any tool other than Read on those two paths.

Facts from the live system:
- herd_status {herd: "h-42"} shows job "picker" as {"name":"picker","handle":"picker.m2x9","handleName":"picker","state":"working"}.
- Your session crashed an hour ago; this is a brand-new session and the user says "pick the herd back up".

Answer each in at most two sentences, exact tool calls in backticks:
Q1. First call in this new session, and do the herd's earlier DMs to the shepherd reach you after it?
Q2. The user rules that the picker must keep fzf ranking. Write the tool call that tells the picker worker.
Q3. You are now the WORKER in job "picker", reading TEMPLATE as your brief. This delivery arrives:
    [dm] frodo #77: switch to the v2 schema
    reply via rt chat post <room> "..." or rt chat dm frodo.q8r1 "..." (never SendMessage; this arrived through rt chat)
    Write the tool call you reply with.
````

Scoring: Q1 PASS = `herd_resume {herd: "h-42"}` and yes, it continues the shepherd's identity. Q2 PASS = `chat_dm {to: "picker", body: ...}` (FAIL = `to: "picker.m2x9"`, which the old text's "the handle herd_status shows" produces). Q3 PASS = `chat_dm {to: "frodo.q8r1", body: ...}` (FAIL = `to: "frodo"`).

Expected RED: Q2 fails in most reps; Q3 fails where the rep follows the template's `{to: <handle>}` with the name from the line. Write to `SCRATCH/skill-tests/shepherdr-red.md`.

- [ ] **Step 2: Edit SKILL.md prerequisite 3 (line 40)**

Replace the line that starts `3. **A fresh session that is picking a herd back up` with:

```
3. **A fresh session that is picking a herd back up calls `herd_resume {herd}` first** (`herd_list` shows the ids). That one call re-points the gate subscription to this session, continues the shepherd's chat identity here (its DMs and unread come with it; a plain sign-in would start an empty identity instead), and returns the open gates, the unread room messages, and every job's state. There is no other resume step.
```

- [ ] **Step 3: Edit the DM line in "how the herd talks" (lines 156-157)**

Old:

```
in Bash, you talk to a worker with the `chat_dm` tool
(`{to: <handle>, body}`), and the daemon records job state as a side effect
```

New:

```
in Bash, you talk to a worker with the `chat_dm` tool
(`{to: <the job's handleName from herd_status>, body}`), and the daemon
records job state as a side effect
```

- [ ] **Step 4: Edit the spawn paragraph (lines 281-282)**

Old:

```
`job` is the job's name (lowercase, `[a-z][a-z0-9_-]{0,31}`); it is also
the worker's chat handle and its tab label. `model` comes from the
```

New:

```
`job` is the job's name (lowercase, `[a-z][a-z0-9_-]{0,31}`); it is also
the worker's tab label and chat display name. The spawn mints the worker a
fresh chat identity under that name, so a job named like an earlier herd's
never inherits that herd's DMs. `herd_status` shows the job's `handleName`
(the name to DM; `<job>-2` while another live session holds the job name)
beside `handle` (the identity id). `model` comes from the
```

- [ ] **Step 5: Edit the reviewer brief line (lines 400-401)**

Old:

```
the job's. Give it a brief that reads the artifact, sends its findings with
the `chat_dm` tool (`to` = the job's handle), and reports a verdict; the
```

New:

```
the job's. Give it a brief that reads the artifact, sends its findings with
the `chat_dm` tool (`to` = the job's `handleName` from `herd_status`), and
reports a verdict; the
```

- [ ] **Step 6: Edit "mid-flight changes" (lines 472-473)**

Old:

```
findings go to the worker through the `chat_dm` tool, `to` = the handle
`herd_status` shows for the job. It lands in the worker's context mid-turn
```

New:

```
findings go to the worker through the `chat_dm` tool, `to` = the
`handleName` `herd_status` shows for the job. It lands in the worker's context mid-turn
```

- [ ] **Step 7: Edit README.md (lines 67-68)**

Old:

```
that re-points the herd's gate subscription and chat handle at the session
you're in now, so new questions start arriving here.
```

New:

```
that re-points the herd's gate subscription at the session you're in now
and continues the shepherd's chat identity there, so new questions and the
herd's DMs start arriving here. A new herd mints its shepherd and every
worker a fresh identity (a worker's display name is its job name), so it
never inherits an earlier herd's DMs.
```

- [ ] **Step 8: Edit the job template's Messages section (lines 110-117)**

Replace the section from `## Messages` through `new instruction; a message that only informs needs no reply.` with:

```
## Messages
Anything from the shepherd or a reviewer arrives in your context as a chat
message (`[#<room>] <name> #<n>: ...` or `[dm] <name> #<n>: ...`) with a
reply hint that names the sender's identity id (`rt chat dm <id> "..."`). <!-- mcp-lint: allow -->
Reply with the `chat_dm` tool, `to` = that id (`{to: <id>, body}`), never
with SendMessage. Only when `chat_sign_in` refuses because this session was
replaced by `/clear`, reply with `rt chat dm <id>` in Bash instead, the <!-- mcp-lint: allow -->
body on stdin from a quoted heredoc. A message that changes your task is a
new instruction; a message that only informs needs no reply.
```

- [ ] **Step 9: Bump the mattstack plugin version**

```bash
git show origin/main:.claude-plugin/plugin.json
```

In `.claude-plugin/plugin.json`, set `version` to the next patch after the one `origin/main` shows (0.25.0 becomes 0.25.1 at the time of writing).

- [ ] **Step 10: Recompile and check**

```bash
rt skills compile --pack mattstack --pack-dir SKILLS_TREE
```

Expected: `skills/shepherdr/SKILL.md` and `skills/shepherdr/references/job-template.md` rewritten; no lint errors.

```bash
rt skills check --pack mattstack --pack-dir SKILLS_TREE
```

Expected: no stale lines (exit 0).

- [ ] **Step 11: Certify and purity**

```bash
sh tests/certify.sh attachments/orchestration/shepherdr
```

```bash
sh tests/certify.sh skills/shepherdr
```

```bash
sh tests/repo-purity.sh
```

Expected: every line `ok`, exit 0 for all three.

```bash
git diff | perl -CS -ne 'print "$.: $_" if /^\+.*([\x{2013}\x{2014}]|RT-[0-9]|SKILLS-[0-9])/'
```

Expected: no output (no dashes, and no ticket ids in engine text that team packs inline).

- [ ] **Step 12: GREEN, 5 reps against the compiled text**

Same prompt as Step 1 with `SHEPHERDR` = `SKILLS_TREE/skills/shepherdr/SKILL.md` and `TEMPLATE` = `SKILLS_TREE/skills/shepherdr/references/job-template.md`. Expected: 5/5 pass Q1-Q3. Before scoring, also check each GREEN answer ran no shell command a tool covers (the mattstack:editing-skills verify question); `rt gate answer` is the only shell form the engine keeps on purpose. Write to `SCRATCH/skill-tests/shepherdr-green.md`.

- [ ] **Step 13: Read the compiled output in full**

Read `SKILLS_TREE/skills/shepherdr/SKILL.md` and `SKILLS_TREE/skills/shepherdr/references/job-template.md` end to end with the Read tool (no grep). Confirm: every seam marker names the new version, no `{{` remains, and each edit from Steps 2-8 appears once, in the right section.

- [ ] **Step 14: Commit**

```bash
git add attachments/orchestration/shepherdr .claude-plugin/plugin.json skills/shepherdr
```

```bash
git commit -m "shepherdr: minted worker identities, resume continues the shepherd's, DM by handleName (0.25.1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Use the version from Step 9 in the subject.)

---

### Task 8: Reconcile with lane 1b, regenerate the MCP reference, open the skills PR

Runs after master Task I2 Step 1 has merged lanes 1b and 2 into `COMBINED_TREE`.

**Files:**
- Modify (if Step 2 or 3 finds drift): `RT_TREE/skills/rt-chat/SKILL.md`, `SKILLS_TREE/attachments/orchestration/shepherdr/references/job-template.md`
- Regenerate: `SKILLS_TREE/attachments/mcp-tools/reference.md`
- Maybe regenerate: `RT_TREE/website/docs/reference/chat.mdx`

**Interfaces:**
- Consumes: lane 1b's `lib/daemon/inbox.ts` reply hint, `lib/mcp/chat-tools.ts` `chat_sign_in` result, and the `rt mcp tools --json` catalog.

- [ ] **Step 1: Merge lane 5's rt commits into the combined tree**

This is master Task I2 Step 1's lane 5 merge; from `COMBINED_TREE`:

```bash
git merge --no-ff chat-identity-lane5 -m "merge lane 5: skills, plugin, docs"
```

Expected: clean merge (lane 5 touches no source file other lanes own).

- [ ] **Step 2: Reconcile the reply hint wording**

```bash
grep -n "rt chat dm" COMBINED_TREE/lib/daemon/inbox.ts
```

Compare the emitted hint with the example line `reply via rt chat post <room> "..." or rt chat dm remy.k3f9 "..." (never SendMessage; this arrived through rt chat)` and the batch line `  reply to remy: rt chat dm remy.k3f9 "..."` in `skills/rt-chat/SKILL.md` (Task 2 Step 5), which follow lane 1b's Task 3 wording. If lane 1b's shipped wording differs, replace that one example line with lane 1b's exact text (with `remy.k3f9` as the id) in `RT_TREE/skills/rt-chat/SKILL.md`. If lane 1b emits one hint for a batch naming only one sender (CONTRACT ISSUE 1), change the sentence `Lines show names; the reply hint names each sender's identity id.` to `Lines show names; the reply hint names the sender's identity id, and \`chat_buddies\` or a claim's \`author\` gives the id of any other sender in a batch.` Commit in `RT_TREE` only if something changed:

```bash
git add skills/rt-chat/SKILL.md
```

```bash
git commit -m "rt-chat skill: match the daemon's reply hint wording" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then repeat the merge from Step 1 into `COMBINED_TREE`.

- [ ] **Step 3: Reconcile the sign-in result fields**

```bash
grep -n "continued\|name" COMBINED_TREE/lib/mcp/chat-tools.ts
```

Expected: the `chat_sign_in` handler returns `handle`, `name`, `room` and `continued`. If any field is named differently, change `It returns \`{handle, name, room, continued}\`` in `RT_TREE/skills/rt-chat/SKILL.md` and the field names in `RT_TREE/marketplace/plugins/chat/skills/sign-in/SKILL.md` to match, and commit as in Step 2 with the subject `chat skills: match chat_sign_in result fields`.

- [ ] **Step 4: Regenerate the generated CLI docs if lane 1b changed chat help**

From `COMBINED_TREE`:

```bash
bun run docs:check
```

Expected: pass. If it reports `website/docs/reference/chat.mdx` stale, run `bun run docs:gen`, confirm `git status --short` shows only generated reference files, and commit them there:

```bash
git add website/docs/reference
```

```bash
git commit -m "docs: regenerate chat reference for the identity flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Capture the MCP catalog under an isolated HOME**

```bash
mkdir -p SCRATCH/rt-home
```

From `COMBINED_TREE`:

```bash
env -i HOME=SCRATCH/rt-home PATH="$PATH" bun cli.ts mcp tools --json > SCRATCH/mcp-tools.json
```

Expected: exit 0; `grep -c '"chat_sign_in"' SCRATCH/mcp-tools.json` prints at least `1`.

- [ ] **Step 6: Regenerate reference.md**

From `SKILLS_TREE`:

```bash
bun scripts/gen-mcp-tools.ts < SCRATCH/mcp-tools.json > attachments/mcp-tools/reference.md
```

```bash
git diff --stat
```

Expected: `attachments/mcp-tools/reference.md` changed (the chat and herd tool descriptions lane 1b rewrote); nothing else.

```bash
rt skills check --pack mattstack --pack-dir SKILLS_TREE
```

Expected: exit 0. If it names shepherdr as stale, rerun Task 7 Step 10's compile and include the compiled files in this commit.

- [ ] **Step 7: Commit, push, open the PR**

```bash
git add attachments/mcp-tools/reference.md
```

```bash
git commit -m "mcp-tools reference: chat identity tool descriptions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Push with `git_push {tree: "SKILLS_TREE", setUpstream: true}`. Then, from `SKILLS_TREE`:

```bash
gh pr create --base main --title "shepherdr and mcp-tools reference: chat identity" --body-file SCRATCH/skills-pr-body.md
```

with `SCRATCH/skills-pr-body.md` written first (Write tool) as:

```
Every rt chat session now gets a hidden identity id behind its display name. This updates the shepherdr engine and the MCP tools reference to match.

- shepherdr: `herd_resume` continues the shepherd's identity; workers are minted under their job name; DM a worker by the `handleName` `herd_status` shows
- job template: workers reply to the id the delivery's reply hint names
- reference.md regenerated from `rt mcp tools --json` on the chat identity branch
- version bump for the engine change

Merge after the rt chat identity PR merges, so `tests/test-mcp-tools-reference.sh` matches the `rt` on PATH.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Expected: a PR URL. Wait for CodeRabbit and CI per the CodeRabbit rule; address actionable findings. Do not merge yet (Task 9).

---

### Task 9: Publish (runs at master Task I5 Step 4)

Precondition: the rt PR is merged, and master Task I5 Step 1 has pulled `main` into the shared checkout `/Users/matt/Documents/GitHub/repo-tools` and restarted the dev daemon. That pull is also the deploy for `rt:chat` and `rt:repo-identity`.

**Files:**
- Modify: `/Users/matt/Documents/GitHub/mattstack-marketplace/plugins/chat/` (local overlay copy)

- [ ] **Step 1: Local marketplace overlay of chat 0.5.0**

```bash
cd /Users/matt/Documents/GitHub/mattstack-marketplace
```

```bash
git status --short
```

Expected: no output (clean). Then:

```bash
cp -R /Users/matt/Documents/GitHub/repo-tools/marketplace/plugins/chat/. plugins/chat/
```

```bash
diff -r /Users/matt/Documents/GitHub/repo-tools/marketplace/plugins/chat plugins/chat
```

Expected: no output.

Read the shared checkout's head (it is `main` after master Task I5 Step 1):

```bash
cd /Users/matt/Documents/GitHub/repo-tools
```

```bash
git rev-parse --short=9 HEAD
```

Back in the marketplace checkout, commit with that sha as `<sha9>` (do not push; the next rt release's `scripts/release/marketplace.sh` publishes and supersedes this overlay):

```bash
cd /Users/matt/Documents/GitHub/mattstack-marketplace
```

```bash
git add plugins/chat
```

```bash
git commit -m "local overlay: chat 0.5.0 from rt <sha9> (not published; next marketplace publish supersedes)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Update the installed chat plugin**

```bash
claude plugin update chat@mattstack
```

```bash
ls ~/.claude/plugins/cache/mattstack/chat/
```

Expected: a `0.5.0` directory.

- [ ] **Step 3: Merge the mattstack-skills PR**

With CodeRabbit addressed, CI green and Matt's confirmation, merge the Task 8 PR. Dispose the lane tree: `worktree_dispose {repoName: "/Users/matt/Documents/GitHub/mattstack-skills", tree: "<SKILLS_TREE's tree name>"}`.

- [ ] **Step 4: Sync the mattstack pack**

Call `rt_verb {args: ["skills", "sync", "--pack", "mattstack"]}`. Expected: success, `restartNeeded` true. On `failed (exit 1)`, run the bare Bash `rt skills sync --pack mattstack` to read each step's reason and follow mattstack:editing-skills.

- [ ] **Step 5: Sync every team pack that compiles shepherdr**

```bash
ls -d /Users/matt/.mattstack/teams/*/mattstack/packs/*
```

For each pack directory's basename, call `rt_verb {args: ["skills", "check", "--pack", "<pack>"]}`. For each that comes back `failed (exit 1)` or whose `installed` object reads `status: "lagging"`, call `rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}`. Expected: every check then succeeds with `installed.status` current.

- [ ] **Step 6: Verify the installed copies**

```bash
cd /Users/matt/Documents/GitHub/mattstack-skills
```

```bash
sh tests/test-mcp-tools-reference.sh
```

Expected: `ok   mcp-tools-reference`.

```bash
grep -c "handleName" /Users/matt/.claude/plugins/cache/mattstack/mattstack/<version from Task 7 Step 9>/skills/shepherdr/SKILL.md
```

Expected: `3` or more (Steps 3-6 of Task 7). The same grep on each team pack's installed `skills/shepherdr/SKILL.md` gives the same count.

- [ ] **Step 7: Reload plugins in running sessions**

In this herdr pane: `rt pane send self --text "/reload-plugins" --then "Continue: chat identity lane 5 publish, confirm chat:sign-out and shepherdr load the new text"` and end the turn. Other running sessions: ask Matt to run `/reload-plugins` in each.

- [ ] **Step 8: End-to-end check**

After the reload, invoke `chat:sign-out` and `mattstack:shepherdr` by name (Skill tool) and confirm the loaded text contains "Your identity ends with your session" and "handleName" respectively.
