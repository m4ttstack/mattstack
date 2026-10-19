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

# R5: a pair's ticket panel must carry its redactions

mr:upload and evidence_attach now refuse a board whose panel was drawn from a
ticket image (matched by bytes against evidence-tickets) unless its redaction
record holds a crop for that panel. The refusal lands in the `redaction`
bucket, so evidence-record's repair re-renders the board. Two skill points
were baselined (Sonnet, medium effort, describe only, 5 reps each) to decide
whether either needs new text.

| Scenario | File | Reps | Pass | Result |
|---|---|---|---|---|
| Driver draws a pair from an import before whose spec redacts the ticket's personal data | `driver-red-scenario.md` | 5 | 5 | Every rep carried both redact marks onto the BEFORE panel unchanged. |
| Repair after the new refusal, current evidence-record and browser-evidence text | `repair-red-scenario.md` | 5 | 5 | Each rep walked Repair the board's redaction record and added the before board's redactions to panel 1 at step 3. |

The control shows no failure in either place, so no skill text changed for
R5: the refusal's own words ("redact its personal data in that panel") drive
the repair, and the code refuses any board that still shows the panel bare.
