# Respond per person (BOARD-56)

## Intent

Today the board's respond action treats an MR as one response. Once it
finishes, the only way to answer someone else who commented later is "redo
response" plus a hand-typed Option-key note naming them, and the redo
confirm wrongly says it starts from scratch. The row never says who a
response is for.

A response should answer **one person**: everything that person left on
the MR, whether it came through a formal review or as loose comments. If
John submitted a review with several threads and also left three comments
on the side, responding to John answers all of them. Answering John and then
Darryl are two separate responses, each with its own round count.

Ticket: BOARD-56. Mock: `docs/apps/design/board/board.pen`, frame
`B13 · Respond to a person` (dark and light).

## Goals

- The unit of a response is a person (a GitLab username).
- A person's feedback is everything they authored that is still open:
  resolvable threads they started (in a review or not) and plain Overview
  comments.
- The row menu names the person and shows the round from the second
  response to them on: "respond to John (round 2)".
- Each person has their own round count.

## Non-goals

- Parallel responses on one MR. One response runs per MR at a time.
  Revisit only if it becomes a blocker (Matt, 2026-10-19). It needs a
  second tree on a temporary branch, since rt's checkout reuses the tree
  already on the MR's branch and git refuses one branch in two trees.
- Picking individual comments within a person's feedback. A person is
  answered as a whole.
- Bulk respond. Respond is not in the bulk menu today (its row action has
  no `bulk` key) and stays out.
- GitHub. Respond is GitLab-only today; this does not change that.

## Anti-goals

- A reply posted to someone the response was not for.
- A round counter that disagrees between the menu, the row and the gate
  header.

## Decided behavior

### Who can be picked

A person appears as a choice when they are not the MR author, not a bot
(`isBotUsername` plus config `botUsernames`, the rule `summarizeDiscussions`
already uses), and either has something open or has had a response before.
Authored items count when they are:

- a resolvable thread the person started (`threadsOpenedBy`), or
- a plain Overview comment (a note in a non-resolvable discussion).

Latch threads stay excluded, as today.

### What is "open" for a person

- A thread they started is open when its status is `awaiting` (the
  existing `ThreadStatus` rule).
- An Overview comment is open when the author has not replied on that
  comment's discussion and has not left their own Overview comment after
  it, mirroring the existing "author replied elsewhere" rule for threads.

### Replying to an Overview comment

Equivalent to GitLab's "Reply to comment" then "Add comment now": a note
posted immediately (not a draft review) on that comment's own discussion,
which turns it into a thread. `mr_reply_thread` posts to
`discussions/:id/notes`, which accepts a plain note's discussion, and
`mr_threads` already returns Overview notes with their discussion `id` and
`resolvable: false`. Only the board's `summarizeDiscussions` drops the id
(`GeneralComment` has no `discussionId`); the board needs it to count a
person's open Overview comments.

### The row menu

Respond stays in the agent-actions section, in its lane color (green).

| Situation | Item |
|---|---|
| No eligible person | no respond item |
| One eligible person, no prior response, something open | "respond to John" |
| One eligible person, prior response, something open | "respond to John (round 2)" |
| One eligible person, prior response, nothing open | "redo response to John (round 2)", redo confirm |
| Several eligible people | "respond to…" opening a pick submenu (the existing `pick` mechanism), one row per person |
| A response is running on the MR | "focus response to Darryl"; no launch for anyone else |

Picker row hints, right-aligned and dim: "5 threads · 2 comments" for open
items, prefixed "round 2 · " once the person has a prior response, "nothing
open · redo" when only a redo is possible. While a response runs, the
picker is not offered: the item focuses the running pane.

"resume response" names the person it resumes: "resume response to
Darryl". There is only ever one, the MR's latest run.

The redo confirm (`redo-copy.ts`) names the person: "Redo response to
John? John has nothing open. This starts round 3 anyway."

### Rounds

A person's round is how many responses they have had: 1 on the first, one
more for each later response (new comments or a redo). The counter shows
from round 2 on, everywhere the person is named: the menu, the picker, the
row's lane line and the respond gate header.

Mid-run `revise` passes are not rounds. They show separately in the gate
header, e.g. "round 2 · revise 1". This splits today's single `round`
field, which counts revises and seeds the next fresh run with
`round + 1` (`respondFreshDispatchFields`), into a per-person response
round and a per-run revise count.

### The row's lane line

The MR's latest response, naming the person: "responding to John (round 2)
· triaging", "responded to Priya · 4 posted". Dismiss works as today.

### The respond wrapper

A new `--person <username>` flag (`skills-src/respond/SKILL.md` flag table,
`launch.md`, `triage.md`). Triage adjudicates only that person's open
threads and Overview comments; everything else on the MR is out of scope.

The domain skill does the fetching and adjudicating, so the flag must
reach it. The slot contract (`mr-respond@2` in the wrapper's metadata)
moves to `@3` with the person as a required input, and mattstack's own
`receive-review` takes it. As a backstop for a pack still bound to `@2`,
the wrapper drops verdict-table rows whose thread was not started by the
person before Gate 1, so nothing outside the person's feedback can post.

An absent `--person` (a pane launched by an older board) keeps today's
behavior: every unresolved human thread.

## Constraints

- **State stays one live run per MR.** `agent_states` keys on
  `(lane, mr_url)` and gates key on the subject `mr:<url>` plus kind
  (`src/gates/cache.ts`, `sweep.ts`, `resume.ts`). One response at a time
  means both can stay as they are: the live respond row gains a `person`
  field. Per-person round history needs its own small store keyed by
  (MR, person), shaped like `review_rounds`. Existing respond rows read as
  "person unknown": they count toward nobody's round and their handle keeps
  resolving for any pane or parked gate in flight.
- **Skills.** `skills-src/` is the only place to edit board skills;
  regenerate with `bun run skills:expand:board` and keep
  `skills:check:board` green. Load `superpowers:writing-skills` before
  touching any skill.
- **Employer surfaces.** A team pack's respond skill is updated in its own
  repo, separately, with no mattstack ticket ids in it.
- **Copy.** Menu and dialog text follows `rt:ui-copy`.
- **UI.** Follows `docs/apps/ui-authoring.md`. Board capture baselines
  regenerate only for intentional changes; narrow widths are checked by
  hand. Rendered and screenshotted in both schemes before done.
- **Gallery.** New row or gate variants get stories in `Gates/Board/Gallery`
  with invented names.

## Left to the builder

- The round-history store's exact shape and migration.
- How the client learns per-person open counts (extend the discussions
  summary in the snapshot, or a per-row fetch when the menu opens).
- How the backstop filter in the wrapper identifies a row's person.
