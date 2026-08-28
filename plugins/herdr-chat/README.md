# herdr-chat

A [herdr](https://github.com/herdrdev/herdr) plugin that brings `rt chat` to
where the agents actually live: the panes. It does not reimplement the chat
viewer. Its job is the half the web viewer structurally can't do... touching
panes.

**The boundary:** _act / glance / jump_ live here; _read / compose_ stay in the
[chat viewer](https://chat.mattstack). When you want to read, the plugin hands
off.

Capabilities: broadcast one message into a selection of panes, jump from a chat
mention to that agent's pane, sign panes in/out (and prompt on start so most
panes are online), peek at who's online and what's unread, quick-send a line to
a room or DM, and open the viewer.

Built in Rust with ratatui, themed to match herdr.

Status: **design**. See `docs/superpowers/specs/2026-08-27-herdr-chat-design.md`.

## Install

macOS only: the plugin shells out to `open` and reads deck's local files, so it
runs on macOS.

```bash
herdr plugin install m4ttstack/herdr-chat
```

This builds the plugin and registers its actions (`broadcast`, `peek`,
`quick-send`, `sign-in`, `sign-out`, `open-viewer`), its `pane.agent_detected`
hook, and its popup panes. It does not bind any keys... herdr keybindings are
a user-config concern, not a manifest capability, so the plugin can't declare
them for you.

### Keybindings

Add `[[keys.command]]` entries of `type = "plugin_action"` to your herdr keys
config, each pointing at one of the actions above by its `m4ttstack.chat.*`
id:

```toml
[[keys.command]]
key = "prefix+b"
type = "plugin_action"
command = "m4ttstack.chat.broadcast"
description = "broadcast to panes"

[[keys.command]]
key = "prefix+c"
type = "plugin_action"
command = "m4ttstack.chat.peek"
description = "chat peek"

[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "m4ttstack.chat.quick-send"
description = "quick-send a chat line"
```

Pick any keys that don't collide with your existing bindings. `sign-in`,
`sign-out`, and `open-viewer` can be bound the same way if you want them on a
key rather than run from the command palette.
