# pr-usher design

## Intent

An always-on agent whose only job is to keep PRs moving in the repo it runs in.
Author agents hand their ready PRs to it and stay available for questions; the
usher gets each PR reviewed, settled, green and merged.

## Goals

- Every ready-for-review PR (never drafts) gets a review: CodeRabbit first, an
  Opus subagent when CodeRabbit is rate limited or absent.
- Findings reach the author agent; the usher waits for every thread to settle.
- Once settled and CI is green, the usher merges on its own.
- Other agents can tell whether an usher is online for their repo.

## Non-goals and anti-goals

- No rt code changes. Built from existing chat, MCP and forge tools.
- The usher never writes to a branch whose author is still online.
- The usher never merges a draft, a red PR, or one with an open thread.
- Not an orchestrator: it does not start work or spawn authors.

## Approaches

- **Status + `#pr-usher` room (picked).** Usher signs in with status
  `pr-usher` and joins `#pr-usher`; authors find it in `rt chat who --json`
  and DM the handoff. Zero code, ships as plugin text.
- New `rt usher` daemon verb. Sturdier presence, but an rt code change and a
  slower path. Rejected for now.
- Owner by branch matching alone. Fragile; kept only as a fallback for PRs
  nobody handed off.

## Decided

- **Merge authority:** the usher merges without asking. This is a named
  exception to the "merge needs Matt's confirmation" rule, scoped to the
  usher. Each merge is posted to `#pr-usher`.
- **Fixes:** the author agent fixes by default. If the author is offline,
  the usher fixes in its own worktree and pushes.
- **Presence:** status `pr-usher` plus the `#pr-usher` room. One usher per
  repo; a second one that finds a live usher for the same repo says so and
  exits.

## Shape

- `plugins/mattstack/skills/pr-usher/SKILL.md`: the usher's loop.
  1. Sign in (status `pr-usher`), join `#pr-usher`, refuse if one is live.
     Announce in the repo's chat room that an usher is on duty (and again
     on sign-out), so agents already running hear about it.
  2. Each tick: list open ready PRs in this repo (handed off or not).
  3. Per PR, walk: review requested -> findings relayed -> threads settled ->
     CI green -> merged (via `mr_merge`, honouring a merge queue).
  4. Questions go to the author (from the handoff, else branch match in
     `rt chat who`); offline author -> usher fixes.
  5. Self-paced wakeups between ticks; chat DMs wake it sooner.
- `plugins/mattstack/rules/pr-usher-handoff.md`: tells every agent, after
  opening and readying a PR, to check for a live usher for the repo, DM it
  the PR and own handle, and stay signed in for questions; otherwise
  babysit the PR as today.
- Plugin version bump.

## Left to the builder

- Exact per-PR state record (chat history vs a scratch ledger).
- Tick cadence and the CodeRabbit wait before falling back to Opus.
- Wording of the handoff DM.
