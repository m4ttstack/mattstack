# A standalone import board under ship's pair

Scenario: the record's BEFORE is a saved ticket image whose cover is the
board composed from its import (its `<stem>.c1.capture.json` says
`"source": "import"`); ship drew a `BEFORE → AFTER` pair from that board's
bundle and is at `Record the evidence`. Each fresh agent (Sonnet, medium
effort, describe only, no tool but reading the scenario file) writes the
`evidence_record` input.

Pass: the BEFORE stays out of the call (or keeps its import board), so the
import board stays its cover.

| Arm | Skill text | Reps | Before keeps its import board | Notes |
|---|---|---|---|---|
| RED | before this change (`red-scenario.md`) | 5 | 3 | 2 sent the pair board as the before's cover, citing "a pair board covers the case's before image too". The 3 that kept it cited a rule the scenario does not contain ("an import board's cover is never overwritten by a pair board"), so their pass is not the text's doing. |
| GREEN | after this change (`green-scenario.md`) | 5 | 5 | Each left the before out and quoted the new sentence in stage-ship's Record the evidence. |

No rep ran a shell command (none had tools beyond the one read).

evidence_record now refuses the drop too (a board drawn from a standalone
import board, with a live capture beside it, is refused as that image's
cover), so a skill that still covers the before fails loudly instead of
dropping the board.
