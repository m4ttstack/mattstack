# Codeowner tabs and the re-review latch on GitHub (BOARD-66, BOARD-65)

Status: draft for review, 2026-11-12. Project: GitHub parity (P-RT-28).

## Why

A GitHub team's board shows its PRs but has no codeowner tabs, an ask
picker with no code owners, and no re-review latch. All three work on
GitLab. The latch is the board's most loved feature: a reviewer's board
leaves a banner thread on the MR, the author resolves it when they have
addressed everything, and the reviewer's board runs a follow-up review on
its own. This change brings all three to GitHub without changing anything
on GitLab, and keeps the latch's banner and its feel.

Verified on main at 2e68600d0:

- **Tabs are configured, not derived.** A `board.tabs` entry with
  `source: {kind: 'codeowners', section}` names one section. `boardDemand`
  (`data.ts`) sends the configured sections to the daemon as
  `codeownerSections` only when `config.forge.kind === 'gitlab'`, and the
  known-sections read (`data.ts`, around line 395) drops GitHub's
  `knownSections` and `uncoveredSections`. Those two lines are the only
  reason GitHub tabs are empty.
- **The daemon already does the GitHub side.** The GitHub project sync
  (`lib/daemon/project-sync-github.ts`) runs the same section sweeps with
  glance's `fetchApprovalRules` and `fetchCodeownerSections`. On GitHub a
  rule's `section` is an owner token from CODEOWNERS, lowercased: `@org/team`
  or `@login`. `sectionsMatching` compares sections exactly.
- **The ask picker's owners are GitLab-only.** `readOwnerRules`
  (`server.ts`) reads GitLab's `approval_state` through `forge:get`, and
  `ownerTeamsFromRules` (`owner-teams.ts`) reaches a team through the Slack
  channel in a GitLab section name. On GitHub no owner block ever appears.
- **The latch is GitLab-only at its seams, not in its logic.** The state
  machine (`triage/latch.ts`, `latch/land.ts`, `latch/review-step.ts`,
  `latch/post.ts`) reads MR threads (`MRDetail.discussions`) and writes
  through one injected `LatchGateway`. The threads already come through the
  daemon's `discussions:read` on both forges, and a GitHub review thread
  arrives as `gh-review-thread-<root id>` with `resolved`, a numeric root
  note id, its author and its body. What is GitLab-bound: `latchGateway`
  (direct `NoteMutator`/`GitLabProvider` calls), the `gitlabOnly` and
  GitLab-token gates in `bin/triage.ts` and `server.ts`, `MRDetailFetcher`
  for counting new comments, GitLab-token identity, and the numeric
  `projectId`. `triageForgePlan` turns respond asks and the latch off
  together on GitHub (`asksAndLatch: false`).
- **Daemon verbs for most latch writes exist and answer on GitHub:**
  `discussions:resolve` (resolve and unresolve), `discussions:reply`,
  `mr:note-update`, `mr:action requestReReview`, `discussions:read` and
  `discussions:refresh`. Two writes have nothing behind them: a file-level
  review thread (`mr:comment` makes a plain comment, `mr:comment-inline`
  needs a line, glance has no `subject_type: file` call) and an upload
  (`mr:upload` refuses GitHub).
- **A pending GitHub review request reads as `reviewState: 'UNREVIEWED'`**
  in the reviewer list the board already gets from the daemon store
  (glance `mapReviews`).

Facts about GitHub proven by a live spike on 2026-11-12 and a probe by the
shepherd on 2026-11-13 (not to be re-probed):

- REST create review comment with `subject_type: 'file'` posts the thread in
  one call, wrapped in a submitted COMMENTED review.
- `resolveReviewThread` and `unresolveReviewThread` repeat cleanly; the
  thread id is stable; the body can be edited; a reply works, and each
  reply is its own COMMENTED review.
- When the thread's file leaves the diff, the thread is outdated but still
  listed and resolvable. A file thread survives edits to its file.
- There is no upload API. `gh pr comment --attach` uploads, gives a
  `user-attachments` URL that renders in a review comment body, and leaves
  a plain PR comment behind. An image reused by URL in another comment kept
  rendering after its holder comment was deleted, and the asset URL still
  answered 200 after the deletion. In the first seconds after an upload an
  unauthenticated fetch of the asset URL answered 404, then 200.
- `requested_reviewers` re-requests a reviewer and adds a
  ReviewRequestedEvent. A context-line thread only works inside a hunk.
  Check runs need a GitHub App. A plain comment has no resolve state.

## Goals

- A GitHub team configures codeowner tabs the way a GitLab team does, with
  each tab naming one CODEOWNERS owner (`@org/team` or `@login`). Rows are
  tagged, counts are right, and a tab naming an owner CODEOWNERS does not
  have shows the "not in CODEOWNERS" chip.
- The ask picker on a GitHub PR lists its real code owners: a `@login`
  owner as that person, a `@org/team` owner as the members of the
  directory team that claims it.
- The re-review latch works on GitHub as it does on GitLab: a file-level
  review thread carrying the banner image. It is resolved when the latch is
  spent and unresolved to re-arm, exactly as GitLab's thread is, and its
  phases and banners are the same.
- When a GitHub author asks for a re-review, the author's board also sends
  GitHub's own re-request of that reviewer, so GitHub notifies them. Each
  reviewer gets at most one per request, whichever way the author asked.
- A PR with no changed files gets no latch, and re-review there is manual.

## Non-goals

- GitHub's native re-request button starting a follow-up review on the
  reviewer's board. The latch's trigger stays the thread resolve on both
  forges (a follow-up ticket can add it).
- Respond asks on GitHub. They stay off; only the latch half of
  `asksAndLatch` turns on.
- Code Owner Slack posts on GitHub. A GitHub owner token names no channel,
  so there is nothing to post to.
- GitHub owners in console's settings autocomplete
  (`apps/console/src/server/suggest.ts`) and the tab schema's "CODEOWNERS
  section header" wording in rt-client. Both are follow-up tickets outside
  this lane's fence.
- Reading GitHub team membership. A team owner reaches people only through
  the directory field below.
- Exposing any of the three new daemon verbs as an MCP tool. The board is
  their only caller.
- GitHub Enterprise.

## Anti-goals

- Any change to GitLab behaviour: every GitLab latch call keeps its glance
  method, arguments, order and error text; GitLab tabs, demand, the
  approval_state read and the channel join are unchanged byte for byte.
- The board holding a GitHub client or token. Every GitHub read and write
  goes through a daemon verb.
- A new poll, a shorter interval, or a read the board's cadence does not
  already make, beyond the costs stated under Request cost.
- A test, fixture or browser check that reaches a real PR, the real daemon
  or the real HOME.
- Losing the banner's per-PR creature or its animation on GitHub.
- Two GitHub re-requests for one ask, or a re-request sent by the
  reviewer's own token (GitHub does not notify someone of their own act).

## Constraints

- Standing rulings: GitLab behaviour does not change; one forge per team;
  forge-aware copy (PR on GitHub, MR on GitLab); new per-MR actions go in
  the right-click menu (this change adds none); the board's identity on
  GitHub is the team record's forge username (`forgeSelf()`), and an
  unverified seat owns nothing; the fetch cadence is deliberate.
- Write fence: `apps/board/`; `lib/daemon/` for the three verbs below;
  `packages/glance/` for the one method below, only after the shepherd says
  the glance lanes (PR #1121 at 0.33.1, then a 0.33.2 live-fixes job) have
  merged; `packages/rt-client/` for the one directory key and the three
  verbs' entries in `src/commands.ts` (this spec asks for the
  `commands.ts` widening: the board's `rtCommand` is typed from it).
- The forge-copy-sweep lane (chat id `forge-copy-sweep.x5pq`) is editing description strings in
  `packages/rt-client/src/settings/registry-defs.ts` and
  `registry-schemas.ts` and regenerating `schema.lock.json`. DM it before
  touching those files; add only this key; merge main and regenerate the
  lock if its PR lands first.
- New daemon verbs follow `.claude/rules/daemon.md` (no outcome logging in
  handlers; `ctx.log` for domain events) and `.claude/rules/mcp-and-gates.md`
  (upload guard and roots). `mr:attach-upload` reuses the guard and roots
  the evidence upload path enforces (`checkAttachment` in
  `lib/daemon/handlers/mr-upload.ts`); the guard is never loosened.
- Fixture mode refuses every non-GET with 501, so a browser check cannot
  fire a write.
- UI copy follows rt:ui-copy; kit primitives only; no coloured border with
  a radius; no dot separators; no em or en dashes.

## Approaches

Picked by the shepherd on Matt's behalf, 2026-11-12.

**A. One forge-split latch gateway (picked).** `LatchGateway`'s methods
take a per-MR target instead of GitLab's numeric `projectId`. The GitLab
gateway keeps today's calls. A GitHub gateway runs over `rtCommand`. The
triage pass, the server's done signal and the re-review settle pick a
gateway by the board's forge. The state machine and its crash ordering stay
as they are, and both gateways are fakeable in tests.

**B. A separate GitHub latch module** built around review requests. It
could fit GitHub more closely, but it would duplicate about 1,500 lines of
crash-ordering and compare-and-set logic that took many rounds to get right.

**C. Daemon verbs for both forges.** One path, but GitLab's requests would
change, against the standing ruling.

## Decided (shepherd on Matt's behalf, 2026-11-12 and 13)

1. The file-level thread is a new glance method behind a new GitHub-only
   daemon verb, `mr:comment-file`. The upload is a new daemon verb,
   `mr:attach-upload`, on gh with no glance change. The glance and daemon
   work goes last in the plan, after the glance lanes merge, in this PR.
2. The upload's holder comment is deleted by id right after its URLs are
   read back. Minimizing it as outdated is the stated fallback.
3. A GitHub codeowners tab names one CODEOWNERS owner in its `section`,
   matched case-insensitively. The board stops withholding demand and
   known owners on GitHub.
4. The ask picker's GitHub owners come from a new daemon verb,
   `mr:owner-rules`, read on the same rule as GitLab's approval_state read.
   A team owner reaches people through a new optional directory field,
   `teams.<name>.github.team`.
5. The author's board sends the GitHub re-request: one rule for every way
   of asking, once per request cycle per reviewer.
6. A PR with no changed files gets no latch: a `no-files` audit entry, no
   post, and manual re-review.
7. Approach A.

## Design: codeowner tabs (BOARD-66)

### Owner keys

On a GitHub board a codeowners tab's `section` holds an owner token as the
team typed it (`@Acme/Web`). The board compares it through one helper,
`sectionKey(forge, section)`: lowercase on GitHub, unchanged on GitLab. It
is used in exactly these places:

- `boardDemand` sends `sectionKey`'d sections as `codeownerSections` on both
  forges (the `forge.kind === 'gitlab'` condition goes). The daemon's exact
  `sectionsMatching` then matches glance's lowercased rule sections.
- Every comparison of a tab's section with a row's `codeownerSections` or
  with the daemon's `uncoveredSections` compares keys on both sides:
  `buildBoard`'s tag filter and `channelForMR` (`data.ts`), `filterByTab`
  (`view.ts`), the backfill check, and any other site a grep for
  `source.section` finds.
- `sectionStatus` (`sections.ts`) compares the key against the known owners.

The stored tab and its label stay as the team typed them.

**What a GitHub tag means.** GitHub's rules come from its own code owner
review requests, not from matching CODEOWNERS globs, and the daemon's GitHub
sweeps are sticky (`sticky: forge === "github"` in `project-sync.ts`): a PR
tagged once stays tagged until it merges or closes, even after the owner
reviews. Two differences from GitLab follow, accepted here *(my call: matching
globs against changed files would be new glance and daemon work and more
requests)*:

- A draft joins its owner tabs when it is marked ready, since GitHub
  requests no code owners on a draft.
- An owner GitHub never requested (someone without write access, say) does
  not tag the PR.

### Known owners

The known-sections read keeps GitHub's `knownSections` and
`uncoveredSections` (the two `forge === 'github'` exclusions go), so
`scopeKnownSections` carries the CODEOWNERS owners on GitHub and the
backfill and "no such section" logic run unchanged. A GitHub repo with no
CODEOWNERS file has `knownSections: null` from glance, which the board
already reads as "unknown", so no chip shows.

### Copy

The chip and its tooltip become forge-aware: on GitHub, "no such owner"
and "this tab's owner is not in the repo's CODEOWNERS". The backfill hint
names an owner instead of a section. GitLab copy is unchanged. Final words
come from rt:ui-copy.

### The ask picker's owners

**Verb.** `mr:owner-rules {repoName, iid} -> {rules: [{type, section,
approved}], unknownReason?}` calls the repo's provider's existing
`fetchApprovalRules({projectPath, iids: [iid]})`. It is forge-generic in the
handler, but the board calls it only on GitHub, since GitLab keeps its
`forge:get` approval_state read. It is not an MCP tool.

**When it is read.** `refreshOwnerTeams` keeps its rule: own PRs only,
re-read only when the PR's `updatedAt` or approver set changed since the
stored read. `readOwnerRules` picks its source by the board's forge. On
GitHub it keeps `CODE_OWNER` rules as `{section, approved}`. A reply with
`unknownReason` stores an empty rule list, so a repo GitHub cannot answer
for is not re-read on every pass *(my call: today a null read is retried
every pass, which on GitHub would be one GraphQL query per own PR per
snapshot)*. A failed call still stores nothing.

**Owner to people.** `ownerTeamsFromRules` takes the board's forge. GitLab
keeps its channel join. On GitHub:

- `@login` (no `/`) becomes `{person: login, section, approved}`.
  `OwnerTeam` gains an optional `person`.
- `@org/team` becomes `{team: <directory team>, section, approved}` when a
  directory team's `github.team` equals the token, compared
  case-insensitively (`mine` when that team is the active team).
  Otherwise it becomes `{section, approved}`, like an unclaimed GitLab
  section.

`askPickerModel` lists a `person` owner's one person under an owner block
headed by the `@login` token, when that person is askable (same `askable`
rule as every other block). A team owner lists its directory team's members
exactly as today. GitHub drops a user owner's rule once that person
reviews, so a user owner never reads approved. They are already "engaged"
by then and leave the picker anyway.

`readOwnerRules` also feeds the Code Owner Slack posts (`ownersPostPlan`).
On GitHub that path stays as it is: a GitHub owner token names no channel,
so `planOwnersPost` finds nothing to post to, and the posts stay a
non-goal. A test pins that a GitHub rule set plans no post.

**Directory key.** `mattstack.directory.teams.<name>.github.team`: an
optional string in the `@org/team` form, titled and described per
rt:settings and rt:ui-copy ("GitHub team: the CODEOWNERS team this team
answers for, e.g. @acme/web"). It is added to `registry-schemas.ts` (and
`registry-defs.ts` if the key needs a def there), with `schema.lock.json`
regenerated, following the rt:settings skill and
`.claude/rules/settings.md`. The board reads it from the directory it
already loads.

## Design: the re-review latch on GitHub (BOARD-65)

### What a GitHub latch is

The reviewer's board posts a file-level review thread on the PR's first
changed file. Its body is the same marker, banner image and sentence a
GitLab latch carries (`latchBody`). Every phase rewrites the root comment's
body, and the thread is resolved, unresolved or left as each transition
says today. Replies (the finished reply, the stuck reply) go in the thread.
`findLatches`, `reviewerLatches` and the whole state machine read it from
`discussions:read` unchanged.

### The gateway seam

`LatchGateway` changes shape, and the GitLab side keeps its calls:

```ts
/** The MR a latch write lands on. GitLab reads projectId and projectPath;
    GitHub reads rtRepo (the serialized daemon identity) and iid. */
export interface LatchMr {
  projectId: number | null;
  projectPath: string;
  iid: number;
  rtRepo: string;
}

export interface LatchGateway {
  forge: 'gitlab' | 'github';
  /** Uploads each file; one markdown image per file, in order. */
  uploadFiles(mr: LatchMr, files: LatchFile[]): Promise<string[]>;
  /** null: the MR has no file to anchor a thread on. */
  createThread(mr: LatchMr, body: string):
    Promise<{ discussionId: string; rootNoteId: number } | null>;
  updateNote(mr: LatchMr, noteId: number, body: string): Promise<void>;
  resolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
  unresolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
  createNote(mr: LatchMr, body: string, discussionId?: string):
    Promise<{ id: number }>;
}

/** One banner to upload. `alt` is the image's alt text, which
    bannerMarkdown checks a cached upload against. */
export interface LatchFile {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
  alt: string;
}
```

- **GitLab gateway** (`latch/gateway.ts`). `uploadFiles` calls
  `NoteMutator.uploadFile` once per file, in order, with today's arguments,
  and returns each upload's `markdown`. `createThread` calls
  `createDiscussion` and returns the root note (never null). The rest call
  today's methods with `mr.projectId` / `mr.projectPath` and `mr.iid`. On
  GitLab only one file is ever passed, so its requests do not change.
- **GitHub gateway** (`latch/github-gateway.ts`), over `rtCommand` with
  `mr.rtRepo`:

  | Method | Daemon call |
  |---|---|
  | `uploadFiles` | write each file into the staging folder below, `mr:attach-upload {repoName, iid, files}`, delete the staged files, return `![<alt>](<url>)` per file |
  | `createThread` | `mr:comment-file {repoName, iid, body}`; `{fallback: 'no-files'}` returns null |
  | `updateNote` | `mr:note-update {repoName, iid, noteId, body}` |
  | `resolveDiscussion` | `discussions:resolve {repoName, iid, discussionId, resolved: true}` |
  | `unresolveDiscussion` | `discussions:resolve {…, resolved: false}` |
  | `createNote` | `discussions:reply {repoName, iid, discussionId, body}` (the latch only ever replies in its thread) |

  A daemon error throws with the daemon's sentence, so the pass's existing
  per-MR catch and the server's catch handle it as they handle a GitLab
  error today. Every call uses one timeout constant above the daemon's own
  budget, as `forge-writes.ts` does.

`LatchTarget` becomes `LatchMr & {mrUrl, discussionId, rootNoteId}`.
`postLatch`, `spendLatch`, `spendAllLatches`, `rewriteLatch`,
`postReplyDue`, `bannerMarkdown`, `landFollowUp` and `spendForApproval`
take the `LatchMr` where they take `projectId`/`projectPath`/`iid` today.
Their logic and ordering do not change. `LatchMrFacts` (`triage/latch.ts`)
already carries `rtRepo`; its `projectId` becomes `number | null`.

### Staging the banner for upload

The board writes each GIF to
`~/.mattstack/evidence/board-latch/<random>/latch-<iid>-<key>.gif`, inside
rt's built-in evidence root, which the upload guard admits. It creates the
folder with mode 0700 if it is missing, and removes its own subfolder after
the verb answers, success or not. The board never asks to widen the guard's
roots.

### Banners on GitHub

`bannerMarkdown` gets the gateway's forge:

- **One batch per arm.** On GitHub, when a variant is not yet cached for
  the PR, the board uploads it together with every uncached member of the
  common set: armed, queued (next sweep), running, done (uncounted),
  done-approved and approved. All go in one `uploadFiles` call, so one
  holder comment, and each is cached in `latch_uploads` as GitLab's single
  upload is. A rarer banner (another wait, retrying, stuck, superseded)
  uploads alone the first time it is needed, exactly as on GitLab. On
  GitLab the batch is always just the one variant, so nothing changes.
- **The done banner drops its painted count on GitHub**: the landing uses
  `{state: 'done-comments', count: null}` when the gateway is GitHub. The
  finished reply still says "Follow-up review done: 3 new comments."
  GitLab keeps its counted strips.
- Per-PR creature, animation, strips and alt text are unchanged.

### Copy

`ARMED_COPY` and the done-comments sentence become forge-aware. On GitHub,
"...take another pass over the PR." GitLab keeps "MR". The armed sentence
keeps "Resolve this thread", which is literal on both forges. The banner
strips carry no forge word, so they are not redrawn.

### No changed files

`createThread` returning null is the `no-files` outcome. Both posting sites
(`applyReviewLatch` on the done signal, and step 0 of the latch pass)
then:

- write no latch row and post nothing;
- append a `no-files` latch audit entry;
- record `latch-no-files` in the board's kv store, keyed by MR URL with the
  finished review's `runStamp`. Both sites skip posting while the stored
  stamp equals the current review's. So the pass does not retry the post
  on every tick, and a later review of the PR, after files are added, tries
  again.

On GitHub the order is upload, then post, so a no-files PR still pays for
one banner batch the first time. *(My call: checking files first would
cost a call on every arm to save one on a rare PR.)*

### Identity and gating

- **Triage** (`bin/triage.ts`, `triage/forge-plan.ts`). `TriageForgePlan`'s
  `asksAndLatch` splits into `asks` and `latch`. GitHub: `asks: false`,
  `latch: true` when the team record has a username. Its log line says
  respond asks skip GitHub teams, and no longer says the latch does. GitLab:
  both true, as today. The latch pass runs on GitHub with
  `self = plan.identity.recorded`, no GitLab token, the GitHub gateway,
  `projectId: null`, and `countNew` read through `discussions:refresh`
  (then `countNewDiscussions`).
- **Server done signal** (`server.ts`, the latch step). On GitHub `self` is
  `forgeSelf()`. The detail comes from `readLatchDetail` as today, the
  gateway is the GitHub gateway, and `countNew` uses `discussions:refresh`.
  With no `forgeSelf()` the step is skipped and logged, as GitLab skips with
  no token identity.
- **Re-review settle** (`server.ts`). The `gitlabToken` condition becomes
  "this board can write its forge": a GitLab token on GitLab, a resolvable
  rt repo on GitHub. The resolve goes through the board's gateway.
- **The token must be the recorded user.** `findLatches` only sees threads
  whose root author is `self`, so if the daemon's GitHub token belonged to
  someone other than the team record's username, the board would never see
  the thread it just posted. It would post a fresh banner thread, and a
  fresh upload batch, on a later tick, over and over. So before any GitHub
  latch write (the pass, the done signal, the settle and the re-request
  step), the board checks the daemon's existing `forge:self {repoName}`
  against `self`, compared case-insensitively. A match is remembered in the
  board's kv store for 24 hours, keyed by repo identity. A mismatch, or no
  answer, skips every latch write for that repo, logs one line naming both
  logins, and audits `identity-mismatch` once per run *(my call: it follows
  the ruling that an unverified identity owns nothing)*. GitLab keeps its
  token-derived identity, which cannot mismatch.

### The GitHub re-request (author's board)

A pure helper, `reviewerRequests(detail, author)`, gives one entry per
reviewer (other than the author) with a live latch: `{reviewer,
discussionId, requested}`. `requested` is true when that reviewer's newest
latch is armed and resolved, or reads queued, running or error. *(Error is
my call: the follow-up is still being retried, so the ask is still
open.)* It is computed beside `reviewerLatches` where the board already
reads its own PRs' threads (`ownedHere`), so it costs no read.

After each snapshot, on a GitHub board, a background step
(`sendReReviewRequests`, beside `refreshOwnerTeamsInBackground`) walks own
PRs:

- For each `requested` entry whose reviewer's `reviewState` is not
  `UNREVIEWED`, and whose `latch-rerequest` kv entry (keyed
  `<mrUrl>|<discussionId>`) is absent, it calls `mr:action {action:
  'requestReReview', args: [[reviewer]]}` and then writes the kv entry. A
  reviewer already `UNREVIEWED` (the author clicked GitHub's own button)
  gets the kv entry written without a call.
- For each latch thread that reads armed and open, or spent, or is gone,
  it deletes its `latch-rerequest` entry, so the next request cycle on the
  same thread sends again.
- A failed call writes nothing and is retried on the next snapshot. It is
  logged, never thrown. An unanswered call (`DAEMON_UNREACHABLE_PREFIX`)
  writes the kv entry anyway: the request may have landed, and a duplicate
  notification is worse than a missing one.

This covers the board's own re-review pick (its settle resolves the thread
and marks the snapshot stale), a resolve made by hand on GitHub, and a run
already queued or running when the author's board starts.

### Request cost (stated per latch and per hour)

| When | Calls (GitHub API requests through the daemon) |
|---|---|
| Arm | `mr:attach-upload` with 6 files: 1 comment POST, about 12 asset requests (gh's upload policy and storage PUT per file), gh's own lookups of the repo and PR (about 2), 1 comment GET, 1 DELETE. `mr:comment-file`: PR GET, files GET, comment POST, then a discussions refresh (about 4). About 22 in all. |
| Each phase change (about 3 per review cycle) | `mr:note-update`: 1 PATCH; `discussions:resolve`: 1 GraphQL plus its refresh, when the thread changes |
| A rare banner | about 5 (one-file upload) |
| A reply | 1 POST plus a refresh |
| Each landing | 1 `discussions:refresh` for `countNew` (about 4), from the pass or the done signal, whichever lands it |
| Each ask | 1 `requested_reviewers` POST, plus `mr:action`'s usual read-back |
| Latch pass reads | `discussions:read` per in-scope PR per triage run: served from the daemon's store on a granted repo, refetched at most every 2 minutes otherwise; only PRs with a finished review or a live latch |
| Owner rules | 1 GraphQL query per own PR change |
| Identity check | 1 `forge:self` (one `GET /user`) per repo per 24 hours; the kv entry is shared by the triage pass and the server through the state db |

A reviewer running 3 review cycles in an hour costs about 110 requests that
hour, and a typical hour far less. GitHub allows 5,000 per hour. No poll or
interval is added.

### The three daemon verbs

All three take the serialized repo identity as `repoName`, decode it with
`decodeRepo`, and are registered like their neighbours, with types in
`packages/rt-client/src/commands.ts`. None is an MCP tool.

- **`mr:comment-file {repoName, iid, body}`** -> `{discussionId, noteId,
  path}` or `{fallback: 'no-files'}`. GitHub only: a GitLab repo answers
  `unsupported: mr:comment-file needs a GitHub repo`. It calls glance's new
  `createFileComment`, then refreshes the PR's discussions in the daemon's
  store (as `discussions:reply` does), so a following `mr:note-update`
  finds the note's kind.
- **`mr:attach-upload {repoName, iid, files: [{path, name}]}`** ->
  `{urls: {[name]: url}}`. GitHub only. Each file goes through
  `checkAttachment` (the same guard, roots, redaction and evidence-record
  checks as `mr:upload` and `mr:describe-with-attachments`), with 1 to 10
  files and unique names. It stages them as
  `mr:describe-with-attachments` does, then runs `gh pr comment <iid>
  --repo github.com/<path> --body-file <staged body> --attach
  <file>#<name>`, with the token only as `GH_TOKEN` in gh's environment.
  The body references each file by name, so gh rewrites each reference to
  its asset URL. It reads the comment id from gh's printed comment URL,
  reads the comment's body back (`GET /issues/comments/<id>`), and maps
  each `![name](url)` to its name. Then it deletes the comment through
  glance's `deleteComment` with kind `general`. It never fetches an asset
  URL, so an early 404 cannot fail it. A missing URL fails the verb after
  the delete. A failed delete is logged at warn and the URLs are still
  returned: the images are what the caller needs, and a leftover holder
  comment is noise, not harm.
- **`mr:owner-rules {repoName, iid}`** -> `{rules: ApprovalRuleLite[],
  unknownReason?}` from `provider.fetchApprovalRules({projectPath, iids:
  [iid]})`.

### The glance method

`GitHubProvider.createFileComment(projectPath, iid, body)` ->
`{discussionId: 'gh-review-thread-<id>', noteId, path} | null`:

1. `GET /repos/{p}/pulls/{n}` for `head.sha`.
2. `GET /repos/{p}/pulls/{n}/files?per_page=1`. An empty list returns
   null.
3. `POST /repos/{p}/pulls/{n}/comments` with `{body, commit_id, path,
   subject_type: 'file'}`.

It goes through glance's `forgeWrite` like the other writes, and gets a
CHANGELOG entry and a version bump after the glance lanes' 0.33.2. A glance
test also pins how `fetchMRDiscussions` maps a file comment (`line: null`):
a `gh-review-thread-` discussion, resolvable, with `resolved` from the
thread index and a numeric root note id.

### Open risks and their fallbacks

- **A reply clearing a pending re-request.** Any review by the reviewer
  clears GitHub's request. The finished reply follows the follow-up review,
  which already cleared it legitimately, so only the stuck reply clears one
  early. Fallback: accepted, because the stuck path already sends the
  reviewer a desktop notification, and the `latch-rerequest` entry stops
  the author's board re-sending in that cycle. Covered by a fixture test.
- **An armed latch blocking merge** where a repo requires conversation
  resolution. Same as GitLab's "all threads must be resolved" today.
  Fallback: none needed for parity. Resolving the thread is the author's
  ask, as on GitLab, and an approval spends and resolves it.
- **Reviewer-side writes from a second account** are unproven live. They
  are covered by fixture tests of every gateway call. A team turns the
  latch on with `board.reReview`, and the first live use is Matt's sandbox
  check.
- **GitHub collecting an asset whose holder was deleted**, over days, is
  unproven. Fallback: switch the holder from delete to `minimizeComment`
  (classifier OUTDATED), a glance method plus one flag on
  `mr:attach-upload`.
- **The asset URL's early 404.** Nothing fetches it.
- **Two notifications per arm on GitHub** (the holder comment and the
  thread's wrapper review), against one on GitLab. Accepted.

## Testing

All fixtures, no live forge, isolated HOME.

- **Gateways.** The GitHub gateway sends each verb with the expected
  payload to a fake `rtCommand`, maps `no-files` to null, deletes its
  staged files on success and failure, and throws the daemon's sentence on
  an error. The GitLab gateway calls the same fake glance methods with the
  same arguments the current tests pin.
- **Latch machine.** The existing latch, land, review-step and triage-latch
  suites stay green through the signature change. New cases: a GitHub arm
  uploads the common set in one batch and posts the thread; a rare banner
  uploads alone; the GitHub landing uses the uncounted done banner and the
  counted reply; a no-files arm writes no row, audits `no-files`, records
  the memo, and a second tick does not retry until the run stamp changes;
  the GitHub armed sentence says PR.
- **Triage plan and wiring.** `triageForgePlan` on GitHub gives `asks:
  false, latch: true` with a username, and `latch: false` without one; the
  log lines; the latch pass runs on a GitHub team with the recorded
  username and no GitLab token.
- **Identity.** A matching `forge:self` is cached for 24 hours; a mismatch
  or no answer skips every GitHub latch write for that repo and audits
  `identity-mismatch` once per run.
- **Re-request.** `reviewerRequests` per phase. `sendReReviewRequests`
  sends once per cycle, skips an `UNREVIEWED` reviewer, forgets on re-arm
  and on spend, does not re-send after a stuck reply clears the request,
  and keeps its entry on an unanswered call.
- **Tabs.** `sectionKey`; GitHub demand carries lowercased owners; the
  GitHub known owners survive the read; tag matching, `filterByTab` and
  `sectionStatus` are case-insensitive on GitHub and exact on GitLab;
  GitLab demand is unchanged.
- **Owners.** `ownerTeamsFromRules` on GitHub for `@login`, a claimed
  `@org/team` and an unclaimed one; GitLab output unchanged.
  `askPickerModel` lists a person owner; `readOwnerRules` stores an empty
  list on `unknownReason`.
- **Daemon verbs.** Handler tests with fake gh, glance and stores: the
  `mr:attach-upload` guard refusals (a path outside the roots, bad bytes),
  the gh argv with no token in it, URL read-back, delete, the
  failed-delete path, and the GitLab refusal; `mr:comment-file` maps the
  `no-files` outcome and refreshes discussions; `mr:owner-rules` passes the
  rules through.
- **Glance.** `createFileComment`'s three requests, the empty-files null,
  and the file-comment discussion mapping.
- **Fixture and Fast Browser.** `tests/fixture-github/` gains: codeowners
  tabs naming `@acme/web` and `@ellie-dev`, plus one naming an owner its
  CODEOWNERS lacks; tagged rows (some by non-members); `knownSections`; own
  rows with `ownerTeams` (a person owner, a claimed team, an unclaimed
  team); and a row whose respond sheet offers a re-review pick on a GitHub
  latch. Everything stays invented. Rendered in Fast Browser in light and
  dark: the tab strip with counts and the "no such owner" chip, the ask
  picker with its owner blocks, and the respond sheet's re-review pick.
  `fixture-github.test.ts`'s empty-sections assertions flip to the new
  data.
- **Before the PR.** The board suite from `apps/board`, its typecheck,
  lint and skills check; targeted `bun test` for each touched `lib/daemon`
  file and the glance tests; `bun run typecheck` and `bun run purity` from
  the worktree root.

## Plan order

1. Tabs (board only).
2. The latch gateway seam and the GitHub gateway against a fake
   `rtCommand`, with banners, copy, no-files and triage wiring (board
   only).
3. The re-request step (board only).
4. Ask picker owners on the board side, against a fake `mr:owner-rules`.
5. The directory key (rt-client, after the DM to forge-copy-sweep).
6. The three daemon verbs (`mr:owner-rules` can go before glance frees;
   `mr:attach-upload` needs only glance's existing `deleteComment`).
7. The glance method, once the shepherd says glance is free, then
   `mr:comment-file`.
8. Fixture, Fast Browser in both schemes, full verification.

## Left to the builder

- Exact names beyond those above, and how the GitHub gateway and the
  re-request step split into helpers.
- Exact copy for the chip, the tooltip, the backfill hint, the directory
  key's title and description, and the armed and done sentences on GitHub,
  by rt:ui-copy.
- Whether `sectionKey` lives in `sections.ts` or its own file.
- Which fixture rows carry which data.
