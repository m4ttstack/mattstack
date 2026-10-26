---
order: 2
---

# Guard: never asks

This part never asks a question. Arriving without a decided selection --
neither `{findings, disposition}` nor the legacy `{levels, disposition}`,
which a resumed board path may spell `{tiers, disposition}` and which is
accepted the same either way -- is a caller bug: stop and say so in one
line, never improvise a severity or disposition question to cover the
gap. A payload carrying finding ids is the contract, not a bug. Deciding
what posts is one layer up, not here.
