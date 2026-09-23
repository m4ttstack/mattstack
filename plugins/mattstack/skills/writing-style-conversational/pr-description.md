# PR descriptions (conversational)

If the repo has a PR or MR template, keep every section and fill each in
this voice. Otherwise use the shape below.

## Length

About 150 to 250 words. Past 300, cut.

## Shape

```markdown
<ticket key>: <Title in sentence case>

<Two or three friendly sentences: what this does, why, and anything a
reviewer should look at first.>

**What changed**

- <short sentence per change, files in backticks>

**Testing**

<One or two sentences: what you ran and a specific case you checked.>

<Links, one per line.>
```

## Rules

- One short sentence per bullet; files and symbols in backticks.
- Mention a descope or follow-up ticket in one sentence under What changed.
- Test counts, not logs.
- Never restate the ticket, paste diffs, or leave placeholders.
