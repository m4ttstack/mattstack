# herdr-chat

A [herdr](https://github.com/herdrdev/herdr) plugin that brings `rt chat` to
where the agents actually live: the panes. Broadcast a message into a
selection of panes, glance at who's online and what's unread, jump from a
chat mention straight to that agent's pane, and hand off to the web viewer
when you want to read the full conversation.

Built in Rust with ratatui, themed to match herdr.

## Features

- **Launcher**: one popup with every feature and quick action behind the
  lowercase letter of its direct binding.
- **Broadcast**: send one message into a selection of panes.
- **Peek**: who's online, what's unread, at a glance.
- **Quick-send**: fire a line at a room or DM without leaving your pane.
- **Sign in / sign out**: put a pane on (or take it off) the chat buddy list
  on a hotkey.
- **Jump**: from a chat mention to that agent's pane.
- **Open viewer**: hand off to the web viewer for reading and composing.

## Headless use

Every feature except the launcher also runs without a terminal: the launcher is
a menu over the others, and a menu is the caller's to draw. Pass `--json` and
the command prints one JSON object on stdout and draws nothing:

```bash
herdr-chat status --json --pane w1:p1
herdr-chat peek --json
herdr-chat targets --json
herdr-chat quick-send --json --to '#rt' --body 'schema v5 is mine'
herdr-chat broadcast --json --panes w1:p1,w2:p7 --body 'pausing releases'
herdr-chat sign-in --json --pane w1:p1
herdr-chat sign-out --json --pane w1:p1
herdr-chat jump --json --handle scout
herdr-chat open-viewer --json
```

`status`, `targets` and `jump` have no other mode, so `--json` is optional
there and changes nothing.

Three rules hold across every verb. `--json` never prompts and never falls
back to the TUI, so a missing required flag is an error. A failure prints
`{"error":"..."}` on stdout and exits non-zero. And two verbs deliberately stop
short of acting: `jump` answers where a handle is and moves no focus, and
`open-viewer --json` returns the URL rather than opening it, so the caller
decides both.

The sign verbs answer with the same object as `status`, because rt's own sign
replies carry no state and the next question after signing is always what the
header now reads.

### The wire shapes

One row per verb, keys in the order they are printed. This table is the
contract a second front end reads, so a name here is not changed without
breaking it.

| Verb | Input | Keys it prints |
| --- | --- | --- |
| `status` | `--pane <id>`, else `HERDR_PANE_ID`; required | `handle`, `name`, `state`, `pane`, `signedIn`, `rooms` |
| `sign-in` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same six, read back after the sign |
| `sign-out` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same six |
| `peek` | none | `buddies`, `rooms` |
| `targets` | none | `rooms`, `people`, `labels` |
| `quick-send` | `--to '#room'` or `--to '@name'`, `--body <text>` | `ok`, `to` |
| `broadcast` | `--panes <id,id>`, `--body <text>` | `ok`, `results` |
| `jump` | `--handle <name or handle>` | `paneId`, `workspace`, `handle`, `name` |
| `open-viewer` | `--room <room>`, optional | `url` |

The nested rows: a `peek` buddy is `handle`, `name`, `paneId`, `status`, `repo`,
`branch`, `title`, `unread`, `mentions`, and a `peek` room is `room`, `label`,
`unread`, `mentions` (`label` is what to draw: a DM room's participant names,
`kai ↔ remy`, else the room); a `broadcast` result is `paneId`, `ok`,
`delivered`, `error`.

`targets` prints prefixed strings (`#room` under `rooms`, `@name` under
`people`) and `quick-send --to` takes one back. A bare name is refused rather
than guessed at between a room and a person. `labels` maps each of those
strings to what to draw: a DM room's `#dm-...` reads as its participants'
names, and every other string maps to itself.

Absent values are `null`, never a missing key: `handle`, `name` and `pane` on a
`status`, a peek buddy's `paneId` / `repo` / `branch` / `title`, and a
broadcast result's `error`.

### Handles and names

rt gives every chat identity two strings. `handle` is the id rt keys
everything on (`remy.k3f9`); `name` is what people see and type (`remy`).
Show `name`, act on `handle`: a jump, a DM, or a check for "is this the
same agent" goes by `handle`, because a name is reused after its holder
signs out and a handle never is.

Input goes the other way. `jump --handle` and `quick-send --to '@...'` take
either one. `jump` matches a live agent's name first, then a handle exactly,
the same order rt resolves a DM in. `quick-send` passes the value to rt,
which resolves a name to the live identity holding it. `targets` lists each
name once: a signed-out identity can still share a name with a live one,
and only the live one answers to it.

An rt from before names existed sends no `name`, and every verb then prints
the handle in its place, so `name` is present wherever `handle` is.

### What `ok` does and does not tell you

`quick-send`'s `ok` is always `true`. It is not a discriminator: a send that
failed arrives as the error envelope and a non-zero exit, never as `ok:false`.

`broadcast`'s `ok` is a real one, `false` as soon as any pane refused. Each
result also carries `delivered`, rt's own word for that pane: `accepted`,
`queued` or `refused`. Only `refused` is a failure, because a queued message
is one rt has taken responsibility for.

Broadcast's two failures differ in exit code, and a caller has to tell them
apart. Every pane refusing exits **0** with `ok:false` and a result per pane,
because the fan-out ran and each pane has an answer. An empty `--panes` exits
**1** with the error envelope, because nothing was sent and there is no result
to report.

### `--pane` means two different things

It takes a value on some verbs and is a boolean on others. The split stands:
herdr's plugin manifest invokes the boolean entrypoints by name, so renaming
one breaks every installed copy of the plugin.

- **`status`, `sign-in`, `sign-out`**: `--pane <id>` is the pane to act on.
- **`broadcast`, `peek`, `quick-send`, `launcher`**: `--pane` is a boolean, the
  popup entrypoint that runs the TUI in the pane herdr just opened. A headless
  caller never passes it.

The flags only the `--json` path reads (`--panes` and `--body` on `broadcast`,
`--to` and `--body` on `quick-send`) are refused without `--json` rather than
dropped into a TUI run that would ignore them.

## Requirements

herdr-chat is a client of the [mattstack](https://github.com/m4ttstack)
estate; it needs the pieces it touches:

- **macOS** (it shells out to `open` and reads deck's local files)
- **[herdr](https://github.com/herdrdev/herdr)** 0.8.0 or newer
- **Rust toolchain**: `herdr plugin install` builds the plugin with
  `cargo build --release` on your machine
- **`rt`** (the [mattstack](https://github.com/m4ttstack/mattstack) CLI)
  with its daemon running: the plugin drives `rt chat` and `rt pane`
- **deck** (optional): resolves the viewer URL; without it, "open viewer"
  has nowhere to hand off to

## Installation

```bash
herdr plugin install m4ttstack/mattstack/plugins/herdr-chat
```

herdr clones the whole mattstack repository to build this plugin; the
first install takes about 15 seconds and about 400 MB on a 2026
MacBook Pro: roughly 170 MB of repository (56 MB of it git history) plus
the 230 MB release build (measured on 2026-09-27).

This builds the plugin and registers its actions (`launcher`, `broadcast`,
`peek`, `quick-send`, `sign-in`, `sign-out`, `open-viewer`) and its popup
panes. It does not bind any keys... herdr keybindings are a user-config
concern, not a manifest capability, so the plugin can't declare them for you.

## Usage

Everything hangs off the launcher: bind it to a key (below), hit it in any
pane, and every feature sits behind one lowercase letter. Sign a pane in
first (`sign-in`) so it's on the buddy list; from there broadcast, peek,
quick-send, and the viewer hand-off are all one keypress away.

To try an action before binding anything:

```bash
herdr plugin action invoke m4ttstack.chat.launcher
```

### Keybindings

Add `[[keys.command]]` entries of `type = "plugin_action"` to your herdr keys
config, each pointing at one of the actions above by its `m4ttstack.chat.*`
id:

```toml
[[keys.command]]
key = "prefix+C"
type = "plugin_action"
command = "m4ttstack.chat.launcher"
description = "chat launcher: every feature behind one key"

[[keys.command]]
key = "prefix+B"
type = "plugin_action"
command = "m4ttstack.chat.broadcast"
description = "broadcast to panes"

[[keys.command]]
key = "prefix+P"
type = "plugin_action"
command = "m4ttstack.chat.peek"
description = "chat peek"

[[keys.command]]
key = "prefix+S"
type = "plugin_action"
command = "m4ttstack.chat.quick-send"
description = "quick-send a chat line"

[[keys.command]]
key = "prefix+I"
type = "plugin_action"
command = "m4ttstack.chat.sign-in"
description = "sign in to chat"

[[keys.command]]
key = "prefix+O"
type = "plugin_action"
command = "m4ttstack.chat.sign-out"
description = "sign out of chat"
```

herdr's lowercase letters are mostly taken by its own defaults, so shifted
letters (`prefix+B`, not `prefix+b`) avoid collisions; pick whatever is free
in your config. Sign-in is hotkey-only... nothing prompts you on pane
launch... so binding `sign-in` (and `sign-out`) is how you get a pane onto
the buddy list. `open-viewer` can be bound the same way too.

### Unread badge

Independent of this plugin: the `rt` daemon itself reports a `chat_unread`
token on a signed-in pane via `pane.report_metadata` whenever a message fails
to deliver straight into that pane's inbox. It shows up in herdr's sidebar
only once one of your sidebar agent rows references it, e.g.:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "agent", "$chat_unread"],
]
```

## Development

Work from a checkout and link it instead of installing:

```bash
git clone https://github.com/m4ttstack/mattstack.git
cd mattstack/plugins/herdr-chat
cargo build --release
cargo test
herdr plugin link .
```

The design record and plans live under
[`docs/superpowers/`](docs/superpowers/); the boundary principle, the wire
shapes, and the module map are in [AGENTS.md](AGENTS.md).

## Contributing

Start with [AGENTS.md](AGENTS.md): it maps the modules, names the traps, and
points at the design docs that own each decision. The mattstack root's
`scripts/repo-purity.sh` gates this tree in CI; keep employer or customer
references out of it.

## License

[MIT](LICENSE)
