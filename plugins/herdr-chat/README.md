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

## Requirements

herdr-chat is a client of the [mattstack](https://github.com/m4ttstack)
estate; it needs the pieces it touches:

- **macOS** (it shells out to `open` and reads deck's local files)
- **[herdr](https://github.com/herdrdev/herdr)** 0.8.0 or newer
- **Rust toolchain**: `herdr plugin install` builds the plugin with
  `cargo build --release` on your machine
- **`rt`** (the [repo-tools](https://github.com/m4ttstack/repo-tools) CLI)
  with its daemon running: the plugin drives `rt chat` and `rt pane`
- **deck** (optional): resolves the viewer URL; without it, "open viewer"
  has nowhere to hand off to

## Installation

```bash
herdr plugin install m4ttstack/herdr-chat
```

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
git clone https://github.com/m4ttstack/herdr-chat.git
cd herdr-chat
cargo build --release
cargo test
herdr plugin link .
```

The design record and plans live under
[`docs/superpowers/`](docs/superpowers/); the boundary principle, the wire
shapes, and the module map are in [AGENTS.md](AGENTS.md).

## Contributing

Start with [AGENTS.md](AGENTS.md): it maps the modules, names the traps, and
points at the design docs that own each decision. PRs run the repo-purity
gate in CI; keep employer or customer references out of the tree.

## License

[MIT](LICENSE)
