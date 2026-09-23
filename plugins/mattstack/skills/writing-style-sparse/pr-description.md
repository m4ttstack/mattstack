# PR descriptions (sparse)

If the repo has a PR or MR template, keep every section of it and fill each
in this voice. Otherwise use the shape below.

## Length

100 to 200 words above any checklist. Past 250, re-read and cut.

## Shape

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

Named after what they group (`Cache`, `API`, `Callers`), never "Code
changes". Two to four groups; one group needs no label.

## Also and Follow-up

One line each, three at most. Skip the section when empty. A follow-up that a
ticket covers is one line naming it.

## Verification

One sentence with a specific case and the observable result. Test counts,
not logs: "9 new tests; settings suite 142/142 green."

## Don't

- Restate the ticket.
- Frame in more than two sentences.
- Write multi-sentence bullets or parenthetical paragraphs.
- Leave TODO sections or placeholders.
- Paste diffs or test logs.

## Anti-patterns

- A framing paragraph that walks every file. Cut to what and why.
- A compound bullet: "Adds `cache.ts`, which keys on tenant and user and
  evicts on write (so the PATCH path stays fresh) and also renames...". Cut
  to "`cache.ts`: per-user cache keyed on tenant and user."
- A follow-up bullet that restates what its ticket already says.

## Minimal variant

A tiny change whose screenshot says it all: one or two lowercase bullets and
the image, nothing else.
