# Fast setup: answer once, wait once, one progress bar

Status: draft for Matt's approval
Mocks: `docs/apps/design/setup/setup.pen`, row P (P1 to P7 with P5b, plus P3c, P3r, P5s, P6b)
Builds on: branch `setup-onboarding-flow` (its approval signal, join-status, repo cloning, board folder and Finish rulings carry over)
Audit behind it: every setup row, step, prompt and team-declared input, checked against the mocks (the gaps it found are answered under "What the audit found")

## Why

Joining a team today takes about 25 clicks spread over seven pages and a long checklist. Questions arrive one row at a time, Install stops partway to ask for a password, and things the member must do (Slack, Claude sign-in, Doppler login, cloning repos) surface after Install, so they can never walk away. Matt wants three things: cut the manual presses, speed the whole thing up, and ask for every input up front.

## Goals

- One screen of macOS permissions, one choice of how you're setting up, one wait for the admin, one form, one progress bar.
- After the member presses "Set up this Mac", nothing asks them anything until it's done.
- The form asks only what this member's team actually needs, because it comes after approval when the team's settings are known.
- Every row says in one short line what it lets mattstack do.
- The wait for the admin is its own calm screen, never part of the progress bar.

## Non-goals

- Changing what gets installed. The same steps run; only when and how they ask changes.
- The admin's side of approval (the admin still approves from the member-joined notification).
- Settings after setup, beyond the new places some answers live.

## Anti-goals

- The progress bar ever looking stuck. Waiting on a person is never shown as progress.
- A browser tab or system dialog appearing unannounced while the member is away.
- Copy that sounds alarming or like mattstack is collecting something ("Mac password", "read your team's secrets").
- Installing team tools on a Mac whose join the admin hasn't approved.

## Approaches considered

1. **One form before approval, everything installs, approval-dependent rows finish later.** First mock. Lets the member answer and walk away during the wait, but the form can't know what the team needs, Slack can't be connected (it needs the team's app, which needs approval), and the bar would carry the wait.
2. **Wait for approval first, then one form, then one bar.** Matt's pick. The form knows the team's settings, Slack goes on the form, nothing team-specific installs before approval, and the bar never waits on a person. Cost: a member who walks away during the wait comes back to a form; the "You're in" notification brings them back.
3. **Keep the checklist pages, trim rows.** Smallest change, but keeps the one-row-at-a-time shape and the mid-Install interruptions.

## The flow (approach 2)

### P1 · Three things from macOS
One card, three rows, no Continue button: the page moves on by itself once all three are done.
- **Full Disk Access** · "Reads your repos and Chrome's profile". Open settings; mattstack reopens itself once it's on.
- **Notifications** · "Tells you when setup is done". Allow.
- **Fancy URLs** · "Grant mattstack apps permission to use .mattstack". Allow raises macOS's own admin dialog once, and the local proxy is installed and its certificate trusted right then, in one prompt (today it is two prompts in the middle of Install). No password is stored or carried to later.
- Login Items approval and Apple's Command Line Tools are not rows. Command Line Tools starts downloading in the background here (it runs through the wait); Login Items only appears if macOS holds the background item. (Matt's ruling.)

### P2 · How are you setting up?
Four cards, choosing one moves on: **Join a team**, **Create a team**, **Just me**, **Move from another Mac**.

### P3 · Paste your invite (Join)
- The invite code, already filled in when mattstack was opened from the invite link. Shows "Mithrandir, invited by Jane Doe" once read.
- The forge token the join needs, when the team's forge needs one (GitLab always; GitHub only without a gh sign-in): a field and "Create token", which opens the forge's new-token page with the right scopes ticked. Subtext: "Lets mattstack reach the team's repo and open MRs". It sits here, not on the form, because joining clones the team's repo.
- **Join** sends the request and goes straight to the wait.

### P4 · Waiting for your team admin
- Ticket icon in a neutral tile; the team name as a quiet label ("MITHRANDIR"); title "Waiting for Jane Doe to confirm your membership"; "Let them know you're waiting. Setup carries on the moment they approve"; "Next: a few questions, then it runs by itself"; "We'll let you know when you're in"; Hide.
- No copyable message. No progress bar.
- When approval lands: a "You're in" notification, and in the background mattstack installs only what a sign-in on the form needs (Claude Code, and team tools that carry a sign-in, such as Doppler).
- No decline: an unapproved request keeps waiting, as today. (Matt: no decline, no not-approved screen.)

### P5 · You're in. Connect your accounts (and P5b · Last bit: this Mac)
Two screens (Matt split the form): **P5** "One click each. Most open in your browser" holds the connections (GitLab, Slack, Claude, team-tool sign-ins, Linear, Fast Browser) and ends with Continue, which unlocks once each is connected; **P5b** "Where Mithrandir's repos and your settings live" holds Your repos and Your settings and ends with Set up this Mac. Each is one card of rows, each with a control and a one-line subtext saying what it lets mattstack do (Matt's copy where given):
- **GitLab** · "✓ Connected as janedoe from your invite" (answered on P3).
- **Slack** · "Connect Slack" · "Lets mattstack track and post PRs in Slack", with MRs for a GitLab team (follows the forge). Opens Slack's Allow page in the member's own browser (where they are signed in to Slack; never an in-app web view). The row ticks itself off when Slack hands back.
- **Claude** · "Sign in to Claude" · "You know, to do agentic stuff." Shows "Installing…" until Claude Code is in, then runs `claude auth login` (with `--email` prefilled when known) and watches `claude auth status --json`.
- **Team tools with a sign-in** (Doppler for the example team) · "For running your dev servers". Installing…, then Sign in.
- **Your repos** · one entry per tracked repo: Current checkout (Locate…) or New checkout (Choose… a folder). Existing checkouts are found and preselected; the board's repo says "The board starts here". (Matt chose per-repo over one folder.)
- **Linear** (only when the team uses Linear) · key field and "Create token" · "So mattstack can read and write Linear tickets".
- **Your settings** (the home repo, named for someone new to mattstack) · "Keep on this Mac" (default) or "Store in a remote repo" · "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later". Forge-neutral wording: the backup is usually a GitHub repo even on a GitLab team (Matt). The repo is chosen in a follow-up when this is picked. (Matt: default to this Mac, explain it for new users.)
- **Fast Browser** · "Add to Chrome" · "Lets agents drive your real Chrome". Opens the extension's Web Store page at its Add button; the row reads "Waiting for Chrome…" and flips to "Added ✓" by itself. If Chrome is missing the button reads "Get Chrome" first.
- Not asked: writing style (sparse by default), the board's folder, editors.
- Footers: P5 "Continue unlocks once each one is connected", **Continue**; P5b "About 10 minutes once you start", **Set up this Mac**.

### P6 · One progress bar
"Setting up this Mac", "Nothing needs you. Close the window if you like". One bar with a short general message ("Cloning your repos"), a percent, and time left; no step list (Matt dropped "Show details"); Hide; a notification at the end.
- **P6b · Setup paused:** the bar stops, the message says what failed and why ("Couldn't clone acme-api", "GitLab says your token can't see acme/acme-api"), "Everything before this step is done", **Show log** and **Retry**.

### P7 · This Mac is ready
A green check, "This Mac is ready", "Go make something cool", **Open the board**. No summary list. (Matt: the summary was too much detail.)

### Other paths
- **P3c · Create a team:** team name, where its settings live (GitLab or GitHub), group, token, **Create team**. No wait; goes to the same form. The owner-only Slack app step joins the creator's form.
- **P5s · Just me:** the form without team rows (code host optional, Claude, repos folder, backup, Fast Browser), then the bar.
- **P3r · Move from another Mac:** backup repo and recovery key, **Restore**, then the bar.

## Matt's scope rulings
- **The new flow replaces the checklist everywhere**, not just first run: Setup status, rows an app update adds or breaks, and Join or Create team from Settings all move to the new screens and Settings. The old checklist pages are retired.
- **Homebrew** installs inside the single P1 approval when it's missing.
- **Mission Control shortcut** moves to Settings. **Chrome sign-in** (a pack's "Chrome must be signed in to X") and **skill overrides** (old key names in a hand-edited overrides file) appear in Settings only when they apply; neither shows in setup or blocks Finish.

## Rulings carried in
- Finish: `tool.linear-mcp` blocks Finish only when the team uses Linear; `account.board-peering` never blocks Finish; a Local-only home repo can finish. (Matt, 2026-10-29; committed on the base branch.)
- Writing style resolves to sparse when nothing chose one; the row no longer blocks Finish.
- Fast Browser: Web Store, on the form, made to watch itself. Not Chrome policy, not the external-extension file.
- Slack: the member's own browser, never an in-app web view.

## What the audit found, and where each lands
| Gap today | In this design |
|---|---|
| Proxy raises two admin dialogs mid-Install; a 10-minute timeout stops the run | P1 Fancy URLs, one prompt, done before anything else |
| GitLab needs a pasted token; the Connect sheet has no create link | P3 token field with Create token |
| Joiner repos deferred past Install | fixed on the base branch; P6 clones them |
| Slack blocks Install; its listener waits 5 minutes | P5, while the member is at the form |
| Approval gates the checklist | P4, before anything team-specific installs |
| Claude sign-in is a terminal step | P5 Sign in to Claude via `claude auth login` |
| Doppler login never prompted | P5 team-tool sign-in row |
| Writing style blocks Finish | sparse by default |
| Closing the window lets an app update relaunch mid-Install, and Install doesn't resume | updates held while setup runs, window or not; setup resumes after a relaunch |
| Login Items approval stops services.start | surfaced only if macOS holds it |
| Chrome missing needs a manual download | P5 Get Chrome |
| Command Line Tools installer | starts at P1, runs through the wait |
| Mission Control blocks Finish | not on the form; stays a skippable row in Settings |
| Home backup assumes GitHub | forge-neutral "remote repo"; the member picks where |
| Notifications prompt and login-item banner fire at launch, before P1 | moved to P1 |

## My calls (check these)
- **The form is built from the plan, not a fixed list.** rt works out which rows this member needs (team integrations such as sdm or ldcli, pack tools, sign-ins) and the app only draws them; no decision in Swift. This likely needs one new rt verb or plan block for the form.
- **Sparse is written onto new Macs at setup**, not by changing the registry default, so existing users who never picked a style keep what they have.
- **After a relaunch, the bar resumes by itself.** Every prompt was front-loaded, so the remaining steps cannot raise a dialog or open a browser; if one would, the bar pauses (P6b) instead. Form answers are saved as they're given, so a relaunch mid-form loses nothing. One `rt setup apply` owns the run; a resumed run attaches rather than starting a second.

## Open (for Matt)
None left from the review; see My calls.

## Spikes before planning
- `claude auth login` completes without a terminal (no paste-a-code fallback); if not, P5 needs a code field.
- Doppler's login without a terminal.
- One admin prompt that both installs the proxy and trusts its certificate.
- Watching for the Fast Browser extension without a Check again button.

## Left to the builder
Page layout details beyond the mocks, the progress bar's weighting and message set, the time-left estimate, and the restore screen's hint for where the recovery key lives (today it is CLI only; the mock's Settings path does not exist yet).
