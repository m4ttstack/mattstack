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
- **The chat protocol and the `rt` CLI this plugin drives:** in `repo-tools`,
  `skills/rt-chat/SKILL.md` (the agent-facing rules),
  `docs/superpowers/specs/2026-08-28-rt-chat-delivery-v2-design.md` (the
  current socket-push delivery model; the 2026-08-2{3,4} wake/presence
  specs it supersedes carry pointers), and `packages/rt-client/README.md`
  (the wire shapes `src/rt.rs` mirrors).
- **The other half of the product**, the web viewer that owns read/compose: the
  `chat` repo (`CLAUDE.md`, `ARCHITECTURE.md`), served at
  <https://chat.mattstack>.

## Architecture (module map)

- `src/rt.rs`: the only place rt's `--json` wire shapes live. `pane_send`
  (broadcast/inject), `pane_list` / `buddies` / `rooms`, and `agent_details`
  (index the pane roster by handle for the row context).
- `src/herdr.rs`: `herdr api snapshot` plus focus (locate a pane, focus its
  workspace/tab, `pane zoom`), and `open_popup`.
- `src/deck.rs`: the viewer URL via `deck url chat`, falling back to
  `~/.mattstack/deck/api.json` → `GET /api/v1/apps/chat` → `.row.url`.
- `src/state.rs`: broadcast history (`push_broadcast`/`recent_broadcasts`) and
  `state_dir`.
- `src/theme.rs`: reads herdr's `[theme]` so popups match the host.
- `src/ui.rs`: the shared popup loop and `content()` (see gotchas).
- `src/run.rs`: the `Runner` seam. Every subprocess goes through it; tests fake
  it, so there are no real `rt`/`herdr`/`deck` calls under `cargo test`.
- `src/cmd/*`: one file per capability (broadcast, picker, peek, quick_send,
  sign, open_viewer).

## Dev loop

- Build `cargo build --release`; test `cargo test --release`.
- Iterate against live herdr: `herdr plugin link <this dir>`. Re-run
  `herdr plugin link` after **any manifest edit** so herdr re-reads popup sizes
  and commands; code-only changes apply on the next popup open, since each pane
  execs the freshly built binary.
- Go back to the durable github install: `herdr plugin unlink m4ttstack.chat`
  first (a local link blocks it), then
  `herdr plugin install m4ttstack/herdr-chat --yes` (`--yes` is required
  non-interactively).

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
deliberate.
One open, non-blocking item: peek and quick-send render a single rich line,
where the picker is a fuller two-line entry (repo · branch · cwd on line 2);
match them if the extra depth is wanted.
