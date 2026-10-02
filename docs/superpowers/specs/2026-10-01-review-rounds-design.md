# Board reviews land as GitLab reviews, round after round

Date: 2026-10-01. Branch: `review-rounds`. Status: design approved in
brainstorming; the review gate UI is built and signed off in Storybook.

## Problem

A review run from the board's review action never becomes a GitLab review.
The posting step publishes each finding as its own comment
(`mr_comment_inline`), the summary as a note (`mr_comment`), and approves
only on an approve outcome (`mr_approve`). Nothing submits a review, so on
GitLab the reviewer is never a reviewer and never in a "reviewed" state. A
comment outcome is invisible to GitLab's review state, and the board's pill
falls back to "needs review" whenever the findings went out as plain notes
(a live MR reviewed through the board on 2026-09-30 is the example).

Later rounds have two jobs, checking what the author did with earlier
threads and finding what is new, and today only the second is done well. A
re-review reads only the last round's report, never replies in or resolves
the earlier threads, and re-raises findings the reviewer deliberately
skipped under labels ("still open") that do not say whether the author or
the reviewer owes the next move.

## Goal

A board review lands on GitLab exactly as one submitted through GitLab's
"Submit your review" dialog, and every round from the first to approval
reads clearly: what the author still owes, what they fixed, what is new,
and what the reviewer chose not to raise.

## Decisions

| Decision | Ruling |
|---|---|
| Outcomes | Approve and Comment. No Request changes. |
| Confirmed fix, default | Reply and resolve, both ticked; the reviewer can untick either. |
| Skipped finding seen again | Stays out of the findings list, in a collapsed "Skipped earlier" row; marked "code changed since" when its code moved; never re-ticks itself. |
| Round record | GitLab threads hold everything posted; the board stores only skipped findings, the reviewed commit and the round. |
| Submit tool | One atomic `mr_review_submit` call per review. |
| Spec shape | One spec, three shippable phases. |

## GitLab behaviour this rests on

Probed against the harness project (`glance-test-repo`) on 2026-10-01 and
read from GitLab's source (`MergeRequests::UpdateReviewerStateService`).

- Pending comments (draft notes) are private to their author. Submitting
  (`POST .../draft_notes/bulk_publish`) publishes **every** pending comment
  that user has on the MR, including ones started by hand in the GitLab UI.
- `bulk_publish` takes `note` (the summary, a plain note that cannot be
  resolved) and `reviewer_state` (`reviewed` or `requested_changes`). It
  works with no pending comments, so a summary-only Comment still counts.
  Each submit adds a "left review comments" system note.
- Submitting adds the submitter as a reviewer in that state unless they are
  the MR author, or the reviewer limit is reached: on Free only when the MR
  has no reviewers, on Premium and above up to the limit.
- Approve is not a `reviewer_state`: publish, then `POST .../approve`, which
  sets the reviewer's state to `approved`. After an approval, a later
  Comment submit still publishes everything and leaves the approval alone.
- A pending comment on a line outside the diff is accepted with
  `line_code: null` and **silently dropped** on publish (204, no error).
- A pending reply with `in_reply_to_discussion_id` and
  `resolve_discussion: true` resolves the thread on publish, with the
  submitter as resolver.
- `PUT .../merge_requests/:iid` with `reviewer_ids` replaces the whole
  reviewer list; this design never calls it.

## Design

### 1. The submit tool

`mr_review_submit` (GitLab only) is the whole review in one call.

Input:

- `mrUrl`, or `repoName` plus `iid` (target resolution as `mr-target.ts`)
- `outcome`: `comment` | `approve`
- `summary`: the summary note
- `comments[]`: new findings `{body, path, line, oldPath?, oldLine?}`; a
  finding with no line rides in the summary, as today
- `replies[]`: earlier threads `{discussionId, body?, resolve}`

Steps, in order:

1. List the caller's pending comments on the MR. Any present: refuse,
   naming the count and their first lines. Nothing is posted.
2. Fetch diff refs once; create each comment as a pending comment; check
   each one's `line_code`. Any `null`: delete every pending comment this
   call created and return the bad anchors. The caller moves those findings
   into the summary and calls again.
3. Create each reply that has a body as a pending reply, with
   `resolve_discussion` from its `resolve`.
4. Publish with `note: summary` and `reviewer_state: reviewed`.
5. On `approve`, approve. A refused approval after a successful publish
   returns `{published: true, approved: false, error}` and never publishes
   again.
6. Resolve each reply with `resolve` and no body through the discussions
   API (a pending comment needs text).
7. Refresh the MR's discussions cache, as `mr:comment` does.

Result: counts posted, discussion ids replied to and resolved, `approved`,
the reviewer state GitLab reports, the summary note id, `mrUrl`.

Failure before publish deletes the pending comments this call created, so
the MR shows nothing. A publish GitLab refuses before acting (400, 401,
403, 404, 422) posted nothing: the pending comments are deleted and the
call says so. Any other publish failure (a timeout, a 5xx, a dropped
connection) is settled by listing pending comments: empty means it landed;
otherwise GitLab may still have created some or all of the notes, because
it creates every note before it deletes the drafts, so the leftovers are
deleted and the call fails saying the outcome is unknown and to look at
the MR before retrying. A publish that left only some of this call's
drafts reports how many of how many posted.

Layers:

- `packages/glance/src/NoteMutator.ts`: create, list, delete and publish
  pending comments (reusing `fetchDiffRefs` for positions); rebuild `dist`.
- `packages/rt-client/src/commands.ts`: the `mr:review-submit` command
  type; rebuild `dist`.
- `lib/daemon/handlers/discussions.ts`: the `mr:review-submit` handler
  beside `mr:comment`, behind the same repo decoding and token lookup (no
  `grants()` check, as `mr:comment` has none).
- `lib/mcp/tools.ts`: the tool; regenerate
  `plugins/mattstack/attachments/mcp-tools/reference.md`; update the root
  `AGENTS.md` paragraph that lists what the `mr_*` tools write. Like every
  tool on the server it runs on every estate machine without a prompt.

`mr_comment`, `mr_comment_inline` and `mr_approve` stay for their other
callers.

### 2. How a round works

Round 1 is today's review with one ending: a single `mr_review_submit`.

A later round gets three inputs:

- **Earlier threads**: every unresolved thread the reviewer opened on the
  MR, in any round and whether the board or the reviewer posted it, read
  fresh from GitLab. Left out: other reviewers' threads, the latch thread,
  and threads the round record marks `confirmed` (the reviewer said "fixed"
  and left resolving to the author).
- **Skipped findings**: from the round record (section 3).
- **Last reviewed commit**: so the hunt for new issues focuses on what
  changed since.

The agent returns:

- **One call per earlier thread**: `fixed`, `not-fixed`,
  `pushback-accepted` or `pushback-rejected`, a one-line note on what it
  checked, and a proposed reply. Resolve defaults on for `fixed` and
  `pushback-accepted`, off for the others.
- **New findings only**. A posted finding lives on its thread and never
  comes back as a finding; the `still-open` and `addressed-check`
  dispositions retire for new gates.
- **Skipped matches**: a would-be finding that matches the skipped list is
  dropped from findings and reported under `skipped`, with `changed: true`
  when `git diff <skipping round's sha>..HEAD` touches its anchored lines.

The report JSON (`review-core-body-tail`) gains `threads[]` (the calls and
replies) and `skipped[]`; `findings[]` is new-only; `prior` is counted from
the thread calls.

After the gate, the posting step makes one `mr_review_submit`: ticked
findings and brought-back skipped findings as `comments` (a brought-back
finding whose code changed since rides in the summary with its recorded
`file:line`, since its old line may now be other code), the earlier
threads as `replies` (body when "Post reply" is ticked, `resolve` from
"Resolve thread"), the summary, the outcome. On a resumed pane, "posted
already" is one check: this run's summary note is on the MR (the review
landed) or nothing is.

Skill sources:

- `plugins/mattstack/attachments/review/review/SKILL.md`: the re-review
  inputs, the Deliver/posting steps, and the outcome-options row (Approve
  and Comment only)
- `plugins/mattstack/attachments/review-posting/SKILL.md`: posting becomes
  one submitted review
- `plugins/mattstack/attachments/review-core-body-tail/SKILL.md`: the
  report contract above
- `plugins/mattstack/attachments/gate-protocol`: the new question shapes
  (section 4); then `bun run skills:expand:board` and a committed
  `apps/board/skills`
- `apps/board/skills-src/review/SKILL.md`: re-review mode inputs, the
  thread and skipped gate questions, the posting fallback, the resume
  check, and the round record writes (section 3)

A team pack compiled from the engine needs no source edit: its review
verb is compiled from the mattstack engine plus the posting include, so it
takes a recompile and a version bump through `rt skills sync`. That compiled output is visible to
the employer, so the engine text carries no mattstack ticket ids.

### 3. The round record

Migration v4 in the board's state db (`apps/board/src/state/db.ts`, v3
today), `IF NOT EXISTS` only:

```sql
CREATE TABLE IF NOT EXISTS review_rounds (
  mr_url       TEXT NOT NULL,
  round        INTEGER NOT NULL,
  reviewed_sha TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  skipped      TEXT NOT NULL,   -- JSON: [{id, title, severity, file?, line?, excerpt, snippet}]
  restored     TEXT NOT NULL,   -- JSON: [skipped id] brought back this round
  confirmed    TEXT NOT NULL,   -- JSON: [discussion id] confirmed fixed, left for the author
  recorded_at  INTEGER NOT NULL,
  PRIMARY KEY (mr_url, round)
);
```

The skipped list a round sees is every earlier row's `skipped` minus every
earlier row's `restored`.

- **Written** by the board review skill in its "Record the verdict answer
  in --report" step, which runs however the gate was answered (sheet,
  degraded native form, resumed pane), through a new status verb:
  `<status-bin> review-ledger record <state> --round <n> --sha <head>
  --outcome <o> --skipped <json> --restored <json> --confirmed <json>`
  (`apps/board/src/subcommands.ts`).
- **Read** at the start of a re-review through `<status-bin> review-ledger
  read <state>`: `{round, reviewedSha, skipped, confirmed}`.
- **Old reviews**: an MR with no rows builds round 1 from the prior report,
  whose `review-post-answer:` line says what was ticked and whose findings
  JSON holds the rest. No backfill job.
- **Cleanup**: rows go when the board drops the MR's review tombstone
  (`dropPrunedReviewState`), not at the prune itself: a pruned review the
  latch pass resurrects must still find its rounds.
- **v4 is announced in rt chat before merging**; a second lane holding v4
  renumbers.

### 4. The review gate (built, signed off)

Built on `review-rounds` and reviewed in Storybook
(`Gates/Board/ReviewGateSheet`: RoundThree, RoundThreeBringingOneBack,
RoundTwoAllSettled), real components on invented fixtures, not yet wired to
a backend.

- **Round heading** (`RoundHeading`, `SheetParts.tsx`): "Round N" and a
  summary ("5 earlier threads · 2 new findings · 3 skipped earlier") open
  the main column as a full-width frosted bar pinned while the column
  scrolls. The respond gate shows the same heading.
- **Your earlier threads** (`CarryoverCard`, `ReviewRoundParts.tsx`): per
  thread, `file:line` and a status chip naming who acts (fixed by author /
  waiting on author / author pushed back · accept / author pushed back ·
  hold firm), "you wrote · round k", "author replied", the agent's check,
  and the editable reply. "Post reply" and "Resolve thread" are card
  checkboxes in the reply box's footer beside edit, shared with the respond
  gate (`PostResolveChoice`, `RespondCards.tsx`); a held reply dims and
  reads "drafted reply · not posting".
- **New this round**: findings by severity, ticked by default.
- **Skipped earlier** (`SkippedEarlier`): collapsed unless something is
  coming back; each finding is its title over one line of facts (path ·
  severity · skipped in round k · code changed since).
- **Full report**: a plain disclosure.
- **Wording rule**: no gate copy says "open", "unresolved" or "still open"
  about a finding; every label names who acts. Gates already open with
  `still-open` / `addressed-check` read "waiting on author" / "author says
  fixed".

Wire format, recorded in the gate protocol:

| Question | Shape | Options | Context |
|---|---|---|---|
| `thread-<n>` per earlier thread | multi, two options | `post:<discussionId>`, `resolve:<discussionId>`; recommended labels mark the defaults | `carryover@1` `{thread, file?, round, call, original, authorReply?, note?, reply}` |
| `findings-<n>` | multi, chunked at four | finding ids | `findings@1`; new gates carry `disposition: new` or none |
| `skipped-<n>` | multi, chunked at four, none ticked | `restore:<id>` | `skipped@1` `{skipped: [{id, round, severity, title, file?, changed}]}` |
| `outcome` | single | `approve`, `comment` | none |

`readReviewGate` (`review-gate.ts`) keeps per-thread questions out of
`collapseChunks` (their `thread-N` ids would read as chunks of one
question). An edited reply rides its thread's answer as `{value, text}`.

### 5. The pill and the latch

- `statusBucket` (`apps/board/src/view.ts`): a reviewer whose GitLab state
  is `REVIEWED` reads "commented".
- Older runs that never set a state: a plain note by a roster member other
  than the author, or an armed latch that is not resolved, reads
  "commented" too.
- The latch arms on a comment outcome and is spent on approve, as today.

## Phases

1. **Real GitLab reviews**: section 1, the posting steps, section 5.
   Round 1 lands as a submitted review.
2. **Rounds 2 to N**: the round record's table and `review-ledger`
   verbs from section 3 (a later round's round number, last reviewed
   commit and `confirmed` list come from nowhere else; `skipped` and
   `restored` are written empty until phase 3), the report contract,
   re-review inputs, thread replies and resolves through the submit tool,
   the gate's earlier-thread cards wired to real questions.
3. **Skipped findings**: the record's `skipped` and `restored` written and
   read, the skipped row wired; building round 1 from old reports.

Each phase ships on its own.

## Testing

- Unit tests per layer: glance pending-comment methods; the daemon
  handler (refusal on pending comments, `line_code` rollback, publish
  timeout, approve after publish, resolve-only replies); the MCP tool's
  validation and redaction.
- A glance harness test against `glance-test-repo`: submit, the silently
  dropped bad anchor, the stray-comment refusal, reply with resolve.
- Board: `review-gate.test.ts`, `review-gate-sheet-dom.test.tsx`,
  `respond-sheet-dom.test.tsx`, `view` tests for the pill, the v4
  migration, the `review-ledger` verbs.
- Skills: a fresh-agent RED/GREEN run per `writing-skills`, certify,
  `rt skills check --strict`, the board skills drift test.
- UI: Storybook stories per state; regenerated `capture:compare` baselines
  for intended changes; light and dark screenshots.

## Rollout

Merge, then on the machine: sync the shared checkout, restart the daemon,
`/reload-plugins`, `rt skills sync` (bumps and recompiles the team pack),
`deck restart board`.

## Out of scope

- GitHub (`gh pr review`) parity; the `mr_*` tools stay GitLab only.
- Request changes as an outcome.
- Peer boards reviewing on another member's behalf.

## Risks

- **Stray pending comments**: refused rather than published, which blocks a
  review until the reviewer submits or discards their own UI drafts. The
  refusal names them.
- **Reviewer limit**: on a Free project with a reviewer already assigned,
  GitLab does not add the submitter, so their state is not set; the review
  still publishes. The projects the board reviews are on Premium.
- **Author reviewing their own MR**: GitLab never adds the author as a
  reviewer; the review publishes with no state.
- **v4 collision** with another lane's migration: announced first.

## Notes from the gate work

- `.storybook/main.ts` stubs `node:crypto`: glance's root entry imports it
  for its GitHub client, which Vite's dev server would otherwise load into
  the browser and throw, breaking every board story through `format.ts` or
  `view.ts`.
- A finding's body and fix lines hold a 140ch measure (was 100ch).
