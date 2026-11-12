# Confirm new teammates from console

## Intent

When a new teammate redeems an invite, the team admin has to confirm them
(`rt team members sync`) before their Mac stops waiting. Today the only
prompt is one `member_joined` banner from the daemon's invite-replies sweep.
The sweep marks each reply notified once and never asks again, so a missed
banner leaves no trace anywhere. On 2026-11-05 the dev app never showed the
banner for a reply; it arrived only after the prod app took the Mac over.

Console gets a place that lists who is waiting and confirms them, whether or
not a banner ever reached the admin.

## Goals

- An admin sees every teammate who replied to an invite and is not yet
  confirmed, in console, without relying on a notification.
- One click confirms, running the same sync the banner runs.
- Works the same whichever app flavor (prod or dev) is running.

## Non-goals

- Inviting or removing members from console.
- Changing the banner. It stays as it is; confirming from either place
  clears both, since the sync removes the invite record.

## Approaches

- **A. Through the rt CLI (picked).** `rt team status --json` reports open
  invites; the console server reads it and runs `rt team members sync` on
  Confirm through its existing `runRt`. Least new plumbing, follows how the
  console server already reaches rt, and the CLI gains the same list.
- **B. New daemon verbs.** `team:pending-joins` / `team:confirm-join`
  handlers and a typed rt-client entry. More code, and a new way for console
  to reach team state.
- Re-firing the banner until confirmed was dropped: it leans on the
  notification path that already failed.

## Design

**CLI.** `rt team status --json` gains
`invites: [{ handle, teams, expiresAt, state: "invited" | "replied" }]`,
filled only on a Mac holding invite records for the team (the inviter's).
`replied` comes from a live switchboard read (the same `readReply` +
`openReply` the sweep uses), never from the daemon's `invite-replies` kv, so
the list does not depend on which daemon ran the sweep. An expired invite is
left out. The human output adds a "waiting to join" row naming the replied
handles. The envelope's existing keys stay as they are.

**Confirm.** `rt team members sync --team <slug> --json`, unchanged. It adds
every replied invitee at once, so the confirm is per team: with one person
waiting the button reads "Add <handle>", with more it reads "Add N people".
(My call.)

**Console server.** `GET /api/team`: status for every team on this Mac.
`POST /api/team/confirm { slug }`: runs the sync and returns its result.
Both through `runRt`; the sync uses the write timeout.

**Console UI.**
- A Team page at `/team`: members (role, board connected) and invites
  (waiting to join / invited, with expiry).
- A "Team" rail entry with a count badge of replied invites, built like the
  Slack chats entry (`SlackRailEntry`).
- A "Waiting to join" card on the home page, shown only when the count is
  above zero, with the confirm button.
- Polls about once a minute. Mocked in pen.dev first and shown to Matt.

## Left to the builder

- How the console server lists the teams on this Mac (an existing rt verb,
  or looping `rt team status --team`).
- Error and empty states, following console's existing patterns.
- The confirm's failure copy, from the sync's own result.

## Separate track

Why the dev daemon missed the 2026-11-05 reply is investigated alongside,
and fixed on its own if it turns out to be a code bug.
