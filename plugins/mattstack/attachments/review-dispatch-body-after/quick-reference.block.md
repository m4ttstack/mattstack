---
order: 4
---

# Quick reference

| | Reviewer shape | Adjudicator shape |
|---|---|---|
| Template | `superpowers:requesting-code-review`, or the Reviewer section above | `${CLAUDE_SKILL_DIR}/references/adjudicator.md` |
| Fill (only these) | DESCRIPTION, PLAN_OR_REQUIREMENTS, BASE_SHA, HEAD_SHA | {DIFF_RANGE}, {REQUIREMENTS}, {THREADS} |
| Returns | Strengths / Critical / Important / Minor / Assessment | per thread: verdict `valid \| pushback \| needs-clarification`, plus relations |
