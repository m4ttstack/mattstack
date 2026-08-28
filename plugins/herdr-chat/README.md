# herdr-chat

A [herdr](https://github.com/mattstack/herdr) plugin that brings `rt chat` to
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
