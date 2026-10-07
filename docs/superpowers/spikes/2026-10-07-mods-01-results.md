# RT-383 mods spike results, 2026-10-07

Raw evidence (out/, mods/, tools/) stays in the local, uncommitted `.harness-spike/mods-01/` folder of the harness-integrations worktree.

Claude Code 2.1.293, Opus 5.5, Matt's real login with his plugins loaded, in a throwaway trusted scratch repo. Normal run in pane wWE:p1; bypass run in pane wWF:p1. Evidence is in out/. "Plan" means docs/superpowers/plans/2026-10-04-harness-integrations.md.

| # | Item | Result | Changes a Claude adapter? |
| --- | --- | --- | --- |
| 1 | ui.render empty tree hides an rt chat row; the model still reads it | YES (Box and Text; no refusal; ctrl+o shows the full row) | Yes: M1 messaging (RT-408, RT-390) can hide delivery rows |
| 2 | session.receive consumes a delivery before the model | YES (consumed, not in the transcript, no turn; origin peer; key on envelope + reply line or delivery-id) | Yes: RT-408 in-session receiver |
| 3 | tool.call on AskUserQuestion held for minutes | NO as written: one $.http.fetch is cut off at 30 s. The hook budget itself never moved (9999 ms left) | Yes: M5 (RT-385, RT-402, S11) must loop long-polls under 30 s. A 5 min hold built from short rounds is untested |
| 4 | Close the built-in dialog, or use the mod's own pane | PARTIAL: closing from the mod works (deny result); the mod pane works (130x64); prefilling `answers` is ignored | Yes: RT-385 can finish a gate without Escape |
| 5 | $.session id/cwd/root after EnterWorktree and /clear | YES, with a caveat: inside the worktree tool.call hook right after next(), root() has moved but cwd() still lags. After /clear the id changes (match classic.SessionStart source clear) | Yes: F3/F4/H6 (RT-405, RT-406, RT-400); use root() in worktree hooks |
| 6 | HERDR_PANE_ID and rt.sock via $.http.fetch socketPath | YES (right pane; GET /ping 200 in 4-5 ms; a 0755 socket directory was not refused) | Yes: F2 and M3 (RT-384, RT-389, RT-387); no per-session socket needed |
| 7 | One plugin adds a $ noun, a dependent plugin calls it | YES (types contract laid in; dependent session.start runs first) | Yes: F2 core mod offers $.rt |
| 8 | Inbound path for daemon commands | Inbox envelope: 11/11 consumed in 2-4 ms, including mid-turn and bare JSON. Long-polls are cut at 30 s, so pass the cursor between rounds. 8c: one emitted event (id 18997) was delivered to the in-flight poll in about 1 ms | Yes: RT-408 router and the F2 daemon link use the inbox envelope for push; long-polls under 30 s with a cursor |

Bypass run: session.receive consumed all marked deliveries (no approval dialog). Matt's `crossSessionInbound: "accept"` setting means the documented bypass hold cannot be observed on this machine.

Types: 2.1.293 versus 2.1.291 (out/types-diff-2.1.291-vs-run.txt). Built-in tool types moved into new packages. None of the APIs the spike used changed.

Surprises: $.http.fetch is capped at 30 s with no documented option; prefilling answers is ignored; cwd() lags inside worktree hooks; ExitWorktree left a git worktree registered in the scratch repo; delivery origin is peer; "1 agent" shows in the footer (source unknown).

rt chat and presence: nothing appeared. Cleanup: both sessions exited and both workspaces closed; scratch repo removed; no plugins installed; no settings changed. A trust key for the scratch-repo path remains in ~/.claude.json, pending Matt's OK to remove it.

## Rerun, 2026-10-07 14:33 to 14:44 (pane wWG:p1)

- Item 3: YES. A 5-minute hold (heldMs 300002) over 12 chained events:wait rounds of 25 s or less, with the cursor passed as `after`. The hook budget stayed at 9995/10000. The dialog then appeared and the answer went through.
- 8b: hold and listen both YES with the cursor. One event (id 19000), emitted in a gap when no waiter was registered, was returned 2 ms into the next round via the cursor. An unrelated `rt daemon restart` (run from the canonical checkout, not by the spike) caused ECONNRESET in round 9, so a real mod must retry with the cursor it already holds.
- Over the whole spike, two event rows were written: 18997 and 19000.
- The scratch-repo trust key was removed from ~/.claude.json: a 49-line block, the only harness-spike key, mode 600 preserved. The backup is in the session scratchpad.
