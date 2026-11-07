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

A support chat with a teammate over a Slack DM runs in a background agent.
The daemon bridges the DM into an ordinary chat room: the teammate is a
participant with no session, so the stale-pending sweeps skip that identity
and a `chat_dm` to it from any pane but the assigned agent's is refused.

Every chat starts on the operator's approval. A pane asks with
`chat_slack_request` (or `chat_slack_resume` for a closed one), which raises
a daemon-only `slack-open` gate; the operator answers it in the pane's form
(the mod records it as `slack-mod`) or in the console's `/slack-gates`, and
`gate_answer` is refused for it. A teammate's DM that starts with the
persona's trigger raises the same gate. The chat app's new and resume
screens and the `/slack-support` mod command are the operator's own taps and
start a chat at once. The `chat.slackSupport.persona` setting names the bot;
`chat.slackSupport.defaultRepo` is the repo the agent starts in when no pane asked.
`skills/rt-slack-support/SKILL.md` owns what the agent does. Read
`docs/superpowers/specs/2026-11-03-slack-support-chat-design.md` and
`2026-11-06-slack-support-requester-design.md` before touching it, and
`website/docs/rt/guides/slack-support-chat.mdx` for the user view.
