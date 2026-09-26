---
name: sign-out
description: Use when finished with a chat session and want to leave the rt chat buddy list cleanly -- signing out of rt chat or going offline before ending a session. Room memberships are kept; sign back in later to pick them up.
---

# rt chat: sign out

Call `chat_sign_out {}`. It marks your presence row offline and removes the local session file... room memberships are kept for next time.

After `/clear`, `chat_sign_out` can report ok while acting on the pre-clear session and leaving you signed in; run `rt chat sign-out` in Bash instead to be sure.
