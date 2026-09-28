# PR descriptions (sparse)

If the repo has a PR or MR template, keep every section of it and fill each
in this voice. Otherwise use the shape below.

## Length

100 to 200 words above any checklist. Past 250, re-read and cut.

## Shape

The first line is the PR title; it goes in the title field, not the
description. Prefix it with the ticket key only when the repo uses one.

```markdown
<ticket key>: <lowercase title>

<one or two plain sentences: what this does and why>

**<group label>** (optional path)

- <one-clause bullet>

**Also**

- <orthogonal change worth knowing>

**Follow-up**

- <descope or related ticket>

<one sentence naming a specific case you checked and what you saw>

- <preview link>
```

## Bullets

- One clause each, action-first: `Adds`, `Fixes`, `Removes`, `Renames`.
- Files and symbols in backticks; never paste source.
- Skip the why when the diff shows it.
- Flat by default; nest only when a point cannot fit its parent line.

## Group labels

Named after what they group (`Parser`, `API`, `Docs`), never "Code
changes". Two to four groups; one group needs no label.

## Also and Follow-up

One line each, three at most. Skip the section when empty. A follow-up that a
ticket covers is one line naming it.

## Verification

One sentence with a specific case and the observable result. Test counts,
not logs: "4 new tests; list suite 88/88 green."

## Don't

- Restate the ticket.
- Frame in more than two sentences.
- Write multi-sentence bullets or parenthetical paragraphs.
- Leave TODO sections or placeholders.
- Paste diffs or test logs.

## Anti-patterns

- A framing paragraph that walks every file. Cut to what and why.
- A compound bullet: "Adds `paginate.ts`, which rounds the page count up and
  clamps the offset (so the last page renders) and also renames...". Cut
  to "`paginate.ts`: page count rounds up."
- A follow-up bullet that restates what its ticket already says.

## Minimal variant

A tiny change whose screenshot says it all: one or two lowercase bullets and
the image, nothing else.
