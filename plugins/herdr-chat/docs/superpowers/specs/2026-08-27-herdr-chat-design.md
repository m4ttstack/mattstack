# herdr-chat: chat where the agents live

A herdr plugin that puts `rt chat` next to the panes. It is a sibling to the
web viewer, not a replacement: the viewer is the reading surface, this plugin is
the acting surface. Builds on `2026-08-26-rt-chat-invite-design.md` (the pane
picker, `rt pane list`, `chat:invite`) and reuses its herdr injection model.
Where this document disagrees with the invite design, the sections named under
**What this changes elsewhere** win.

## Problem

Chat today has three parts: the rt daemon (rooms, presence, messages), the web
viewer (the human's reading window), and the Claude Code chat plugin skills
(sign-in, join, recruiting). The invite feature adds pane awareness to rt and a
picker to the viewer. What is still missing is a surface where the human can
*act on the panes from chat context* without leaving the keyboard:

- Broadcasting one instruction to several agents means opening the viewer,
  building a room, and inviting, or typing the same thing into each pane by
  hand. There is no one-to-many "just tell these five agents this."
- A chat mention from `fred` tells the human `fred` said something, but getting
  to fred's actual pane is a manual hunt across workspaces.
- Presence exists, but panes are not online by default, so "who can I reach"
  is usually a short and stale list.
- The viewer can *see* chat but cannot *touch* a pane. It is a web app. Signing
  a pane in, focusing a pane, injecting into a pane... none of it is reachable
  from the browser.

herdr is where the panes and agents live, and herdr now has a plugin system
(manifest actions, event hooks, plugin panes, keybindings, the whole herdr CLI
as the API). That plugin surface is the missing piece.

## The boundary (the core product decision)

The plugin earns its place only by doing what the viewer structurally cannot.
The dividing line, which every feature is tested against:

> **The plugin's verbs are _act, glance, jump_. The viewer's verbs are _read,
> compose_.** When the human wants to read, the plugin hands off to the viewer.

This is not a size limit, it is a role. A terminal transcript reader would be
strictly worse than the viewer and pure duplicated noise, so it is out. What is
in is the set of things that touch panes or need a keystroke-fast glance:

| In the plugin (act / glance / jump) | In the viewer (read / compose) |
| --- | --- |
| Broadcast a message into selected panes | Reading a room's transcript |
| Jump from a chat identity to that agent's pane | Catching up on history |
| Sign a pane in / out; prompt on agent start | Rich multi-line composing |
| Peek: who is online, what is unread for me | Browsing rooms |
| Quick-send one line to a room or DM | Day dividers, code copy, the long read |
| Open the viewer (hand-off) | (the plugin opens this) |

The rule keeps overlap at zero. Anything that starts to feel like reading is a
signal it belongs in the viewer, reached through the open-viewer hand-off.

## The architecture in one line

rt stays the brain; the plugin is a second client.

```
                 rt daemon (rooms, presence, messages, panes)
                /                                        \
     web viewer (the big screen)              herdr-chat plugin (in the panes)
                                                         |
                                        drives: rt CLI, herdr CLI, deck HTTP API
```

The plugin reimplements no chat logic. It shells `rt` for chat and pane data,
`herdr` (via `HERDR_BIN_PATH`) for pane focus and context, and deck's HTTP API
for the viewer URL. Its only persistent state is small and its own.

## Decisions and rationale

Ratified in brainstorming, 2026-08-27:

1. **It is a herdr plugin, not a viewer feature and not a Claude Code hook.**
   The capabilities are pane-shaped, and herdr owns panes: it knows every pane,
   which run Claude, each agent's status, and it can focus and inject. A viewer
   feature cannot touch a pane; a Claude Code SessionStart hook lives inside one
   pane and cannot see the desk.
2. **rt stays the brain; the plugin is a client.** It drives `rt` and `herdr`
   rather than duplicating chat. Rejected: the plugin talking to the rt daemon
   socket directly (rt-client's job) or reimplementing presence joins (rt's
   `pane list` already does the sessionId join).
3. **Rust + ratatui + crossterm, themed to herdr.** herdr is Rust +
   ratatui 0.30 + crossterm 0.29 with a real theme system. Matching its stack
   lets the popups read herdr's active theme and feel native rather than
   approximate it, and a compiled binary makes the glance popups feel instant.
   Rejected: Bun/TS (estate-native but foreign inside herdr, and slower cold
   start for a popup).
4. **Broadcast injects through a new `rt pane send`, not plugin-side herdr
   calls.** The invite feature already solved injection delivery (blocked is
   refused, working is queued, a stalled prompt gets one Enter nudge) inside
   `chat:invite`. Extracting that as a general `rt pane send` gives broadcast
   the same battle-tested path and keeps one injection implementation. Rejected:
   the plugin driving herdr `agent.prompt` itself (a second copy of the quirks).
5. **Prompt-on-start rides the `pane.agent_detected` event.** herdr fires it
   when it detects an agent in a pane. A plugin event hook on it drives sign-in,
   with a per-repo remembered preference (`ask` / `always` / `never`). This is
   what makes "most panes online" cheap and low-friction, and it needs no Claude
   Code hook. Rejected: silent auto sign-in (the thing Matt deliberately avoided
   before) and a prompt on every start (nags).
6. **Open-viewer is sourced from deck, not the setting.** deck's HTTP API
   (`GET /api/v1/apps/chat` -> `row.url`) derives `https://chat.mattstack`
   structurally from its registry and survives port or host moves.
   `chat.viewerUrl` is the fallback when deck is unreachable.
7. **Reading is out.** No transcript reader, no rooms browser, no status strip.
   The plugin hands off to the viewer for all of it.
8. **Six capabilities, one binary.** broadcast, jump-to-pane, sign-in/out (plus
   prompt-on-start), peek, quick-send, open-viewer. One Rust binary with a
   subcommand per manifest entrypoint.
9. **Depends on the invite feature landing on main.** The picker reads
   `rt pane list`; broadcast adds `rt pane send` next to `chat:invite`. Build
   starts after invite merges.

## The plugin (herdr-chat)

Repo `m4ttstack/herdr-chat`, plugin id `m4ttstack.chat`, a `herdr-plugin.toml`
at the root, installable with `herdr plugin install m4ttstack/herdr-chat`.
macOS first (the estate is macOS, deck's `open` and the deck API are local);
Linux is a named follow-up.

### Manifest shape

```toml
id = "m4ttstack.chat"
name = "Chat"
version = "0.1.0"
min_herdr_version = "0.8.2"
description = "rt chat where the agents live: broadcast, jump-to-pane, presence"
platforms = ["macos"]

[[build]]
command = ["cargo", "build", "--release"]

[[actions]]
id = "broadcast"
title = "Broadcast to panes"
contexts = ["workspace"]
command = ["target/release/herdr-chat", "broadcast"]

[[actions]]
id = "peek"
title = "Chat peek"
contexts = ["workspace"]
command = ["target/release/herdr-chat", "peek"]

[[actions]]
id = "quick-send"
title = "Quick send"
contexts = ["workspace"]
command = ["target/release/herdr-chat", "quick-send"]

[[actions]]
id = "sign-in"
title = "Sign this pane into chat"
contexts = ["pane"]
command = ["target/release/herdr-chat", "sign-in"]

[[actions]]
id = "sign-out"
title = "Sign this pane out of chat"
contexts = ["pane"]
command = ["target/release/herdr-chat", "sign-out"]

[[actions]]
id = "open-viewer"
title = "Open chat viewer"
contexts = ["workspace"]
command = ["target/release/herdr-chat", "open-viewer"]

[[events]]
on = "pane.agent_detected"
command = ["target/release/herdr-chat", "on-agent-detected"]

[[panes]]
id = "broadcast-ui"
title = "Broadcast"
placement = "popup"
width = "70%"
height = "60%"
command = ["target/release/herdr-chat", "broadcast", "--pane"]

[[panes]]
id = "peek-ui"
title = "Chat"
placement = "popup"
width = "60%"
height = "70%"
command = ["target/release/herdr-chat", "peek", "--pane"]

[[panes]]
id = "signin-ask"
title = "Sign into chat?"
placement = "popup"
width = "50%"
height = 12
command = ["target/release/herdr-chat", "signin-ask", "--pane"]
```

Placements and dimensions are provisional, tuned during implementation against
herdr's feel. Two schema facts pin the rest down. First, **keybindings are not
a manifest capability**: herdr's plugin manifest accepts only `build`,
`startup`, `actions`, `events`, `panes`, and `link_handlers`, so no `prefix+b`
/ `prefix+c` bindings appear in the sketch above. They install into the user's
herdr keys config (a `[[keys.command]]` of type `plugin_action` naming
`m4ttstack.chat.broadcast` and `m4ttstack.chat.peek`), documented as an install
step in the README; the manifest parser ignores unknown fields silently, so a
binding left in the manifest would do nothing at all. Second, an interactive
action is a command that opens its own popup by calling
`herdr plugin pane open --plugin m4ttstack.chat --entrypoint <id>`, so each
`[[actions]]` entry and its `[[panes]]` entrypoint are two halves of one flow.
`contexts = ["pane"]` on the sign actions is a real context value.
`min_herdr_version` is pinned to the version whose event names and popup fields
the plugin uses (`pane.agent_detected`, popup `width`/`height`), confirmed
against the installed herdr at build time.

### The binary and its subcommands

One Rust binary, `herdr-chat`, dispatched by subcommand. Interactive
subcommands draw a ratatui popup; the rest are argv glue with no UI.

- **`on-agent-detected`** (event hook, no UI). Reads the pane id from
  `HERDR_PLUGIN_EVENT_JSON`, derives the repo from the pane's cwd, looks up the
  per-repo preference in state. `never`: exit. `always`: inject `/chat:sign-in`
  into that pane via `rt pane send`, so delivery semantics match invite exactly.
  `ask`: append the pane to a pending-panes file under `HERDR_PLUGIN_STATE_DIR`
  and open the `signin-ask` popup. The handoff is a file because a popup process
  receives no `HERDR_PANE_ID` and `plugin pane open` passes it no arguments. The
  popup drains every pending pane and asks about them together (yes / always /
  never / skip); `always` and `never` persist the choice for the repo. A fleet
  spawn detects many agents at once and a popup is a session-modal singleton, so
  a second `on-agent-detected` whose `plugin pane open` returns `ui_busy` simply
  leaves its pane in the pending file for the open popup to drain... detections
  coalesce into one prompt rather than stacking. The popup drains the pending
  file once more just before it exits, so a pane appended after its last drain
  (its own `plugin pane open` having hit `ui_busy`) is not stranded until the
  next detection.
- **`sign-in` / `sign-out`** (pane-context actions, no UI). Inject
  `/chat:sign-in` or the sign-out command into the focused pane
  (`HERDR_PANE_ID` from context), scrubbing `HERDR_PANE_ID` from the `rt`
  subprocess first (see `rt pane send` below: the self-refusal is an agent-side
  guard and must not block a deliberate self-target). Only the agent can arm its
  own tail, so the plugin injects the command rather than signing in on the
  agent's behalf, the same rule the invite design established.
- **`broadcast`** (popup). Fetches `rt pane list --json`, renders the picker
  (grouped by repo, text filter, select-all-online), takes a multi-line
  message, and on send runs `rt pane send` per selected pane, sequentially.
  Shows the results line and records the broadcast to state.
- **`peek`** (popup). Fetches `rt chat rooms --json` and `rt chat buddies
  --json`: online buddies and unread counts for the human. Row actions: jump to
  a buddy's pane, start a broadcast, quick-send, or open that room in the
  viewer. A glance and a launcher, never a transcript.
- **`quick-send`** (popup). Pick a target (recent rooms and buddies) and type
  one line; posts with `rt chat post` or `rt chat dm`. Not a composer: one line,
  send, done.
- **`open-viewer`** (action, no UI). Resolves the URL from deck (below) and runs
  `open <url>`. An optional room argument deep-links to `/r/<room>`.
- **jump-to-pane** is not a top-level action; it is a row action inside `peek`
  and the broadcast picker. It maps a chat handle to a pane through presence
  (`rt pane list` already carries `presence.handle` and `paneId`) and focuses
  it. herdr has no focus-by-id verb (`pane focus` is directional), so the plugin
  resolves the pane's tab and workspace from a herdr snapshot, focuses that
  workspace and tab, and zooms the pane by id (`pane zoom <paneId>`).

### Resolving the viewer URL (deck)

deck runs an HTTP API on loopback; its port is written to
`~/.mattstack/deck/api.json`. The plugin reads that port, then
`GET http://127.0.0.1:<port>/api/v1/apps/chat` and takes `.row.url`
(`https://chat.mattstack`). `.row.publicUrl` (the tunnel) is offered only for an
explicit shareable-URL request and only when `.row.published` is true: deck
populates `publicUrl` even for an unpublished app, and chat is intentionally
unpublished, so the publish flag is the gate, not whether `publicUrl` is set. If
deck is unreachable or the record is missing, fall back to the `chat.viewerUrl`
setting; if both fail, report it and do nothing. No hardcoded URL.

Optional side-quest in the deck repo: a `deck url <service>` verb, since deck's
CLI `status`/`list` print no URL and have no `--json`. It would give the plugin
`deck url chat` instead of parsing `api.json`. Out of scope for this spec;
noted so it is not rediscovered.

### Theme matching

The popups match herdr rather than approximate it. herdr's theme lives in
`src/config/theme.rs` / `src/app/theme_sync.rs`. The plugin reads herdr's active
theme (palette, selection highlight, border style) and applies it to the ratatui
widgets, and mirrors herdr's footer keyhint convention. The exact read path
(a herdr config file under `~/.config/herdr` versus a herdr CLI/socket query for
the live theme) is resolved as the first implementation task, since it decides
whether the theme tracks live changes or is read once at launch. Fallback: a
built-in palette that reads acceptably in both light and dark when herdr's theme
cannot be read.

## The rt addition: `rt pane send`

The one change outside the plugin repo. In repo-tools, next to the invite
feature's `pane list`, `pane peek`, `pane spawn`:

`rt pane send <pane> --text <text>`, rt-client `paneSend()`. Injects arbitrary
text into one Claude pane and reports delivery, touching no membership and no
room. It is the general form of `chat:invite`'s injection:

- The text is delivered as a plain `agent.prompt`, so it may be **multi-line**.
  (invite is one line only because a slash command dispatches from line 1;
  broadcast text is a prompt, not a command, so that constraint does not apply.)
- Delivery is invite's model verbatim: `agent.get` first; `blocked` is
  `refused`; `working` is queued (`agent.prompt` without wait); otherwise
  `agent.prompt` with a short wait, one Enter nudge on a stall, then queued.
- Result `{ paneId, delivered: "accepted" | "queued" | "refused", reason? }`,
  the same shape `chatInvite()` returns.
- The herdr gate is inherited unchanged. The caller's-own-pane refusal is too
  (`rt` forwards `HERDR_PANE_ID` as `callerPane` and the daemon refuses a
  match), but it is an agent-side guard against a pane inviting itself. The
  plugin's deliberate pane-targeting subcommands (`sign-in`, `sign-out`, and
  `on-agent-detected`'s `always`) scrub `HERDR_PANE_ID` from the `rt` subprocess
  env so a legitimate self-target is not refused; the popups never carry
  `HERDR_PANE_ID`, so broadcast is unaffected.

The injection core (`agent.get`, the blocked/working/nudge logic) is extracted
into one helper that both `chat:invite` and `pane:send` call, so there is a
single implementation. Refactoring `chat:invite` onto the shared helper is part
of this change, with its existing tests kept green.

## Data flow

**Broadcast.** `broadcast` popup -> `rt pane list --json` for the picker ->
human selects panes and types a message -> `rt pane send <pane> --text <msg>`
per pane, sequentially -> results line (`broadcast to 5 . 3 accepted . 2
queued . 0 refused`) -> append to recent broadcasts in state. Each agent acts
in its own pane; there is no reply channel and no room.

**Prompt-on-start.** herdr detects an agent -> `pane.agent_detected` ->
`on-agent-detected` reads the per-repo preference -> `ask` opens the popup,
`always` injects `/chat:sign-in`, `never` exits. The agent's own sign-in skill
signs in, joins its repository room, arms the tail. After a one-time `always`
per repo, new panes in that repo go online with no prompt.

**Peek and jump.** `peek` popup -> `rt chat rooms` + `rt chat buddies` ->
online buddies and unread counts -> the human picks a row -> jump focuses that
agent's pane (presence handle -> paneId -> herdr focus), or broadcast /
quick-send / open-in-viewer from the same row.

**Quick-send.** `quick-send` popup -> target list from recent rooms and buddies
-> one line -> `rt chat post <room>` or `rt chat dm <handle>`.

## State

Under `HERDR_PLUGIN_STATE_DIR` (the plugin owns the format; not the plugin root,
which is a managed checkout):

- `signin-prefs.json`: per-repo `ask` / `always` / `never`, keyed by the repo
  identity (the same repo key rt uses; see the repo-identity skill).
- `recent-broadcasts.json`: a capped list of `{ at, message, recipients:
  [{ paneId, handle?, delivered }] }` for the peek/broadcast "recent" view. A
  recipient snapshot lets a re-send preselect the panes still present.

Human identity for quick-send and peek is `chat.humanHandle` from the mattstack
settings store, read through `rt`, never assumed.

## UX details

**Picker rows** reuse the invite `ChatPane` anatomy so the two surfaces read the
same: a status dot and handle (or a hollow dot and `not signed in`), the
workspace and session title, repo and branch, the path as `.../leaf`, and the
caller reason or agent state on the right. Grouped by repo with a header per
group; a text filter over handle, workspace, title, repo, and path; a
select-all-online control that selects every `listening` pane. Selected rows use
herdr's selection highlight; blocked or already-targeted rows render disabled.

**Peek** lists online buddies with their unread count and room, most-recent
first, plus a total-unread line. It is a launcher: every row offers jump,
broadcast, quick-send, open-in-viewer. No message bodies.

**Quick-send** shows a target list (recent rooms first, then buddies), a single
input line, and a send key. A DM target routes to `rt chat dm`, a room target to
`rt chat post`.

Every popup carries a herdr-style footer of keyhints and closes on Escape.

## Failure modes

| Situation | What happens |
| --- | --- |
| herdr unavailable | The plugin cannot be invoked (its actions run inside herdr); nothing to handle. |
| rt daemon down | Each `rt` call fails; the popup shows the daemon-down state and offers retry, no partial action. |
| deck unreachable for open-viewer | Fall back to `chat.viewerUrl`; if that is unset too, report and do nothing. |
| Target pane blocked at a prompt | `rt pane send` returns `refused`; the picker disables it with that reason; the results line shows it. |
| Target agent working | `queued`; the message lands at end of turn; nothing polls. |
| Enter absorbed by the composer | One nudge, one more wait, then `queued`, reported as such (inherited from invite). |
| Online buddy with no local pane | Jump is unavailable for that row (no paneId); broadcast skips it; peek still lists it as online. |
| herdr theme cannot be read | The popups use the fallback palette; a one-line note, no crash. |
| `pane.agent_detected` for a non-Claude pane | herdr only fires agent detection for agents; a pane whose agent is not Claude is left alone by `on-agent-detected`. |
| Repo has no key (detached cwd) | Prompt-on-start defaults to `ask` and does not persist a pref it cannot key. |
| Shareable (public) URL requested for chat | deck populates `publicUrl` even while `published` is false, so the shareable path gates on `row.published`; chat is intentionally unpublished, so it warns and opens the local `row.url` instead. |

## Testing

- **herdr-chat (Rust).** The subcommands against injected command runners (fake
  `rt` / `herdr` / `deck` responses), so no real daemon is needed: broadcast
  fan-out and results aggregation, `on-agent-detected` honoring each preference,
  deck URL resolution with the api.json path and the setting fallback, jump
  mapping a handle to a paneId and focusing, quick-send routing room versus DM,
  the `HERDR_PANE_ID` scrub (a deliberate self-target subcommand shells `rt`
  with no `HERDR_PANE_ID` in its env).
  ratatui popups rendered to a test backend for the picker filter/sort/group,
  select-all-online, disabled rows, and the peek launcher actions. Manifest
  validated with `herdr plugin link` then `herdr plugin action list`.
- **rt (repo-tools).** `rt pane send` against the invite feature's fake herdr
  unix socket: accepted, blocked refused, working queued, stalled then nudged
  then accepted, multi-line text delivered as a prompt, caller's-own-pane
  refused, herdr-gate off. rt-client `paneSend()` export and type. The shared
  injection helper keeps `chat:invite`'s existing tests green after the
  refactor.
- **Real runs.** Prompt-on-start, a broadcast to two panes (one idle, one
  working), a jump, and open-viewer each run once against real herdr, rt, and
  deck before they are called done.

## Delivery order

1. **repo-tools (rt):** `rt pane send`, the extracted injection helper,
   `chat:invite` refactored onto it, rt-client `paneSend()` and types, tests.
   Publish rt-client. Starts after the invite feature lands on main.
2. **herdr-chat:** the manifest, the binary and its subcommands, theme matching,
   the popups, state, tests. Against real rt and herdr.
3. **deck (optional):** the `deck url <service>` verb, if we choose to add it.

## Out of scope

- Reading, transcripts, history, rooms browsing, rich composing: the viewer.
- A status strip or any ambient herdr-chrome badge. herdr plugin v1 cannot paint
  into herdr's chrome; a kept-open pane is the only ambient option and it edges
  into noise, so it is dropped.
- Linux and Windows. macOS first; the deck `open` and the API path are local.
- Remote or multi-session herdr (`HERDR_SESSION`); the default socket only.
- Response aggregation for a broadcast; each agent acts in its own pane.
- Reaching an online buddy that has no local herdr pane.
- An agent-driven broadcast (an agent broadcasting to panes). The recruiting
  flow in `rt:chat` already covers agent-to-agent room-building; a pane-level
  agent broadcast is a later follow-up reusing that form-confirm pattern.

## What this changes elsewhere

- **Broadcast's home is here, not the viewer.** A brainstorm-stage sketch put
  broadcast in the web viewer as a modal (it is not in the invite spec); this
  design places it in herdr, where the panes are. The viewer keeps rooms and
  invite.
- **rt gains `rt pane send`** next to `pane list` / `peek` / `spawn`, and
  `chat:invite` is refactored to share its injection helper. `rt:chat`'s verb
  table gains `rt pane send`.
- **deck** may gain `deck url <service>` (optional).
