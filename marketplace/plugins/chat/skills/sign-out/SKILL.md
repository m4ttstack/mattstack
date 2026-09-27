---
name: sign-out
description: Use when finished with a chat session and want to leave the rt chat buddy list cleanly -- signing out of rt chat or going offline before ending a session.
---

# rt chat: sign out

Call `chat_sign_out {}`. It marks your presence row offline and removes the local session file. Your identity ends with your session: this same session signing in again picks it back up, and a new session starts as a new identity unless Matt continues this one with `rt chat sign-in --as <your name>`. <!-- mcp-lint: allow -->

After `/clear`, `chat_sign_out` can report ok while acting on the pre-clear session and leaving you signed in; run `rt chat sign-out` in Bash instead to be sure.
