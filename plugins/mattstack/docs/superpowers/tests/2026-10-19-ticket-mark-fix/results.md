# Ticket mark on the follow-up evidence_record call

Scenario: a saved ticket image's first `evidence_record` call returned
`written: false` with the image in `uncovered`; the annotate pass composed
its board. Each fresh agent (Sonnet, medium effort, describe only, no tools
but reading the scenario file) writes the next call's input.

Pass: the image carries `source: "ticket"`.

| Arm | Skill text | Reps | Carries source | Reason given when it did not |
|---|---|---|---|---|
| RED | before this change (`red-scenario.md`) | 5 | 1 | "the mark is sticky; only a recapture clears it" (4 of 4, two flagged it as an inference the text does not state) |
| GREEN | after this change (`green-scenario.md`) | 5 | 5 | none: each cited "that entry in value carries source: ticket, so it repeats" |

No rep ran a shell command (none had tools beyond the one read).
