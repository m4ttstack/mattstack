---
order: 1
---

# Adjudicator shape

Fill `${CLAUDE_SKILL_DIR}/references/adjudicator.md` (`{DIFF_RANGE}`,
`{REQUIREMENTS}`, `{THREADS}`), append the standard blocks, and dispatch ONE
fresh-context `general-purpose` subagent with it. One dispatch judges all
threads together.
