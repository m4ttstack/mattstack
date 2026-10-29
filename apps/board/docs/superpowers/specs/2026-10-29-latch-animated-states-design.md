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
  short copy, 520 CSS px wide.
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

Every banner is a 520x64 strip (1040x128 pixels, 2x for Retina) on
`#2a2638`, the creature on the left, a title in Silkscreen 18 (`#ece8f4`)
and a subtitle in IBM Plex Mono 13 (`#b7b0c8`). The accent colours the
creature and its indicator.

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
starts tomorrow", "Waiting for the running review" (review or respond in
flight).

Done-comments takes N from the review's structured JSON report
(`readReviewReportJson`) when the pane wrote one: "1 new comment", "N new
comments" up to 20, "20+ new comments". With no JSON report, "New
comments. Resolve when ready".

The note body under the image keeps a plain sentence per state, so email
notifications and blocked images still say what is happening. The current
armed and spent copy stays; new states get one sentence each.

The prototype GIFs and preview this design was reviewed from were rendered
by a throwaway Chromium script; they are the visual reference for frame
timing and layout, not code to keep.

## The lifecycle

1. A review lands with comments and no latch exists: post an armed latch
   (unchanged trigger, new banner).
2. The author resolves it. The next latch pass sees the request, rewrites
   the note to `queued` with the banner for the current wait reason, and
   leaves the thread resolved. It does not reply "Not yet" for a reason
   that clears by itself (cooldown, budget, review or respond in flight).
   Reasons that never clear (no earlier commented review, already
   reviewed) keep today's refusal reply and reopen.
3. Each pass re-decides every queued latch. When the decision becomes
   dispatch, it launches the review, rewrites to `running`, and charges
   cooldown and budget exactly as today. If the wait reason changes, the
   banner changes with it.
4. The review lands (server signal, with the pass as backstop):
   - comments: rewrite to `armed` with the done-comments banner, reopen
     the thread. The next resolve starts again at step 2.
   - approve: rewrite to `spent` with done-approved, keep resolved.
5. The review errors, or its pane dies under the run liveness contract,
   while the latch is `running`: rewrite to `error` (retrying), keep
   resolved, and treat it as queued for the next pass. Retries obey
   cooldown and budget. A retry that launches flips it back to `running`.
6. After three failed attempts in one request cycle, the latch stays
   `error` with the stuck banner, retries stop, and the reviewer gets a
   board notification. It leaves stuck only when that MR's review runs
   again (the reviewer relaunches it from the board): the pass sees the
   review `reviewing` and flips the latch to `running`.

Approvals keep today's precedence: the reviewer's own approval (via
review or GitLab) spends every copy from any state, and spent still wins
over everything in the pass.

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

The posted markdown is `![<state title>](<upload url>){width=520}` so
GitLab shows it at 520 CSS px instead of stretching it to the column.
`imageMarkdownOf` must keep matching with that suffix.

Alternative B (one committed GIF per state, same creature for every MR)
was rejected: it drops the per-MR creature for a simpler runtime.
Rendering in Chromium at runtime was ruled out: it would put a browser in
the compiled binary.

## Uploads

Every state change uploads the new GIF (30-60 KB) and rewrites the note.
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

## Calls the builder makes

- The two-frame leg shuffle has to work for all 16 invadr creatures;
  derive it from the bottom rows generically and check every sprite in
  the build preview.
- Where the three-failure count lives (dispatch memory per MR is the
  obvious home) and when it resets (a launch that reaches `done`).
- What a manual reopen of a queued latch means. Suggested: the author
  withdrew the request, so rewrite to armed.
- Audit entries for each new transition, in the existing `latch` event
  shape.
- How the pass detects a dead running review: reuse the run liveness
  contract, never a new timeout.

## Verification

- Unit tests for every transition in the lifecycle, including the
  ordering cases (server signal and pass racing, retry after error,
  approval from each state).
- A banner test that each state encodes, has the expected frame count,
  stays under 80 KB, and is 1040x128.
- Render every state and wait reason into a preview page and look at it
  in GitLab light and dark styling before calling it done.
