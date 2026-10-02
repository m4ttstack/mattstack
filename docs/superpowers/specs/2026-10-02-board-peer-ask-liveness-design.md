# Board: peer ask liveness

## Problem

A review asked of a teammate's agent can spin on "reviewing" forever. On
2026-10-02 an ask for !46244 was launched by the reviewer's board, the
reviewer closed the pane without finishing, and the asker's band kept
saying "reviewing" for hours. Three gaps combine:

1. The reviewer's board never tells the asker that a review run ended
   without finishing. It sends review-state only from agent status signals
   (`handleAgentSignal` in `server.ts`), and a pane closed by hand emits
   none. The orphan strip's "clear" settles the local lane to `error` but
   sends nothing either.
2. The asker's board has no timeout once an ask is `launched` or
   `confirmed`. Only an unanswered (`requested`) ask self-expires, after
   48 hours.
3. Peer review state is the only live board state still kept as loose JSON
   files, and inside the code checkout (`apps/board/state/peer-reviews/`),
   not under `~/.mattstack/board/`. It is lost to anything that clears
   ignored files in the checkout, is skipped by state backups, and was seen
   emptied mid-session with no known cause.

## Goals

- An ask whose review pane closed shows that on the asker's band, with
  Retry and Dismiss, within one sweep of the reviewer's board.
- An ask that goes quiet shows so after 30 minutes, with Retry and Dismiss,
  even when the reviewer's board is old or offline.
- Peer review state lives in `state.db`.
- Old boards keep working against new ones in both directions.

## Non-goals

- Explaining the 2026-10-02 peer-review file deletion.
- Heartbeats from long-running reviews.
- Any change to how reviews themselves run.

## Design

### 1. Peer reviews in the database

`peer/peer-reviews.ts` keeps its exported functions and types, but its
storage moves from per-file JSON to the existing `kv` table:

- Namespace `peer-review`, key `<mrUrl>\n<reviewer>`, value the
  `PeerReviewState` JSON. No new table and no `SCHEMA_VERSION` bump.
- `writePeerReview(s, db = getStateDb())`: in one transaction, read the
  current value and write only when `s.updatedAt` is newer (the existing
  last-write-wins rule). Returns whether it wrote. Wrapped in
  `persistOrWarn` like the other peer stores.
- `readPeerReviews(db = getStateDb())`: `listKvValues('peer-review')`,
  grouped by `mrUrl` as today.
- `prunePeerReviews(keepUrls, db = getStateDb())`: deletes keys whose MR is
  not in `keepUrls`, in one transaction.
- `peerReviewFilePath` and `PEER_REVIEW_DIR` stay only for the import.
- One-shot import, run by the server at startup after `getStateDb('server')`:
  when the `meta/peer-reviews-imported` kv marker is unset, read every
  `*.json` in `PEER_REVIEW_DIR`, write each through `writePeerReview`
  (so a newer db row wins), set the marker, then rename the folder to
  `peer-reviews.imported-<date>`. Unreadable files are skipped. A rename
  failure is logged and does not block startup. Skipped under
  `BOARD_FIXTURE`.

Callers (`server.ts`, `peer/materialize-deps.ts`) do not change.

### 2. The asker's band stops waiting forever

A new display, `no-update`, derived when the row is built (no write), the
same way `requested` becomes `no-response`:

- `sentNudgeDisplay`: a resolution of `launched` or `confirmed` whose `at`
  is older than `NUDGE_QUIET_MS` (30 minutes) reads `no-update`.
- A later `queued` or `reviewing` review-state now refreshes the
  resolution: `resolveSentNudge` accepts replacing `launched` as well as
  `confirmed` with a new `confirmed`, so the 30 minutes count from the last
  thing heard. Today a `launched` ask ignores progress updates.
- The band (`ask-band.ts`) renders `no-update` with the warn tone, the
  hourglass icon, the label "no update", Retry and Dismiss, and a trail step
  "No update · <name>'s agent has been quiet for 30m".
- `SentNudgeInfo.display` and `SentNudgeDisplay` gain `no-update`.
- A late `done` or `error` still finishes the ask (`finishSentNudge`
  already accepts the underlying `launched`/`confirmed` resolution, since
  `no-update` is never stored).

Accepted limitation: a review that runs longer than 30 minutes without a
status change reads "no update" until it finishes. Retry and Dismiss do not
touch the running review.

### 3. The reviewer's board reports a closed pane

On the writer's existing sweep timer (`GATE_SWEEP_MS`, next to
`runGateSweep`), a new pass `reportClosedPeerReviews`:

1. Skip when not peering or when `defaultMember` is `all`.
2. Read review states and the reconciler view (`fetchReconcilerView`).
3. For each executor in state `gone`, find in-flight review lanes it owned
   with `lanesClearedByExecutor` (the same match the orphan strip's clear
   uses: `agentId`, else `sessionId`).
4. Keep lanes whose MR author is not this board's member (the same author
   lookup and own-MR guard as `handleAgentSignal`).
5. Skip a lane already reported for this run: kv namespace
   `peer-closed-reported`, key `mrUrl`, value the lane's `runStartedAt`.
6. Otherwise enqueue a review-state to the author:
   `{ mrUrl, iid, status: 'error', reason: 'pane closed', updatedAt: now,
   nudgeId }`, where `nudgeId` comes from `askIdForRun` as today, then
   record the kv marker and kick the outbox.

The reviewer's own lane state is not changed, so the row still shows the
interrupted badge and resume works.

Wire changes, all optional and additive:

- `ReviewStatePayload` gains `reason?: string`; `parseReviewStatePayload`
  accepts it when it is a string. Old boards ignore it and already treat
  `error` as a failed ask.
- `materializeEnvelope` passes `reason` into `finishSentNudge` for an
  `error` review-state.
- `finishSentNudge` also lets `done` replace a `failed` resolution, so a
  reviewer who resumes and finishes after the pane-closed report still
  turns the band to done. `rejected`, `expired` and `done` stay final.
- The band labels a `failed` ask with a reason as "stopped: <reason>"
  (for example "stopped: pane closed"); a `failed` ask without one keeps
  "failed to run".

## Compatibility

| Asker | Reviewer | Result for a closed pane |
|---|---|---|
| new | new | "stopped: pane closed" within one sweep |
| new | old | "no update" after 30 minutes |
| old | new | "failed to run" (old band, no reason) |
| old | old | unchanged: spins until dismissed |

## Testing

- `peer-state.test.ts`: the peer-review tests move to a temp `state.db`
  (write, newer-wins, grouping, prune); a new test covers the one-shot
  import (newer db row wins, marker set, folder renamed, second run inert).
- `nudges` tests: `no-update` after 30 minutes for `launched` and
  `confirmed`, not for `requested`; `launched` refreshed by a reviewing
  update; `done` replaces `failed`; `rejected` and `done` stay final.
- `envelope` and `peer-inbox` tests: `reason` parsed and carried to
  `finishSentNudge`; a non-string `reason` rejects the payload.
- A unit test for the closed-pane pass's pure core: given review states,
  executors, MR authors and the kv markers, it returns the envelopes to send
  (own MR skipped, already-reported run skipped, `gone` only).
- `ask-band` model and DOM tests for `no-update` and "stopped: pane closed".
- Render the band in both color schemes in Fast Browser before calling it
  done.
