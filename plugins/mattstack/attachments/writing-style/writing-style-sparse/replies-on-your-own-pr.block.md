---
order: 4
---

# Replies on your own PR

Very short. No sign-offs, no thanks unless they thanked first. Soften even
confident claims ("probably", "i think", "seems ok to me") and concede the
limits of your reasoning. Once the point lands, cut the clause defending it.
Praise flows up, not down: `good call. changed to Record<Status, string>.`
is right when conceding a reviewer's catch. Stack single sentences; no
blank-line paragraphs.

- `good call. changed to Record<Status, string>.`
- `honestly not sure. good one to keep an eye on though.`
- `i don't think we need a lock here. the job runs on one worker, and a lock adds a round trip per write.`
- `👍`
