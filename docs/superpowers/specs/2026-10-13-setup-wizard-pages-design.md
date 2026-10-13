# Setup wizard: one page per group, summary last

Status: design, approved by Matt on 2026-10-13. The rulings were made in
forms that day; the sections marked "proposed" were approved with the spec.

## Goal

A first-time user is never shown the whole checklist at once. Step 3 of
setup becomes a short page per group, each page asks only for what that
group needs, and after Install the user lands on the sidebar summary that
already ships as Setup status. A warning mark always means "you have to do
this".

Measured on the 2026-10-10 solo VM walkthrough: the current first-run
checklist opens with about 16 of 31 rows flagged. Five of those are set by
Install with no input, and six are optional.

## Rulings (2026-10-13)

1. **One page per group.** The first-run checklist step is replaced by a
   page for each group the plan sends, in plan order.
2. **Every group gets a page**, including one where nothing needs the user.
3. **All group pages come before Install.** The last group page's primary
   button is Install. No page is visited twice.
4. **Install ends on the summary.** The sidebar view replaces the
   "Installed" screen as the last step.
5. **The summary's Overview entry is wizard only.** Setup status opened from
   the menu has no Overview.
6. **A warning mark sits on a "Needs you" heading and nowhere else.** Rows
   under it carry no icon. Optional rows never carry a warning.
7. **Optional rows get their own plain section**, on wizard pages and in
   Setup status alike. They do not count as "need you".
8. **No "Install will set these up" section.** Rows Install handles sit with
   the rest that need nothing from the user.
9. **That section reads "No action needed · N"**, folded to one line with
   the row names. It opens by default on a page that has nothing else.
10. **Folded in:** marks on a sidebar entry whose row is running or failed,
    and the two UI test assertions weakened by PR #812.
11. **No further boards** for Access, Browser, Team and backup: they follow
    the pattern.
12. **Once Install has run, a faulty optional row with no button shows under
    Optional** with its detail and no warning mark, on the summary and in
    Setup status. On a wizard page before Install it stays under No action
    needed, since Install sets it. (PATH precedence reading "on your PATH but
    not first" on a Mac that is already set up.)

13. **The counts above the sidebar are buttons that filter.** Clicking
    "40 ready", "2 optional" or "3 not needed here" lists every row with
    that status in the right pane, from all groups, under its group's
    title. Clicking the count again, or any sidebar entry, goes back.
    (Asked while looking at Setup status in the dev app; built without a
    board, judged in the dev app.)

Set aside: pages on both sides of Install. Install blockers sit in four
groups (Your Mac, Accounts, Agents and editors, rt on this Mac), so a split
would visit Agents and editors twice.

## Boards

`docs/apps/design/setup/setup.pen`: boards G0 to G2 and H1 to H6, beside
the A to F boards for the shipped sidebar. G3 is a first draft, replaced by
H3 and H4.

| Board | Shows |
|---|---|
| G0 | The chosen flow |
| G1 | Your Mac page at first sight: required, optional, no action needed |
| G2 | Agents and editors page before Install |
| H1 | A page with only optional rows (Accounts on a solo setup) |
| H2 | A page where nothing needs the user |
| H3 | Summary after Install, nothing left, on Overview |
| H4 | Summary with a group selected: Optional, then No action needed |
| H5 | A row idle, running and waiting, failed; the four sidebar marks |
| H6 | Summary after Install when a row still blocks Finish |

Statuses on the boards are from the 2026-10-10 solo walkthrough. Guessed
copy on the boards, to be replaced by what the plan really sends: the GitHub
row's description, "mattstack is installed", "12 steps done", and the Full
Disk Access and Notifications button labels.

## How rows are sorted (proposed)

One pure function in `Sources-core/Readiness`, used by wizard pages, the
summary and Setup status. It reads only fields the plan already sends, so
rt does not change.

| Section | A row lands here when |
|---|---|
| Needs you | it blocks Install (`required`, not `finishGated`, not `ready`) or it is in `finishBlockedBy` |
| Optional | not in Needs you, not `ready`, and it offers an action or is `error` or `invalid`; once Install has run (the summary and Setup status), also any row that is neither `ready` nor `skipped` |
| No action needed | everything else: `ready`, or any other status with no action (`skipped`, or a row Install handles) |

A skipped row that still offers an action stays under Optional, as it stayed
at full height in PR #812.

A broken optional row with no button (a team marketplace that failed to
load) shows under Optional with its detail in red, and still no warning
mark (ruled 2026-10-13).

A Needs you row shows a badge: "Required" when it blocks Install, "Before
you finish" when it only blocks Finish.

This replaces `ChecklistLayout.folds`, which treated every row that was not
ready as needing the user.

## Wizard pages (proposed)

- `SetupStep.checklist` stays one step, with a current page (a group id)
  inside it. `--resume-setup checklist`, the upgrade entry at `.team` and
  the status window's `jump(to: .checklist)` keep working unchanged.
- The page list is the plan's non-empty groups, in order. If the plan gains
  or loses a group mid-wizard (Access appears once a token is stored), the
  list is rebuilt and the current page is kept by id.
- Header: the group's title, a "Step N of M" counter that counts every
  page, and a segmented progress bar.
- Body: a lead sentence, then Needs you, Optional, No action needed. An
  empty section is omitted.
- **Continue** is on when no row on the page blocks Install. A row that only
  blocks Finish does not hold Continue.
- **The last page's button is Install**, on when the plan's `canInstall` is
  true. rt's `canInstall` stays a hard veto.
- **Back** on the first page returns to Your team; on later pages, to the
  previous page.
- **After a relaunch** (Full Disk Access), setup reopens on the first page
  that still holds an Install blocker, else the last page.
- Footer status: "N required items left on this page." or "Nothing required
  on this page.", with the existing Re-check and "Checked just now" note.
- The Full Disk Access relaunch banner, the loading and load-failed views,
  and the connect, steps and choose sheets are unchanged.
- **"Continue in limited mode" is removed.** It existed because optional
  rows read as blockers.

## Install page

Unchanged. It already lists failed and partial steps with "Retry from here".

## Summary (replaces the Installed screen) (proposed)

The sidebar view from PR #812, as `SetupStep.done`.

- Sidebar entries: "Needs you" (only when a row blocks Finish or Install),
  "Overview", then the groups.
- It opens on Needs you when that entry exists, else on Overview.
- **Overview** carries what the Installed screen had: the headline and
  step count, the spinner while the post-install check runs, the "Couldn't
  confirm the checklist" error with Try again, "Needs another try" with
  Retry from here, "Where things live", Open the console (or board), and
  Invite teammates for a team owner.
- **Needs you** lists the rows blocking Finish with their action, and Skip
  for now when `waivable`, through the existing confirm sheet.
- A group pane shows Optional, then No action needed.
- **Finish** follows `DoneModel.finishEnabled` as today.
- "Still to do" has no section of its own: those rows are the Optional rows
  in their group panes, counted in the summary line.

## Setup status window

Same view, read only, with no Overview and Close in place of Finish. It
opens on Needs you when present, else the first group. The summary line
reads, for example, "22 ready · 6 optional · 3 not needed here", with
"N need you" first only when N is above zero.

## Sidebar entry marks

One mark per entry, first match wins: a row's action failed (red cross), a
row is running (spinner), a row is in Needs you (warning), else settled
(check). Row failures are kept per row id for this, where today the screen
holds one.

## Not changing

- The plan contract and every rt verb.
- Welcome, Your team and Install.
- Settings > Accounts, which keeps its flat list.

## Tests and walkthrough

- `MattstackCoreChecks`: the sorting function, the page list and its
  rebuild, Continue and Install gating, the relaunch landing page, summary
  entries and selection, sidebar marks.
- `SetupFlowUITests`: page through the groups on the stub plan. Restore the
  two assertions weakened in #812 by asserting on a row after selecting its
  page or group.
- `ChecklistRowSnapshot`: redraw in the new sections.
- VM walkthrough (`rt-tray/vm/run/guest/screens.sh`, `ax.sh`): act on rows
  in page order and press Continue between pages; `ax_reveal_row` learns to
  move between pages as well as sidebar groups. The Done section's steps
  move to the summary's Needs you pane. Element ids that survive keep their
  names.
- User docs that describe the setup screens are updated in the same PR.

## Verification

First run cannot be seen on a Mac that is already set up, so:

- the UI test suite on the stub plan, with screenshots of a blocked page, an
  optional-only page, an empty page and both summary states, light and dark;
- Setup status in the dev app on a real Mac;
- one VM walkthrough per scenario (solo, create, join) before release.

