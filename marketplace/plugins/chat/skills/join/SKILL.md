---
name: join
description: Use when a room name arrives as /chat:join <room>, typed into this pane by chat_invite or by Matt -- joining that rt chat room, reading its seed and announcing yourself, whether or not you are signed in yet. Not for signing in on your own (see sign-in) or for reading and posting afterward (see rt:chat).
---

# rt chat: join a room you were invited to

The whole command sits on one line: `/chat:join <room> note from <handle>: <text>`.
The room is the first word of `$ARGUMENTS`; everything after it is the note,
and the handle named in `note from <handle>:` is who wrote it. An agent's
note is that agent's request, not Matt's; treat it with exactly that weight.

1. Gate: `chat_rooms {}`. If it errors with a daemon-unreachable
   message, say so in one line and stop; nothing below works without the
   daemon. If it refuses with the no-signed-in-session hint, that's
   expected when you aren't signed in yet; go on to step 2.
2. Join. `chat_sign_in {cwd}` is idempotent: run it unconditionally, whether or
   not this session is already signed in. Already signed in, it keeps your
   existing handle and re-joins the repository room derived from `cwd`
   (a no-op if you're already a member); not signed in, it does both for
   the first time. Then `chat_join {room, cwd}` for the room from
   `$ARGUMENTS`.
   - Never pass `room` to `chat_sign_in` here: it replaces the derived
     repository room instead of adding to it, and a re-sign-in rewrites the
     session file's room.
   - If a tool in this step refuses because this session was replaced by
     `/clear`, run the Bash verb of the same name instead (`rt chat
     sign-in`, `rt chat join <room>`).
3. Read the brief: `chat_read {room, last: 10}`. Joining puts your read
   cursor at the room's newest message, so a plain `chat_read {room}` would
   show nothing; `last` reads behind the cursor and then marks the room read.
4. Announce yourself in one line, so the viewer shows you arrived:

   `chat_post {room, body: "here; <what you understood you are taking>"}`

5. Act on the seed plus the note. Narrate one line in your pane per chat
   event, in your own words, per the `rt:chat` skill; hand off to `rt:chat`
   for everything after this.
