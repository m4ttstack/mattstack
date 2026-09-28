---
name: getting-current-time
description: Use only when no hook-injected "Current time:" stamp is in context, or when the work is elapsed-time-sensitive enough that a stamp up to 5 minutes old is too stale. Normally the current time is injected automatically ... a UserPromptSubmit hook stamps every turn and a throttled PostToolUse hook re-stamps during long turns ... so read the most recent stamp from context instead of running anything.
---

# Getting Current Time

The machine clock is pushed into context automatically by the mattstack
plugin's hooks (declared in the plugin root's `hooks/hooks.json`, running
`inject-time.sh` from this directory):

- **UserPromptSubmit** stamps every user turn:
  `Current time: 2026-08-14 10:48:27 CDT (UTC-0500) | Zone: America/Chicago | UTC: 2026-08-14 15:48:27`
- **PostToolUse** re-stamps during long turns, throttled to at most once per 5 minutes.

Trust the most recent stamp in context. Never estimate the time from the
knowledge cutoff or the context date, and never treat an old stamp from
earlier in a long transcript as current when a newer one exists.

## When to read the clock manually

Only when the stamps cannot serve: no stamp is present (subagent contexts
before their first tool call, or a machine without this plugin), or you need
sub-5-minute precision (elapsed-time measurement, tight scheduling). Then run:

```bash
bash <base-dir>/get-time.sh
```

Use the `Zone:` line (IANA name) for anything DST-sensitive; abbreviations
like CDT are ambiguous.
