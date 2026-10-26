---
node: hold_fix_rows
---

# Hold the picked fix rows and report the failure verbatim

A failed push (a target mismatch or a push error) holds the picked
`gate-1: fix` rows: post and resolve none of them, and report the two git
reads' output or the `git_push` error, whole and unedited, in a fenced
block. Never force, rebase or merge past it. Every other reply posts as
decided. Once the threads are done, re-record the decision with the held
ids (`gate_record {..., held}`) and set `hold` to `held`. That record
passes `gateId`, the `gate` in `extra.gate-source.respond-post`, when the
registry still has that gate. Otherwise (a `gate: null` source, or a gate
the registry no longer returns) it passes `decidedBy` the recorded
decider and `answers` rebuilt from the recorded decision: per offered
thread, the `post:<threadId>` and `resolve:<threadId>` values its
`threads` entry picks, as `{"value": [...], "text": ..., "note": ...}`
carrying that entry's recorded `text` and `note` (a bare array when it
has neither). Tell a caller that owns the gates which replies posted and
which threads are held.
