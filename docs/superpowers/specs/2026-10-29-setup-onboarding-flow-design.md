# Setup onboarding flow: Full Disk Access first, join, then one Install

Mocks: `docs/apps/design/setup/setup.pen`, the "O · Onboarding a new team member" row (O1 to O7).

## Why

Two new members joined a team in one day and both hit the same walls:

- Slack and repo setup only appeared after Install, so the first Install left them half set up.
- Most steps were labelled optional. Almost all of them are wanted, so the label misled.
- Nothing said they were waiting on the admin. The Slack step just spun or failed until the admin approved.
- The board launched its review, respond and doctor panes from the wrong folder, or from none.
- Full Disk Access was asked for mid-setup, and turning it on needs the app to reopen.
- The Fast Browser extension hid behind a "Show steps…" button whose sheet held a plain blue link.

Success: a new member goes from invite to a working board in one pass, without asking the admin what a step means.

## Goals

1. Full Disk Access is the first step, before anything else runs.
2. Joining comes next: accept the invite, copy the team's settings, then wait on one screen until the admin approves.
3. After approval, one checklist where every step is expected, then one Install.
4. Only three steps can be skipped. Nothing is shown as "optional".
5. `board.cwds` points at the board's repo wherever the member placed it, and the board restarts to pick it up.
6. The Fast Browser extension is one clear button.

## Non-goals

- Changing what any step installs or checks (except `board.cwds`).
- The create-a-team (admin) path. It keeps today's order.
- Status mode after Finish (`rt setup status`), beyond the new required flags.
- Moving rt from the `herdr` CLI to herdr-core or the Herdr app.

## Anti-goals

- A member must never reach Install with Slack or their repos still unknown.
- Nothing may run on the member's Mac while approval is pending beyond the clone of the team's settings.
- The waiting screen must never read as a failure.

## Decisions (Matt's)

- **Order:** Full Disk Access, then Join and wait, then the checklist, then Install, then Almost done. 11 steps: Full Disk Access, Join, Your Mac, Accounts, Your repos, Agents and editors, Browser, rt on this Mac, Team and backup, Install, Almost done.
- **While waiting:** nothing else. Setup holds on the waiting screen until the admin approves.
- **Waiting copy:** "Waiting for your team admin to approve your request to join the team".
- **Full Disk Access:** its button deep-links to Privacy & Security › Full Disk Access (`SystemSettingsLinks.fullDiskAccess`, already `...?Privacy_AllFiles`). Once it is on but the running app predates it (`fdaNeedsRelaunch`), a "Reopen mattstack" button relaunches through `AppRelaunch.relaunchInPlace(resumeAt:)` and setup resumes at Join.
- **Skippable steps:** Skill overrides, Chrome sign-in (only shown when a pack declares `chrome.signedIntoApp`), Mission Control shortcut. Each has a Skip button and sits in a "You can skip" card. Every other step must be done before Finish.
- **Information only:** Push access and PATH precedence show in "No action needed", never as tasks.
- **Board folder:** `board.cwds` = `{review, respond, doctor}` all set to the local path of the board's repo, which is the first entry of `board.projects` (for an assured member, `assured/assured-dev`). Written when that repo is placed or cloned, rewritten if the placement changes, then the board restarts.
- **Installers:** claude and herdr install with their own scripts, never brew (PR #952).
- **Board defaults for the org:** `board.agent.model`, `board.agent.effort` and `board.triage` accept org and team scope (PR #954); the org values are set after the release that reads them.

## Today (what the change touches)

- **Plan composition:** `composePlan` in `lib/setup/plan.ts` builds the groups. For a joiner with no org clone it emits one stand-in row, `accounts.after-install`, because Slack, Linear and the tracked repos all come from the clone, and Install is what joins and clones (`plan.ts:133-142`, `:198`).
- **Gates:** `finalizePlan` and `finishBlockers` in `lib/setup/contract.ts`. `required` blocks Install; `finishGated` blocks Finish (`FINISH_GATED_ROW_IDS`, `FINISH_GATED_ACCOUNT_IDS`, `REPO_PLACE_ROW_PREFIX`). Rows only Install can satisfy read `required: false` before Install (`INSTALL_SATISFIED_IDS`, `INSTALLED_BY_INSTALL_NOTE`).
- **Optional section:** the app sorts every unfinished, non-required row into Optional (`ChecklistSorting.section` in `rt-tray/Sources-core/Readiness/ChecklistSorting.swift`; `ChecklistScreen.swift:158` passes `afterInstall: true` unconditionally; the card is in `ChecklistSections.swift`).
- **Approval:** nothing records "joined, waiting on the admin". `slackSecretWait` in `lib/setup/team-slack-secret.ts` infers it for Slack alone (`joinedByRt` and this Mac's age key not yet a sops recipient of `mattstack/org/secrets/board.json`). `org.pull`, `team.sync`, `admin-secrets` and `account.board-peering` show generic errors in the same state.
- **Join:** `joinRedeem` in `lib/team/join.ts` writes `joinedByRt` and `agePublicKey` and posts the sealed reply to the switchboard. The admin's daemon turns it into the `member_joined` banner (`lib/daemon/invite-replies.ts`); confirming runs `rt team members sync`.
- **board.cwds:** `boardKeysRun` in `lib/setup/steps/skills.ts:166-180` writes it once (`unwritten`), from the first tracked repo, only after every tracked repo is registered, and never restarts the board. Hence wrong or missing values.
- **Fast Browser extension:** `FAST_BROWSER_LOAD_STEPS` in `lib/setup/validators/tools.ts` is a `steps` action; `FAST_BROWSER_WEB_STORE_URL` is already defined there.

## The change

### 1. Full Disk Access first (O1, O1b)

A new first page before Welcome's team step. One card: open Full Disk Access, turn on mattstack, reopen. The page reads the existing `perm.fda` check. States: not on (Continue disabled), on but needs a reopen (Reopen mattstack button), on (Continue). `perm.fda` leaves the Your Mac page's to-do list and shows under "No action needed" there.

### 2. Join, then wait (O2, O2b)

Joining runs at its own step, before the checklist: redeem the invite and clone the team's settings (the work Install does for a joiner today). Then the page holds on the waiting state until approval.

- **Approval state** is one shared helper, generalised from `slackSecretWait`: joined by rt, and this Mac's age key is (or is not yet) a recipient of the org's secrets. `rt team pull` before each check.
- The waiting page shows three lines: Invite accepted, Team settings copied (with a count of what the team uses), Waiting for approval (with how long ago). A Check again button runs the pull and the check. The page also polls on its own.
- Once approved, the page shows "You're in the <team> team" and Continue.
- Rows that depend on approval (Slack, team sync, org secrets, board peering) never show their generic error while the approval state says waiting; the waiting page already covers it, and after approval they resolve normally.
- With the clone in place before the checklist, `accounts.after-install` goes away for this path: Slack, Linear and the repo rows are real rows on their pages.

### 3. Every step expected (O3, O6, O7)

- Every row a joiner sees is required, or finish-gated where Install cannot satisfy it first, except the three skippable ids.
- The skippable ids are waivable (`WAIVABLE_ROW_IDS`), show a Skip button, and sit in a "You can skip" card ("only if you won't use it").
- No "Optional" section, no "optional" sidebar chip, no Required badges (everything is required). The summary's count reads "N skipped".
- Push access and PATH precedence are information rows: shown under "No action needed" whatever their state.

The full step list and its target flag lives in the table at the end.

### 4. The board's folder (O4, O5)

- The Your repos row for the board's repo (first `board.projects` entry) carries the line "The board's review, respond and doctor agents start here".
- Install (and any later placement change) writes `board.cwds` at machine scope from that repo's placed path, replacing a stale value rt wrote. A value the member set by hand is left alone; track what rt wrote in setup state.
- Then restart the board so it reads the new folders. Install shows these as two steps: "Point the board at <repo>" and "Restart the board".
- Members already set up get the fix through a setup migration that rewrites a wrong or missing `board.cwds` the same way and restarts the board.

### 5. Fast Browser extension (O3, O3b)

The row's action becomes `open-url` to `FAST_BROWSER_WEB_STORE_URL`, drawn as a primary "Add to Chrome" button. After the click: "Waiting for Chrome" with Open again; the row re-checks on activate and turns ready once the doctor reports it loaded and paired. The pairing step keeps its own action.

## Step table

Today → after. "Before Install" = `required`; "Before Finish" = `finishGated`; "Install does it" = required:false before Install, required after.

| Step | Today | After |
|---|---|---|
| Full Disk Access | Before Install (Your Mac) | Step 1, its own page |
| Slack | Before Finish, Optional while waiting | Must, on Accounts |
| Linear | Before Finish | Must |
| Board peering | Optional | Must |
| Your repos | Before Finish | Must, on Your repos |
| herdr | Before Install | Must |
| herdr's Claude integration | Install does it | Install does it |
| Claude Code | Before Install | Must |
| Claude plugins and packs | Install does it | Install does it |
| Linear MCP | Optional | Must |
| Writing style | Before Finish | Before Finish |
| Editor, rt-context extension, Bundled extension | Optional | Must |
| Skill overrides | Optional | Can skip |
| Fast Browser | Before Install | Must |
| Fast Browser extension | Before Finish | Before Finish |
| Google Chrome | Optional unless a pack requires it | Must |
| Chrome sign-in | Optional | Can skip |
| rt PATH link, Shell integration | Optional | Must |
| Intercept shims | Optional | Must |
| Local proxy | Optional | Must |
| Team sync, Team marketplace | Optional | Must |
| Home repo backup, State backup tools | Optional | Must |
| Who you are | Optional | Must |
| Login Items, Daemon | Install does it | Install does it |
| Notifications | Optional | Must |
| Mission Control shortcut | Optional | Can skip |
| Push access, PATH precedence | Optional | Information only |

## Left to the builder

- Whether "Must" lands as `required` or `finishGated` per row: `required` where the member can act before Install, `finishGated` where only Install or a later step can make it ready. Install must stay reachable (an actionless required row is a dead end; see `.claude/rules/setup.md`).
- How the Swift side drops the Optional section: `ChecklistSorting` and the page lead text.
- Where the join and approval state live (a new setup-state field or a derived check) and the polling interval.
- The migration id and its guard for members already set up.
- The contract changes the tray needs (`PlanModels.swift`) and the `setup-copy` snapshots.

## Verification

- Unit tests for the plan per state (no FDA, waiting, approved, after Install) and for the approval helper.
- The setup-copy snapshots updated on purpose.
- A clean-room join walkthrough (`rt-tray/vm`): FDA first, waiting screen until the admin side approves, one Install, board launching panes in the placed repo.
- Every changed screen rendered and looked at in light and dark.
