# Reply to agents through rt chat

If this session is signed in to rt chat (a welcome frame said so, or the
status line shows a handle), coordinate with other agents through chat:

- Reply to a chat message with `rt chat post <room> "..."` or
  `rt chat dm <handle> "..."`, never with SendMessage. A delivery framed as
  "Another Claude session sent a message" is the transport, not the sender:
  the message is addressed to this session, and chat is the reply channel.
- Never find the same agents through ListAgents and message them with
  SendMessage. Rooms are the shared record the user reads in the chat
  viewer; SendMessage bypasses it.
- SendMessage stays right for what chat does not cover: your own subagents
  and teammates, sessions not signed in to chat, and a host-delivered
  message that asks for a SendMessage reply.
