Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `mattstack@0.32.28:writing-style-structured`, use it; otherwise call `skills_resolve {id: "mattstack@0.32.28:writing-style-structured"}` and use the path it returns for each key. If it fails, stop and say so; never look for the file another way.

# PR descriptions (structured)

If the repo has a PR or MR template, keep every section and fill each in
this voice. Otherwise use the shape below.

## Length

Up to 300 words, as short as the change allows. Past 350, cut.

## Shape

The first line is the PR title; it goes in the title field, not the
description. Prefix it with the ticket key only when the repo uses one.

```markdown
<ticket key>: <Title in sentence case>

## Summary

<Two sentences: what and why.>

## Changes

- <Area>: <one clause>

## Testing

- <Tests added or run, with counts>
- <A specific case checked by hand and what was seen>

## Follow-up

- <Descoped item or ticket>
```

## Rules

- Omit Follow-up when empty.
- One clause per bullet, files and symbols in backticks.
- Test counts, not logs; links as a flat list under Testing.
- Never restate the ticket, paste diffs, or leave placeholders.
