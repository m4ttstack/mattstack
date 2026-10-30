# Re-review latch: animated state banners

Status: design, awaiting approval. Builds on the shipped latch
(`2026-09-01-re-review-latch-design.md`).

## Why

The latch is the board's comment on a GitLab MR: after a review leaves
comments, the author resolves it to ask for a follow-up review. Today it
carries one big static banner (1200x208, near-black and hot pink) that
never changes. A teammate resolves it and the latch keeps asking "Ready
for re-review?" while the board queues, runs, or fails the follow-up.
Nobody on the MR can tell what the board is doing.

The latch should show where the follow-up review is, at a glance, and be
smaller and calmer than today's banner.

## Goals

- One banner per latch state, swapped on the same note as the state
  changes: armed, queued, running, error, done (comments or approved).
- Each banner is an animated GIF strip: this MR's invadr creature plus
  short copy, stretched to the width of the GitLab comment column.
- A follow-up the board cannot start yet waits in queued instead of being
  refused with "Not yet".
- A follow-up that fails is retried by the board; after three failures it
  stops and tells the reviewer.

## Non-goals

- No change to who may request a follow-up, or to the cooldown and daily
  budget values.
- No board UI changes; this is the GitLab comment only.
- No separate images for GitLab dark mode; one strip reads on both.

## Anti-goals

- The image must never be load-bearing. Detection stays marker-only
  (rt-client's rule today): a missing or blocked image changes nothing.
- One author request never launches two reviews, whatever order sweeps,
  server signals and retries land in.
- No constant attention-grabbing motion. Loops stay slow; terminal states
  move little.

## The states

Every banner is laid out as a 520x64 CSS px strip and rasterised at 3x
(1560x192 pixels, so it stays sharp at full column width on Retina) on
`#2a2638`, with 6 CSS px rounded corners, the creature on the left, a
title in Silkscreen 18 (`#ece8f4`) and a subtitle in IBM Plex Mono 13
(`#b7b0c8`). The accent colours the creature and its indicator.

| State | Marker kind | Thread | Title | Subtitle | Accent | Motion |
|---|---|---|---|---|---|---|
| Armed (first time) | `armed` | open | Ready for another pass? | Resolve this thread to ask | `#f08fb0` | leg shuffle, eye blink |
| Queued | `queued` | resolved | Follow-up review queued | why it is waiting (below) | `#e6b860` | dots tick after the title |
| Running | `running` | resolved | Follow-up review running | Results post here when done | `#7fbfe8` | creature marches; ring loader on the right |
| Error, retrying | `error` | resolved | Follow-up review hit a snag | Retrying on the next sweep | `#f2917e` | quick shake, dots tick |
| Error, stuck | `error` | resolved | Follow-up review stuck | Reviewer notified | `#f2917e` | quick shake, blink |
| Done, comments | `armed` | open | Follow-up review done | N new comments. Resolve when ready | `#b9a0f2` | one hop, blink |
| Done, approved | `spent` | resolved | Follow-up review done | Approved. Nothing more to do | `#86cfa0` | hop with sparkles |
| Approved, no follow-up | `spent` | resolved | Approved | Nothing more to do | `#86cfa0` | hop with sparkles |
| Superseded | `spent` | resolved | Superseded | A newer latch is live | `#8e88a0` | still |

Queued subtitles, by why the request is waiting: "Starts on the next
sweep" (nothing blocks it), "Waiting out the cooldown", "Daily limit hit;
starts tomorrow", "Waiting for the running review" (`review-in-flight`).
These are the only reasons `decideRequest` can give a latch request that
clear by themselves; respond never blocks a latch.

Error, retrying names the wait the same way when a retry is blocked:
"Retrying on the next sweep", "Retrying after the cooldown", "Daily limit
hit; retrying tomorrow".

Done-comments counts what actually landed: the reviewer's discussions on
the MR created after the follow-up launched (the launch stamp, below).
"1 new comment", "N new comments" up to 20, "20+ new comments". Zero, or a
count the board cannot read, shows "Review posted. Resolve when ready".
(My call: the report JSON's findings are the drafted set, and the
reviewer can drop findings before posting.)

The note body under the image keeps a plain sentence per state, so
blocked images still say what is happening. The current armed and spent
copy stays; new states get one sentence each.

## Replies and notifications

GitLab emails on a new note, not on an edit, so banner swaps are silent.
The board posts a thread reply only when the author or reviewer needs to
know (Matt's call):

- the follow-up finished: one reply with the outcome (comments with the
  count, or approved);
- the latch is stuck: one reply saying the reviewer has been told.

Queued, running, retries and wait-reason changes are banner edits only.
Today's "Follow-up review started" reply goes away; the running banner
replaces it. No latch gets today's "Not yet" reply: the pass gives every
latch it acts on a row (adopting one from the note when none exists), the
row proves a commented review, so no reason that never clears can reach
it, and a pane that fails to start is a counted failure (step 5).

A stuck latch always sends the reviewer the rt desktop notification, even
when `triage.notify` is `badge-only` (Matt's call: it is rare and needs a
person).

The prototype GIFs and preview this design was reviewed from were rendered
by a throwaway Chromium script; they are the visual reference for frame
timing and layout, not code to keep.

## The lifecycle

1. A review lands with comments and no latch exists: post an armed latch
   (unchanged trigger, new banner).
2. The author resolves it. The next latch pass sees the request and
   decides it. A decision to dispatch launches straight from armed (step
   3's launch, no queued hop). Otherwise the pass stamps the request time
   on the row, rewrites the note to `queued` with the banner for the
   current wait reason (cooldown, budget, review in flight), and leaves
   the thread resolved. Queued shows only when the request must wait.
3. Each pass re-decides every queued latch. When the decision becomes
   dispatch, it re-reads the review lane, launches the review, rewrites to
   `running`, and charges cooldown and budget exactly as today. A review
   found in flight on that re-read is adopted instead (see "Any review
   satisfies the request"). If the wait reason changes, the banner changes
   with it.
4. The review lands (server signal, with the pass as backstop):
   - comments: rewrite to `armed` with the done-comments banner, reopen
     the thread. The next resolve starts again at step 2.
   - approve: rewrite to `spent` with done-approved, keep resolved.
5. The review errors, or its pane dies under the run liveness contract,
   while the latch is `running`: rewrite to `error` (retrying), keep
   resolved, and treat it as queued for the next pass. Retries obey
   cooldown and budget. A retry that launches flips it back to `running`.
6. After three failed attempts in one request cycle, the latch stays
   `error` with the stuck banner, retries stop, the thread gets the stuck
   reply, and the reviewer gets a desktop notification. It leaves stuck only when that MR's review runs
   again (the reviewer relaunches it from the board): the pass sees the
   review `reviewing` and flips the latch to `running`.

Approvals keep today's precedence: the reviewer's own approval (via
review or GitLab) spends every copy from any state, and spent still wins
over everything in the pass.

Edge cases (my calls):

- **Any review satisfies the request.** A review that starts while the
  latch is queued or error, even one the reviewer launched by hand from
  the board, is the follow-up: the latch goes to `running` and lands like
  any other. One ask never gets two reviews. The review must start at or
  after the row's stamp (the request for a queued latch, the last launch
  for an error one). A review already running when the author resolved
  cannot have seen the fixes, so the request waits it out ("Waiting for
  the running review") and is decided again once it ends.
- **A review parked at its post gate is running**, however long it waits;
  the liveness check must not read a parked gate as dead.
- **A follow-up that ends done with no outcome** (the reviewer abandoned
  the post gate) consumed the request: back to the plain armed banner,
  thread reopened, no reply. The next resolve is a new request cycle, so
  the failure count resets.
- **Retries count like launches.** A retry charges cooldown and budget
  exactly as a first launch. A pane that fails to start counts as a
  failure. Failures count per request cycle, across days, and reset when
  a follow-up lands, with an outcome or abandoned.
- **The author reopens a queued latch**: the request is withdrawn; back
  to armed. Reopening a running or error latch changes nothing until the
  run lands.
- **The review step never posts a duplicate.** `applyReviewLatch` posts a
  fresh armed latch only when this reviewer has no latch in any non-spent
  kind.

## Where the latch's state lives (my call)

The note is what people see; the board's state db is the record. A new
table keyed by MR and latch discussion holds the kind, the request cycle,
the stamp a follow-up must start at or after (the request while queued,
the launch once running), and the failure count. The cron pass (`bin/triage.ts`) and the board server both
read and write it; every transition is a compare-and-set on the row's
current kind, and the note is rewritten only after the row moves.
A landing (comment or approve) or a stuck transition also writes the reply
it owes into the row's `reply_due` in that same compare-and-set; the writer
posts it at once and clears it, and a post that fails stays owed until a
later cron tick, past the post grace, posts it to the canonical latch
(at least once). An owed reply is dropped, with an audit line, a day after
its transition, when its latch is gone, or when it is the stuck reply and
the row has left stuck.

This is what makes the daemon's stale discussion reads harmless: a
stale note showing `queued` or `armed`+resolved after the row already
says `running` is ignored, so it can never re-request or clobber the
banner. The note's marker stays the fallback when no row exists (latches
posted before this change, or a lost db), read exactly as today; a
queued, running or error note adopted that way takes its post time as the
stamp, so the review that armed it can never land as the follow-up. The
failure count lives in this row, not in the cron's dispatch memory file,
because the server records errors and outcomes too.

## Markers

rt-client's `latch.ts` gains three markers beside the two it has, same
`v1` family, first line only:

- `<!-- mattstack:board re-review-latch v1 queued -->`
- `<!-- mattstack:board re-review-latch v1 running -->`
- `<!-- mattstack:board re-review-latch v1 error -->`

`LatchKind` becomes `armed | queued | running | error | spent`. A request
is still exactly "armed and resolved". Queued, running and error are
acknowledged states the pass owns; resolving or reopening them is not a
new request.

Older rt builds read the new markers as "not a latch" (null). They only
ever appear on resolved threads, which rt's MCP MR tools drop before
checking markers, so an older rt shows nothing different. rt-client and
the board ship in this repo, so both land together.

## How the banner is made (approach A, chosen)

Build time: `scripts/build-latch-band.ts` (Playwright, as today) renders
one text strip per state and wait reason, plus the done-comments count
variants, into `apps/board/assets/latch/`, committed. Each strip leaves
the creature box and the indicator box empty. Today's
`assets/latch-band.png` goes once nothing reads it.

Runtime: `banner.ts` takes (mrUrl, state variant) and returns GIF bytes.
It reads the strip, paints this MR's creature from
`resolveInvadr(mrUrl, { accent: true })` frame by frame (eye cells from
`accent.cells`), paints the dots or ring, and encodes with `gifenc`
(pure JS, so `bun build --compile` keeps working). Frame timings follow
the prototype: armed ~4.4s loop, queued 420ms ticks, running 130ms
frames, done and error ~3.5s loops.

The posted markdown is `![<state title>](<upload url>)`, unsized, so
GitLab stretches it to the comment column (about 785 CSS px in a typical
window, where the 1560 px GIF shows at about 2x). `imageMarkdownOf` must keep matching
the older `{width=N}` suffix, and a cached upload is re-wrapped with the
current markup, so an older width is dropped when the note is rewritten.

The corners are a binary quarter-circle mask (GIF transparency has no
alpha): one palette slot is reserved as the transparent index, every
pixel outside the rounded rect takes it in every frame, and every frame
is whole with dispose 2, so the corners never flash. The compositor
applies the mask, not the strips.

The geometry lives in CSS px and is multiplied by the strip set's scale
(3 for the shipped strips). The parity test composites at 2x with 2x
strips the build script renders into its fixtures, so it compares
pixel-for-pixel with the approved 1040x128 prototype GIFs, the rounded
corners excluded.

Alternative B (one committed GIF per state, same creature for every MR)
was rejected: it drops the per-MR creature for a simpler runtime.
Rendering in Chromium at runtime was ruled out: it would put a browser in
the compiled binary.

## Uploads

Every state change uploads the new GIF (50-80 KB) and rewrites the note.
The board caches each upload's markdown per MR and state variant in its
state db and reuses it when the latch returns to a variant it has shown
(error, then running again). Existing latches keep their old PNG until
their next state change, then get the new banner.

## Where it changes

- `packages/rt-client/src/latch.ts`: markers and `LatchKind`.
- `apps/board/src/latch/markers.ts`: bodies per state.
- `apps/board/src/latch/banner.ts`: GIF compositor.
- `apps/board/src/latch/post.ts`: a state-rewrite write beside
  `postLatch` and `spendLatch`.
- `apps/board/src/latch/discussions.ts`: request and canonical rules for
  the new kinds.
- `apps/board/src/triage/latch.ts`: queue instead of refuse, dispatch
  from queued, error and retry, stuck and recovery.
- `apps/board/src/latch/review-step.ts` and the server's latch step:
  done transitions from running, error transition on a review error.
- `apps/board/scripts/build-latch-band.ts` and `assets/latch/`.
- `apps/board/src/state/db.ts`: the latch state table.
- `apps/board/src/triage/notify.ts` or its caller: the stuck
  notification that ignores `triage.notify`.

## Calls the builder makes

- The two-frame leg shuffle has to work for all 16 invadr creatures;
  derive it from the bottom rows generically and check every sprite in
  the build preview.
- The latch table's exact schema and its `SCHEMA_VERSION` claim.
- Audit entries for each new transition, in the existing `latch` event
  shape.
- How the pass detects a dead running review: reuse the run liveness
  contract, never a new timeout.

## Verification

- Unit tests for every transition in the lifecycle, including the
  ordering cases (server signal and pass racing, retry after error,
  approval from each state).
- A banner test that each state encodes, has the expected frame count,
  stays under 150 KB, is 1560x192, and is transparent outside its
  rounded corners in every frame.
- Render every state and wait reason into a preview page and look at it
  in GitLab light and dark styling before calling it done.
