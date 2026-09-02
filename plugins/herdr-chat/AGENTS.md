# AGENTS.md

Agent-facing orientation for working on the code. The [README](README.md) is
the product overview (what it is, install, keybindings); this file is how to
build on it and the traps to avoid. Don't duplicate what the linked docs own.

## Read first

- **This repo's design record:**
  `docs/superpowers/specs/2026-08-27-herdr-chat-design.md` (the boundary
  principle, the six capabilities, the rt/herdr/deck wire shapes) and the three
  plans in `docs/superpowers/plans/`.
- **The herdr plugin contract** (manifest capabilities, `herdr plugin
  install`/`link`, popup panes, events, `plugin_action` keybindings): herdr's
  own docs at <https://github.com/herdrdev/herdr>. This plugin is a client of
  that contract, not a definition of it.
- **The chat protocol and the `rt` CLI this plugin drives:** at the mattstack
  repository root,
  `skills/rt-chat/SKILL.md` (the agent-facing rules),
  `docs/superpowers/specs/2026-08-28-rt-chat-delivery-v2-design.md` (the
  current socket-push delivery model; the 2026-08-2{3,4} wake/presence
  specs it supersedes carry pointers), and `packages/rt-client/README.md`
  (the wire shapes `src/rt.rs` mirrors), and
  `docs/superpowers/specs/2026-09-27-chat-identity-design.md` (every
  identity is a hidden `handle` id plus a display `name`).
- **The other half of the product**, the web viewer that owns read/compose:
  `apps/chat` in this repo (`CLAUDE.md`, `ARCHITECTURE.md`), served at
  <https://chat.mattstack>.

## Architecture (module map)

- `src/rt.rs`: the only place rt's `--json` wire shapes live. `pane_send`
  (broadcast/inject), `pane_list` / `buddies` / `rooms`, and `agent_details`
  (index the pane roster by handle for the row context). Every identity
  shape carries `handle` (the id) and an optional `name`; `display_name()` is
  the one place the fallback to the handle lives, and `Room::label()` names a
  DM room by its participants.
- `src/json.rs`: the other direction of the wire. Every shape a `--json` verb
  prints, the mappers that build them out of this crate's own types, and
  `emit`/`fail`. A field name here is a contract with a front end that cannot
  be recompiled with this crate; the README's table is its written form.
- `src/herdr.rs`: `herdr api snapshot` plus focus (locate a pane, focus its
  workspace/tab, `pane zoom`), and `open_popup`.
- `src/deck.rs`: the viewer URL via `deck url chat`, falling back to
  `~/.mattstack/deck/api.json` → `GET /api/v1/apps/chat` → `.row.url`.
- `src/state.rs`: broadcast history (`push_broadcast`/`recent_broadcasts`;
  each recipient keeps `handle` and `name`), the launcher's origin-pane stash
  (`stash_origin_pane`/`read_origin_pane`), and `state_dir`.
- `src/theme.rs`: reads herdr's `[theme]` so popups match the host.
- `src/ui.rs`: the shared popup loop and `content()` (see gotchas).
- `src/run.rs`: the `Runner` seam. Every subprocess goes through it; tests fake
  it, so there are no real `rt`/`herdr`/`deck` calls under `cargo test`.
- `src/cmd/*`: one file per capability (launcher, broadcast, picker, peek,
  quick_send, sign, open_viewer).

## Dev loop

- Build `cargo build --release`; test `cargo test --release`.
- Iterate against live herdr: `herdr plugin link <this dir>`. Re-run
  `herdr plugin link` after **any manifest edit** so herdr re-reads popup sizes
  and commands; code-only changes apply on the next popup open, since each pane
  execs the freshly built binary.
- Go back to the durable github install: `herdr plugin unlink m4ttstack.chat`
  first (a local link blocks it), then
  `herdr plugin install m4ttstack/mattstack/plugins/herdr-chat --yes`
  (`--yes` is required non-interactively).

## Gotchas (each cost a debugging round)

- **Pane commands must be `["sh", "-c", "exec ./target/release/herdr-chat
  <args>"]`, never a bare relative path.** herdr's pane launcher PATH-searches
  `command[0]`; a bare `target/release/...` is not on PATH, so the popup fails
  with `plugin_pane_open_failed`. `sh` is on PATH and cwd is the plugin root, so
  the relative binary resolves.
- **Popups render borderless into `ui::content(frame.area())`.** herdr already
  frames and titles each popup pane; drawing your own bordered `Block` nests a
  second window (a box-in-a-box). One inset column, no border.
- **A popup's `width`/`height` is a bare integer (cells) or a `"N%"` string. A
  quoted integer (`"66"`) fails the whole manifest parse.** Size list popups to
  their content, not to a percentage that balloons on a wide terminal.
- **Row context (repo / branch / task) comes from `rt pane list`** (its
  `ChatPane` carries `title` + `presence`); `rt chat buddies` has repo/branch
  but no task title. `rt::agent_details` joins the two by handle.
- **Deliberate self-targets scrub `HERDR_PANE_ID`** from the rt subprocess
  (sign-in/out) so rt's caller's-own-pane refusal does not misfire.
- **A popup process carries no `HERDR_PANE_ID`.** Anything a popup does to
  "the pane the hotkey fired on" needs the pane action to stash the id first;
  the launcher's sign quick actions read it back via `state::read_origin_pane`.
- **A popup cannot open the next popup itself.** herdr keeps one popup per
  session and refuses `plugin pane open` with `popup already open` until the
  current popup's process has exited, and on teardown it signals that
  process's whole session, so a detached helper dies with it. The launcher
  hands off through `herdr plugin action invoke` (the action runs as herdr's
  own child), and `herdr::open_popup` retries the busy refusal briefly while
  the old popup is reaped. Every other failure still surfaces at once.
- **A popup cannot open the next popup itself.** herdr keeps one popup per
  session and refuses `plugin pane open` with `popup already open` until the
  current popup's process has exited, and on teardown it signals that
  process's whole session, so a detached helper dies with it. The launcher
  hands off through `herdr plugin action invoke` (the action runs as herdr's
  own child), and `herdr::open_popup` retries the busy refusal briefly while
  the old popup is reaped. Every other failure still surfaces at once.
- **Show `name`, act on `handle`.** Every row, header and result line renders
  `display_name()`. Every lookup, map key, jump, send and broadcast record
  uses `handle`. A check that a pane title "just echoes the identity"
  compares against the name, since the name is what the title would repeat.
  A test that renders a row asserts the id's suffix is absent.

## Status

Shipped and installed as a github-managed herdr plugin. The polish pass
(single-window popups, agent-context rows, right-sized modals) landed in #2.
Since then: #4 moved sign-in/out to zero-turn daemon-side calls
(`rt chat sign-in|sign-out --pane <id> --json`, never pane injection), and
#5 removed the on-launch auto-prompt entirely (no `pane.agent_detected`
hook, no signin-ask popup, no per-repo prefs); sign-in is hotkey-only via
the pane actions (Matt binds prefix+I / prefix+O). rt-side delivery is now
socket push (see the delivery-v2 spec above): agents receive message bodies
in-context, so nothing here types into a pane except broadcast, which stays
deliberate. Newest capability: the launcher popup (`launcher` action, bound
to prefix+C), one menu over every feature and quick action on lowercase
letters, with sign results shown in-popup.
Newer still: the headless surface. Every capability except the launcher takes
`--json`, prints one object on stdout and draws nothing, and three JSON-only
verbs (`status`, `targets`, `jump`) were added for a second front end to drive
the plugin without a terminal. The shapes live in `src/json.rs` and are tabled
in the README; two verbs stop short of acting on purpose, `jump` locating a
pane without focusing it and `open-viewer --json` returning the URL without
opening it, because the caller owns both.
One open, non-blocking item: peek and quick-send render a single rich line,
where the picker is a fuller two-line entry (repo · branch · cwd on line 2);
match them if the extra depth is wanted.
