# The browser target

A pack whose evidence includes browser screenshots adds one section to its
`evidence-domain@1` fill: `## Browser target`. That section is the pack's
whole part in browser evidence. It holds facts about the team's app and no
procedure. The shared `browser-evidence` include, already inside the
evidence and ship stages and the ship door, does everything else: it gets
the app ready, briefs the Fast Browser driver, captures, draws the board,
runs the redaction gate and keeps the bundle.

- A pack with no browser evidence adds nothing. No section, no fill for
  it; every case keeps its own method.
- Evidence that is not a browser screenshot (script output, backend data,
  a log) stays the pack's own method, written in the fill as before.
- On a browser case the stage uses the fill's facts, never its steps. A
  capture, preview, draw or annotate step elsewhere in the fill does not
  run for a browser case, so writing one there changes nothing.

## The four blocks

Each block is a `###` heading under `## Browser target`, named exactly as
below.

| Block | What goes in | What never goes in |
|---|---|---|
| Reach the view | how the servers start, the URL the app answers on, where the saved login is, the URL pattern for a case, the state to set up before the view shows the change | capture steps, tool calls, credentials |
| What proves a change | a table of kind of change, the view, the elements that show it; one `Intake:` line for what to ask the developer | how to frame, crop, mark or label a shot |
| Captions | how labels and the claim are worded (the page's own field names, the team's terms) | where marks go, drawing styles |
| Personal data | what is always hidden, and what may show | masking, blurring or retake steps |

Across all four: no capture, draw, mark or upload steps, no skill or agent
to load (never `annotating-screenshots` or a driver name), and no tool call
beyond naming the command that starts a server and where the login lives.
The include owns each of those.

## When a block is left out

Each block is optional. A missing block takes its default:

| Block | Default when the block is missing |
|---|---|
| Reach the view | the URL the plan or intake gives; the developer signs in |
| What proves a change | the plan's words for the case |
| Captions | plain words |
| Personal data | every personal detail on screen that is not being verified |

Write a block only when the default is wrong for the app.

## Example

The browser target in the evidence fill of an invented job queue app,
acme-queue:

```markdown
## Browser target

### Reach the view

- Servers: `bun run dev` in the worktree; the app answers on `http://localhost:5173`.
- Sign in: the saved login for `http://localhost:5173`. With none, ask the developer.
- URL: `http://localhost:5173/jobs/<job id>`; the job's detail panel opens with `?panel=details`.
- State: retry the job once with the Retry button and wait for the badge to update.

### What proves a change

| Kind of change | View | Elements |
|---|---|---|
| a job badge or counter | the job page | the badge and the job row's header |
| an export | the export dialog | the totals row and the Export button |

Intake: which job id shows the change.

### Captions

Use the page's own field names ("Retries", "Owner"), never internal ids.

### Personal data

Always hidden: the owner's email and phone. May show: job ids and the test owner "Dev Tester".
```

The fill keeps its frontmatter (`metadata.provides: "evidence-domain@1"`)
and any rules for its other evidence kinds beside this section.

## Afters at ship

Ship takes the AFTERs, so the ship fill (`ship-domain@1`) points at the
evidence fill's section instead of copying it. Under the ship fill's AFTER
rules, one line:

```markdown
At: Capture the AFTER when the domain names one

Browser screenshots use the browser target section of `{{pack.path:acme-evidence/SKILL.md}}`.
```

Replace `acme-evidence` with the evidence fill's name. The compiler renders
the placeholder as a path and refuses a bare fill name, so keep the
`{{pack.path:<evidence fill>/SKILL.md}}` form. A ship fill with no pointer
and no section of its own takes no browser AFTER.
