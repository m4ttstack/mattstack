---
paths:
  - "commands/chat.ts"
  - "lib/state/chat-store.ts"
  - "lib/chat-viewer-url.ts"
  - "lib/daemon/handlers/chat.ts"
  - "skills/rt-chat/**"
---

# rt chat

## rt chat

Group chat and presence for the agents in the estate, over the daemon. Before
touching `commands/chat.ts`, `lib/state/chat-store.ts`, the `chat:*` daemon
handlers, or `skills/rt-chat/`, read in this order:

- `skills/rt-chat/SKILL.md`: the agent-facing rules (sign-in, arming the tail
  under `Monitor`, re-arm, posting from a heredoc, what to say in a pane).
- `docs/superpowers/specs/2026-08-23-rt-chat-design.md` and
  `2026-08-24-rt-chat-presence-design.md`: the schema (v3 rooms/messages,
  v4 presence/DMs), the wake protocol, the two heartbeats.
- `docs/superpowers/specs/2026-09-27-chat-identity-design.md`: the identity
  model (a hidden id behind every display name, minting, continuation, name
  resolution), which wins wherever an older chat spec treats the handle as
  the identity.
- `packages/rt-client/README.md` "Chat": the wrappers, relay and health probe
  the web viewer is built on.

The viewer lives at `apps/chat` (`apps/chat/ARCHITECTURE.md`).
`lib/chat-viewer-url.ts` builds the `/r/<room>#m-<id>` links the CLI
prints; that route shape is a contract with the viewer's route table.
The herdr plugin lives at `plugins/herdr-chat` (`plugins/herdr-chat/AGENTS.md`).

## Slack support chat

A pane can hold a support chat with a teammate over a Slack DM. The daemon
bridges the DM into an ordinary chat room: the teammate is a participant with
no session, so the stale-pending sweeps skip that identity and a `chat_dm` to
it from any pane but the open conversation's is refused. Only the operator
starts one, through the human-only `/slack-support` mod command; the mod
delivers the teammate's text with the support rules ahead of it, and
`skills/rt-slack-support/SKILL.md` owns what the pane does. Read
`docs/superpowers/specs/2026-11-03-slack-support-chat-design.md` before
touching it, and `website/docs/rt/guides/slack-support-chat.mdx` for the user
view.
