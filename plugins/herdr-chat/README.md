# herdr-chat

A [herdr](https://github.com/herdrdev/herdr) plugin that brings `rt chat` to
where the agents actually live: the panes. It does not reimplement the chat
viewer. Its job is the half the web viewer structurally can't do... touching
panes.

**The boundary:** _act / glance / jump_ live here; _read / compose_ stay in the
[chat viewer](https://chat.mattstack). When you want to read, the plugin hands
off.

Capabilities: broadcast one message into a selection of panes, jump from a chat
mention to that agent's pane, sign panes in/out on a hotkey via the sign-in and
sign-out actions, peek at who's online and what's unread, quick-send a line to
a room or DM, and open the viewer.

Built in Rust with ratatui, themed to match herdr.

Status: **shipped**, installed as a github-managed herdr plugin. The design
record and plans live under `docs/superpowers/`; contributors start with
[AGENTS.md](AGENTS.md).

## Install

macOS only: the plugin shells out to `open` and reads deck's local files, so it
runs on macOS.

```bash
herdr plugin install m4ttstack/herdr-chat
```

This builds the plugin and registers its actions (`broadcast`, `peek`,
`quick-send`, `sign-in`, `sign-out`, `open-viewer`) and its popup panes. It
does not bind any keys... herdr keybindings are a user-config concern, not a
manifest capability, so the plugin can't declare them for you.

### Keybindings

Add `[[keys.command]]` entries of `type = "plugin_action"` to your herdr keys
config, each pointing at one of the actions above by its `m4ttstack.chat.*`
id:

```toml
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
letters (`prefix+B`, not `prefix+b`) avoid collisions; pick whatever is free in
your config. Sign-in is hotkey-only... nothing prompts you on pane launch...
so binding `sign-in` (and `sign-out`) is how you get a pane onto the buddy
list. `open-viewer` can be bound the same way too.

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
