# mattstack-mods

The Claude Code mod for mattstack's harness integrations: a plugin of
function hooks that gives Claude Code sessions a direct path for chat
delivery, gates, presence, policy and supervision. rt installs it only when
`agent.integrations.enabled` is on. Each feature falls back to its existing
hook or CLI path when its block is not live.

It needs Claude Code 2.1.293 or newer (`MIN_CLAUDE_CODE` in
`src/core/version.ts`). On an older engine, or in a session with no person
at the prompt (`claude -p`, the SDK), the plugin loads but starts no block,
so every feature takes its existing path.

## Layout

| Path | What it is |
| --- | --- |
| `hooks/register.ts` | The one module `hooks/hooks.json` names. It builds the hub and the link and registers the blocks. |
| `src/core/hub.ts` | The hub. It owns every engine hook and fans each event out to the blocks. |
| `src/core/link.ts` | The daemon link: register, heartbeat, `/clear`, end, waits and pushed commands. |
| `src/core/rpc.ts` | One call to a daemon verb over `rt.sock`, capped at 25 s. |
| `src/core/blocks.ts` | The block names. It imports nothing, so an rt-side bun test can compare it with rt's copy. |
| `src/core/version.ts` | The minimum engine version, the check against it, and the plugin version the link reports. |
| `src/blocks/` | One file per feature block. `delivery.ts` is the delivery router; `presence.ts` reports turns and signs the session in to rt chat; `gate-form.ts` races a gate's form against the gate's own answer; `gate-wait.ts` waits on a wait gate and wakes the session with its answer; `gate-panel.ts` lets a person answer the session's own open gate from its pane. |
| `src/blocks/display.ts` | The display kit: `formPane` asks a gate in a focused pane. Each kit owns one pane id: the gate form's, or the gate panel's. `gate-view.ts` holds its drawing parts, and `gate-ctx.ts` the port of the board's gate-ctx parser. |
| `src/blocks/sections.ts` | The reply rule section's text and the reply-line trim. It imports nothing, so an rt-side bun test can compare it with rt's copy. |
| `types/index.d.ts` | The plugin's own contract: the `$.state` values it keeps. |
| `tests/` | `claude plugin test` cases. They drive the hub and link with the stubbed `$` in `tests/stub.ts`. |

## Blocks only see the facade

The engine follows `$` only into top-level functions of the file that
received it. It never follows `$` across an import or into a stored callback,
and `claude plugin validate` refuses a module that tries. So blocks never
receive `$`. `hub.ts` builds a narrow facade, `ModApi`, from `$` in the same
file that registers the engine hooks, and hands blocks that instead. A block
that needs another engine call adds a member to `ModApi` in `hub.ts`. A
`$.state` or `$.env` member names its key as a literal, since the engine only
accepts literal keys.

A block registers with `hub.block(name, start)`. `start` receives the facade
and a scope, and everything it subscribes to through that scope (tool rules,
delivery receivers, stop handlers, lifecycle events, render sites, prompt
sections) belongs to it. If one of those throws, the hub logs it to the debug
log, clears the block for the session and passes the event through as if the
mod were not there. What is subscribed on the hub itself belongs to the core
and never lapses. A `start` that has not settled after 3 s counts as failed,
and the next block starts.

Delivery receivers run in the order they subscribed, as middleware. A
receiver answers `{ consumed }` to take the delivery, calls `next` with the
delivery (edited or not) to pass it down, and gets back `{ text }`, the text
actually queued. A receiver that answers nothing passes the delivery on as it
came. As with tool rules, a rejection that comes up through `next` keeps the
block live.

Tool rules run in five stages:

- `fill` returns the call's input, edited or not.
- `guard` returns `{ refuse }` to stop the call.
- `permit` wraps the call as middleware. Its `next` carries the engine's
  `signal`, which aborts when the person interrupts the call, so a wait the
  rule starts can end with it.
- `tap` sees the result after the call.
- `check` answers `tool.check` with a decision.

## The daemon link

`createLink(hub).start()` in `register.ts` subscribes the link before any
block, so it sees deliveries first. Once the blocks have started, it calls
`session:register` over `rt.sock` (`RT_DAEMON_SOCK`, else
`$HOME/.mattstack/rt/rt.sock`) with the live blocks, keeps only the blocks the
daemon answers, and heartbeats every 10 s. A `/clear` re-registers under the
new session id, naming the old id and link. Any other session end sends
`session:end` and turns every block off. If the process then resumes another
session in place (`/resume`), its SessionStart registers that session fresh,
with no previous ids, offering every block that started and has not failed
since. An `unknown-link` answer (the daemon
restarted) registers again with the same session id; a `refused` or `invalid`
register turns every block off for the session. Any other register the daemon
did not take (no answer, `transient`, or a handler that failed) is sent again,
unchanged, on the next beat. When the hub clears a block, the link
re-registers the same session with the blocks still live, so the daemon stops
counting it; clears within 50 ms share one re-register. Each re-register for
the same session (a cleared block, or rt forgetting the link) names the link it
replaces as `previousSessionId` and `previousLinkId`. While a session has a
live link, rt takes a register for it only when it names that link and answers
any other `transient`, so a register retried that way goes through once the
other link lapses (30 s without a heartbeat). A SessionStart from a
resume or a compaction of the linked session sends `session:report` with the
event and the session's cwd, root and pane; rt treats that context as a hint.
An `unknown-link` answer re-registers and sends the report once more.

A block reaches the daemon through the link:

- `link.wait(pattern, after, until, signal)` long-polls `events:wait` in
  20 s rounds, passing the cursor, and retries a dropped round with the same
  cursor.
- `link.wait` beats at once when a round is lost in transport, so a daemon
  that restarted learns of the link again without waiting for the next beat.
- `link.call(verb, payload)` sends a verb that names the link, adding
  `linkId`. An `unknown-link` answer registers again and sends it once more.
- `link.onCommand(kind, handler, block)` takes the commands rt sends with
  `pushModCommand`. Each arrives as an inbox delivery that is exactly
  `<rt-mod-command id="..." kind="..." link="<link id>">json</rt-mod-command>`.
  Any inbox writer can send that text, so the link acts on it only when `link`
  is its own current link id, which only the daemon holding the link knows.
  An envelope naming no link or another one (forged, or stale after a
  re-register) is consumed and logged, never acked or handled. Text that is
  not exactly one envelope reaches the model unchanged, and so does every
  delivery in a session whose blocks never started. The link consumes a matching
  envelope before the model sees it, acks it with `session:ack` at once
  (the ack means the mod owns it), then runs the handler. A command with no
  handler, or whose block is not live, is not acked, so rt takes its fallback.
  So is one the handler's `accepts` check answers false for; `accepts`
  gets the facade too and may answer later. A command whose `session:ack`
  rt does not take is never handled, since rt then takes its fallback. The
  handler gets the command and the link's own facade, for work that
  outlives the delivery that carried the command.
- `link.onLinked(listener)` hears every register rt takes (the first, a
  `/clear`'s continuation, a re-register after a daemon restart) with the
  facade and the registered session id.

The core answers two diagnostic commands, the only kinds `rt.sock`'s
`session:push` will send: `probe.ping` logs and acks, and `probe.wait` (`{ pattern, after }`)
runs a wait of up to 5 minutes and logs where it ended. Every link line goes to
the debug log, prefixed `mattstack-mods:`.

## The delivery router

The `delivery` block (`src/blocks/delivery.ts`) takes each delivery that is
wholly one rt envelope carrying a delivery id:
`<cross-session-message from-name="..." delivery-id="...">`, then the body,
then `</cross-session-message>`. Gate notices and other sessions' messages
have no delivery id, so they pass through untouched.

- It passes the delivery to the model through `next`. Each edit in
  `registerDelivery(hub, link, { edits })` rewrites only the body, in order,
  and the router rebuilds the envelope around it. An edit can never put text
  after the closing tag, where the model reads it as outside the message.
  With no edit, or one that changes nothing, the original event goes down.
- Once the delivery is queued, it sends `session:delivered` with the delivery
  id, which makes rt's record of it `consumed`. A delivery is reported once.
  A delivery a hook beneath consumed is not reported.
- It draws the delivery's row as nothing (`UserMessage`), matched on the
  queued body and a peer origin. ctrl+o (`isExpanded`) shows the row in full,
  and the stored message the model reads does not change. The router keeps
  the last 200 bodies.

## The presence block

The `presence` block (`src/blocks/presence.ts`) gives rt the session's own
view of itself:

- **Turns.** Each turn start and end goes to rt as `session:report` with
  event `turn-start` or `turn-end`, so the buddy list reads the session live
  or idle from its own turns instead of herdr's status. A subagent's
  `turn.complete` (it carries `agentId`) is not the session's. Reports go out
  in order and the turn never waits on one.
- **Sign-in.** `rt chat sign-in`, `/chat:sign-in` and the Flock button reach
  rt's `chat:sign-in`, which sends the session a `chat-sign-in` command when
  this block is live. The block answers by calling `chat:sign-in` over the
  link with its own session id, its `root()` as the cwd (so the room follows
  EnterWorktree) and the command's id. rt takes that call only while the
  command still waits. A command that arrives while the block is not live is
  not acked, and rt signs the session in its own way.
- **End.** The session's end reaches rt through the link's own `session:end`,
  which signs the session out. A `/clear` is not an end: rt moves the
  sign-in to the new session id when the link continues.

## The gate form

The `gate-form` block (`src/blocks/gate-form.ts`) takes over how a form gate
ends in this session. An agent opens a form gate with `gate_ask`, then draws
AskUserQuestion. The block never opens a gate. Its `permit` rule on
AskUserQuestion:

1. Reads the event cursor (`events:head`), then this session's own live form
   gates (`gate:list { open: true, session, presentation: "form" }`), and
   links the call to one with as many questions as were asked, each asked
   question its own: the newest whose labels match the asked text exactly,
   else the one whose labels the asked text holds that are longest together.
   With no match it passes the call through untouched.
2. Shows the dialog with `next(e)`, and at the same time waits on
   `gate/{answered,closed}/<id>` from that cursor with `link.wait`.
3. The first to finish wins:
   - The person's pick goes to the model as usual, and the block records
     nothing: the model's own `gate_answer` after the form is the record.
   - A gate event reads the gate's row back (`gate:list { session,
     presentation: "form" }`) and closes the dialog with the row's answers,
     keyed by question text and spelled as option labels, plus a line
     naming the surface that answered. A closed or superseded gate closes
     it with no answers and a withdrawn line.
   - An interrupt aborts the wait with the call.
   - The wait ends as soon as the dialog settles. A round already in
     flight runs out on the daemon, since `$.http.fetch` takes no signal.

The person dismissing the dialog (Escape) does not reject `next(e)`: the
engine resolves it, as an errored call or a result with no answers and no
typed response. The block counts either shape, or a rejection, as dismissed.

rt completes a gate in a session with this block live by pushing
`gate-complete { id }` instead of reading the pane, ringing the doorbell and
sending Escape. The block acks it for any gate it linked, whether or not the
dialog is still up, since its own wait is what closes the dialog. It does
not ack a gate whose dialog the person dismissed, or one it never linked:
the model has nothing to read there, so rt rings the doorbell once. It never
sends Escape in this session, since the form on screen may be another
gate's dialog; the queued doorbell is read once that dialog ends. Doorbell rows
(`[gate] <id> answered by ...`, superseded, closed) left over for a linked
gate draw as nothing, except for a dismissed one.

A doorbell for any gate the block linked goes to the model unchanged. Once it
is queued, the block reads the gate with `gate:wait { id, waitMs: 0,
sessionId }` under its own session id, which rt records as the session's read,
so rt's sweep stops ringing that doorbell again.

## Wait gates

The `gate-wait` block (`src/blocks/gate-wait.ts`) stands in for the
background `rt gate wait` a skill runs after `gate_ask` opens a wait gate.
When this session asks for a wait gate, rt pushes `gate-wait { id, deadline }`
before it answers `gate_ask`, where `deadline` is when rt stops waiting for
the ack. The block acks a readable gate id up to 1 s before that deadline,
and refuses it after, so a late delivery never starts a second waker beside
the `rt gate wait` an unacked reply sends the session to. On the ack rt adds
`wake: "mod"` to the reply and stamps the gate's `origin.wake: "mod"`. The
skill sets its `waiting-gate` run field, sees `wake`, and ends the turn
without running the wait. With no ack, rt leaves `wake` out and the skill
runs `rt gate wait` as it does without the mod. The block then:

1. Reads the event cursor (`events:head`), then this session's wait gates
   (`gate:list { session, presentation: "wait" }`), so a gate answered
   before the wait began still ends it. A gate this session did not ask
   (its `origin.session` is another's) gets no wait.
2. Waits on `gate/{answered,closed}/<id>` from that cursor with `link.wait`,
   and reads the row again (`gate:wait { id, waitMs: 0 }`) after each event
   for the gate.
3. Starts the next turn with `$.prompt.submit`, framed as this plugin's
   message. The engine queues it while a turn runs.
   - An answer: `[gate] gate <id> was answered by <surface>: <qid> =
     <values>; .... Its gate wait result: <json>`. The summary line joins
     each question's values with `, ` (`none` for an empty pick), adds ` (note: ...)` on one line
     (clipped to 120), and is clipped to 400. The JSON is what `rt gate
     wait` prints, less the gate's context and questions, which the session
     already holds.
   - A close: `[gate] gate <id> was withdrawn (<reason>). Its gate wait
     status is closed.`
   - A gate the registry no longer has: a "not found" line.
   - An answer this session recorded itself (`answer.session` is its id,
     before or after a `/clear`) starts no turn: the model already holds it.
4. Records the gate as read once its turn is in (`gate:wait` with the
   asking session's id, which rt counts as that session's read of a gate
   stamped `wake: "mod"`).

A wait that fails (the daemon restarting, a refused round) starts again
from a fresh cursor, at most 30 s apart, and a submit the engine refuses or
a hook drops is asked again on the same schedule, until it goes through or
the session ends. The wait lives in this process, not in the conversation,
so a `/clear` while waiting keeps it, and the turn it starts lands in the
new conversation. A session end drops every wait.

When the block starts, and after every register rt takes, it lists this
session's wait gates again and resumes a wait for each one stamped
`wake: "mod"` that the session has not read. A reloaded plugin so picks up
its waits, an answer that landed while no wait ran is delivered once, and a
gate the model covers with its own `rt gate wait` is never touched.

## The gate panel

The `gate-panel` block (`src/blocks/gate-panel.ts`) lets a person answer a
gate from the pane of the session waiting on it, as a herd worker waits for
its shepherd. After each register rt takes and at the end of each turn, it
reads the event cursor, then this session's own open gates of any
presentation (`gate:list { open: true, session }`). rt stamps a gate's
`origin.session` with the asking session it resolved itself, for
`gate_ask`, `herd_ask` and `herd_milestone` alike. The block never looks at
the pane id, since herdr reuses them, and it drops any row whose
`origin.session` is not this session's, for a daemon that ignores the
filter. Each listed gate is watched with `link.wait` on `gate/*/<id>`, and
any event for it reads the list again, so an answer elsewhere or a close
takes the row away without a timer.

A gate whose AskUserQuestion dialog the `gate-form` block has linked and up
is left out of the row while the dialog stays: it already has its answer
surface. `registerGateForm` returns that fact (`up(id)`, `onChange`), and
the row is drawn again whenever a linked dialog's state changes.

While a gate is open the band above the prompt shows one row,
`Waiting on your answer   <kind> <subject> · <N> questions · <first
question>`, with a plain `1: Answer` Button at its right end and a line
counting any more behind it. A survey in the band takes precedence.
Pressing it (`1` at an empty prompt, or a click) opens the `gate-panel`
pane through the display kit, asking for 40% of the terminal's width (at
most 80 columns) when it docks. The width is the render's viewport, else
the band's own columns plus the engine's five, else 80. While the pane is open the row reads
`Answering in the panel  →` with the question it is on, and draws no
Button, so a second `1` presses nothing. On a narrow band (beside the
docked pane) its hint and counter shorten to `esc back` and `i/N` first,
then the summary drops the kind and subject, then the question count,
and last the current question's label is clipped.

Chunks of one multi question (`findings-1`, `findings-2`, ..., which a
skill splits only because the native dialog caps a question at four
options) are joined into one page, as the board joins them
(`src/blocks/gate-chunks.ts`, a port of gate-kit's `chunks.ts`). The page
takes the first chunk's label and every chunk's findings@1 or skipped@1
entries. Its picks go back to rt per chunk, `[]` for a chunk with none,
with the page's note (when it has a Note field) on the first chunk. Unlike
a plain multi question, a joined page takes no picks (`Next: none picked
→`), since posting no findings is a real outcome; every chunk then goes as
`[]`. The counter, the dots and the band's question count all count pages.
Chunks that are not adjacent draw unjoined. A per-thread question (thread@1,
reply@1 or carryover@1 context, or a `post:<id>` / `resolve:<id>` option
pair) is never a chunk, so a respond-post gate's `thread-1..n` stay one
page each, as on the board. A findings@1 or skipped@1 page has no Note
field: the board has none there and the review skill drops it.

The pane draws the gate the way the board's gate sheets do: a header with
the kind, the subject and the progress, the gate's context on the first
question (review@1, plan@1 and post@1 drawn as their facts, prose clipped
to eight rows), the question with its own context (thread@1, reply@1,
carryover@1, skipped@1, replies@1, or prose clipped to six rows), then one
Button per option with what it means under it: a `recommended` tag lifted
off the label, its findings@1 finding matched by option value (severity,
file, and its fix, or its body clipped to three rows when it has no fix),
or its description. A JSON context of any other shape is not shown. The gate-ctx
shapes are a port of the board's parser (`src/blocks/gate-ctx.ts`). A
matched finding's label drops the `[Critical]`-style tags its subtext
already shows. Secondary text is the `inactive` theme key; `subtle` is
only for borders. Each option takes a letter hotkey (`a` to `z`), and no
pane control takes a digit, since a repeat of the band's `1` would land on
one. The pane has no Skip of its own: Esc closes it, answering nothing.
A letter answers a single question and ticks a multi question, whose Next
(Done on the last) moves on. Back returns to the previous question with its
picks and note kept.

Every question change scrolls the pane to its top and moves the focus
(`ui.focus` and `ui.scroll` through the facade, since `autoFocus` only
applies when the pane takes the keys) to the first choice, or to the
earlier pick of a single question Back returns to. The display kit hooks
its own pane's `ui.scroll`, `ui.focus` and `ui.press` (`hub.onPane`):

- A person's one-row move by key (`↑`, `↓`) steps the focus through the
  choices, the note, Next and Back instead of scrolling, and scrolls past
  the first and the last. The wheel and page keys scroll as usual.
- For 700 ms after the pane opens or its question changes, a choice's
  press is ignored unless the person moved onto that choice, so `1` and
  typing straight on cannot answer with the next letter. `ui.press` does
  not say whether a hotkey, Enter or a click pressed, so Enter on the
  first choice in that window is ignored too. Next on a joined page with
  nothing picked is held the same way, since it would post no findings.

The pane closes by itself when the gate is answered elsewhere or withdrawn.

An answer there is `gate:answer { id, answers, by: "pane-person" }`, with
no session, so rt records it as a person's answer from this pane
("this session's pane, by a person") and treats it like a board answer: the
`gate-wait` block, `rt gate wait` or the doorbell wakes the session, and the
shepherd and board hear of it through the usual fan-out. rt lets
`pane-person` answer a herd-owned gate, as it does `pane`. Only a press in
the band or the pane reaches `gate:answer`: the block subscribes to no tool
call, delivery or command. An answer that lost the race to another surface,
or that rt refused, is reported in the transcript.

## The reply rule section

The core adds one prompt section, `mattstack-mods:reply-rule`, to every
prompt in a session where the blocks started: the chat reply rule, word for
word as rt's sign-in frame states it. A session on an older engine, or with
nobody at the prompt, gets no section. Two renders also go without it: an
in-process teammate's view of its lead's prompt (`teammate`), since
SendMessage is how a teammate reports to its lead, and a `/context` render
(`analysis`), which sends nothing and never sets the value below.

The `sectionComposed` state value is true only in a conversation whose
prompt has carried the section since it started. A SessionStart from startup
or `/clear` opens a conversation, and the first prompt composed after it sets
the value. A resume or a fork sets it false, and so does `/clear` until its
first prompt. A plugin loaded mid-conversation sees no SessionStart, so it
leaves the value unset.

While the value is true, the router's `trimReplyUnderSection` edit drops the
Claude-only tail, `(never SendMessage; this arrived through rt chat)`, from
the reply line rt appends to each delivery. Who sent the delivery and how to
reply stay. Every other conversation gets the full line, as rt sends it.
`lib/agent-integrations/__tests__/mods-plugin-parity.test.ts` holds the
section to rt's sign-in frame and the trim to `replySteer`.

## Checks

```bash
claude plugin validate plugins/mattstack-mods
(cd plugins/mattstack-mods && claude plugin test)
```

CI runs both, pinned to Claude Code 2.1.294, in the `plugin-mattstack-mods`
job. A pull request that changes this folder has to bump the version in
`.claude-plugin/plugin.json`.

To type-check, load the folder once (`claude --plugin-dir plugins/mattstack-mods`)
so the engine writes its types into `.claude-plugin/types/` (git ignores
them), then run `tsc -p plugins/mattstack-mods`.
