# mods-02 spike results, 2026-10-07

Raw evidence (out/, mods/, tools/) stays in the local, uncommitted `.harness-spike/mods-02/` folder of the harness-integrations worktree.

Claude Code 2.1.293, auto mode, Matt's login and plugins, mods loaded with `--plugin-dir`, pane wWR:p1, throwaway scratch repo. Evidence is in out/ (screens 00 to 57, debug.log, mod rows). Mods are in mods/: spike-reloc, spike-turn, spike-compose, spike-stop.

| # | Item | Result | Evidence | Ticket impact |
| --- | --- | --- | --- | --- |
| 1 | Answer the relocation prompt for one path only | YES | tool.check allow skipped the prompt for allowed-wt (195 ms; PermissionRequest never fired). classic.PermissionRequest allow alone also worked (186 ms, "Allowed by PermissionRequest hook"). denied-wt passed through as ask and the prompt stayed up. No grant is remembered between calls. | RT-400: decide by path in tool.check; no screen read, no key presses |
| 2 | Mod starts a turn while idle | YES | $.prompt.submit({text}) from a $.clock.after timer and after an events:wait round; the turn started 50 to 75 ms later | RT-402: submit from the mod after the wait round; no inbox write |
| 3 | Abort a running turn | YES, with a catch | $.turn.abort({turnId}) from session.receive ended the turn in about 40 ms (reason "aborted", no "Interrupted" marker). The running Bash was not killed: it moved to the background, and its completion notice started a new turn. Abort then submit worked. | BOARD-52: stand-down must also deal with backgrounded work |
| 4 | prompt.compose section, toggled per session | PARTIAL | A scope:'session' section reaches the model only if it is on when a conversation starts (seen after /clear). Mid-conversation toggles and new text never reach the model, even after /compact. | RT-410, RT-390: fixed per-conversation sections only; runtime changes need prompt.submit context or a new conversation |
| 5 | Stop hook blocks the end of a turn | YES | classic.Stop returning {block: reason} made the model act on the reason; it passed once the condition cleared, all in one turn | RT-391, RT-396: the mod can be the Stop gate |

Docs vs observed:

- Item 1: the tool.check type says an allow does not dismiss the dialog for tools that require the person. The relocation prompt is not one of those, so the allow skips it.
- Item 2: matches the docs. A plain submit's transcript row starts "The spike-turn plugin sent a message:" with origin kind plugin. With asUser:true the text is bare. The mod's own prompt.submit hook doesn't see its own submissions.
- Item 3: the types say running tools stop. Observed: the tool moved to the background and the process kept running.
- Item 4: compose fires every turn, but what is sent is frozen per conversation.
- Item 5: matches the docs. The transcript gets a meta row "Stop hook feedback: <reason>", like a shell hook.

Surprises:

- Matt clicked the denied-wt prompt by accident at 16:16. That pass is marked CONFOUNDED (out/54-*) and every item-1 case was rerun cleanly.
- The mattstack plugin's PreToolUse hook ran `rt worktree announce-relocation` on every EnterWorktree. The daemon pressed nothing because the scratch path is not registered.
- /clear changes the session id.

Daemon contact was one read-only events:wait on mods-spike/never; no events were emitted.

Cleanup:

- The session exited, workspace wWR is closed, and the scratch worktrees and repo are removed. Nothing was committed or installed.
- The scratch trust key was removed from ~/.claude.json by the controller: a 49-line block, the only harness-spike key, mode 600 kept. The backup is in the session scratchpad.
