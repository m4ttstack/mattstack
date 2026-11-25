# Switchboard: text the relay cannot read

## Intent

The switchboard exists to carry envelopes: who, when, which MR, what state.
Over time, text that people write has joined them in the clear. This change
makes the premise true again: the relay, and the person who runs it, cannot
read text that one teammate writes to another.

MR addresses, MR numbers, usernames, statuses, message types and times are
routing facts. They stay readable.

## Goals

- Text people write is readable only on the Macs of the people it was sent to.
- It never falls back to plain text, whatever fails.
- A teammate on an older board still gets the ask.
- A test keeps new plain text off the wire.

## Non-goals

- Hiding who messages whom, about which MR, and when.
- Proving who wrote an ask note. Anyone can encrypt to a public key, so the
  relay could still invent a note. Support messages keep their org signature.
- Protecting an agent from what a teammate's text tells it to do.
- Protecting against the app itself: whoever ships the app ships the code that
  encrypts. The docs say so plainly.
- Encrypting text at rest on the recipient's own Mac.

## Anti-goals

- A shared org key for this. The relay's owner is also an org member and would
  hold it.
- Our own cryptography.

## What is sealed

| Message | Sealed | Stays readable |
|---|---|---|
| Asks (`review-request`, `re-review-request`, `respond-request`) | `title`, `sourceBranch`, `note` | `mrUrl`, `iid` |
| `nudge-outcome` | `declineNote`; `reason` unless it is a fixed code | `mrUrl`, `iid`, `nudgeId`, `result`, `declined`, a fixed reason code |
| `review-state`, `respond-state` | `reason` unless it is a fixed code | `mrUrl`, `iid`, `status`, `outcome`, `updatedAt`, `nudgeId`, `parkedAt` |
| `announcement` | `title`, `message` | a fixed placeholder title and message |
| Support request and status | the whole `body` | `id`, `to`, `kind`, `sentAt`, `mac` |

Team invites are already sealed and do not change.

## Constraints

- Every member who joined through an invite has an age key in their keychain,
  and the org roster (`mattstack.roster[].agePublicKey`) holds its public half.
  A roster entry with no key belongs to someone who has not finished joining.
- The private key is only ever read through `AgeKeySeam`
  (`lib/home/age-key.ts`), and a keychain dialog must never hang a tick.
- The board, its cron triage and the rt CLI all send. Only rt reads keys.
- `age` already ships in the app bundle (`rt-tray/deps.lock`). Process launches
  can cost a quarter second on a managed Mac.
- Boards of different versions talk to each other. An older board drops a
  payload it cannot parse and ignores fields it does not know.
- Support has not been in a release yet, so no support host in the field needs
  to understand both forms.

## Approaches

- **A. Seal only the text (picked).** Routing facts stay readable, so an older
  board still shows the ask without its text. One release. Fixes exactly what
  was concerning.
- **B. Seal the whole payload.** The relay sees only sender, recipient, type
  and time. An older board drops such a message as malformed, so it needs two
  releases, and a missing key loses the ask, not only its note.
- **C. Move the text to GitLab and Slack.** Nothing to seal, but a note becomes
  an MR comment and support changes shape.

Decided with Matt: A, readable by the recipient alone (not the relay's owner),
and trimmed pings as a separate change.

## Design

### Sealing lives in the rt daemon

Two daemon commands, used by the board through rt-client and by rt directly:

- **Seal** takes recipient usernames, a binding and a small object of text
  fields. It returns one sealed string for all of them and the usernames that
  have no key.
- **Open** takes a sealed string and the same binding. It returns the fields or
  a reason it could not: not for this key, binding mismatch, unreadable, or no
  key on this Mac.

The daemon runs the bundled `age`: public keys as recipients, text on stdin.
To open, the identity goes in on stdin and the ciphertext through a private
temp file that is removed after. The private key never reaches argv, a file or
a log. Recipients come from the roster of the org this Mac reads settings from,
matched by canonical username.

One seal covers a whole fan-out: a review-state going to ten people is sealed
once for ten keys, and each envelope carries the same string.

### The binding

`age` has no associated data, so the binding goes inside the sealed text: a
version, the message type, the sender's username, and the MR address (or the
support request id, or the announcement id). Open refuses a string whose
binding does not match the envelope it arrived in, so the relay cannot move one
message's text onto another message.

### On the wire

A payload gains one optional field, `sealed`. The text fields it replaces are
never sent again. A receiving board ignores those plain fields from now on,
except that it still shows them from an older sender until the version ping
shows no older boards; after that the reading code goes too.

Support's `body` becomes the sealed string. The existing signature covers it
unchanged, so the host checks the signature before it opens anything.

### When sealing is not possible

| Case | What happens |
|---|---|
| Recipient has no key | The ask goes without its text. The sender sees "Sent without your note: <name> has not finished joining." |
| rt cannot seal (daemon down, no `age`) | The ask goes without its text, and the sender sees that the note was not sent |
| Support, host has no key | The form is disabled and says the host has not finished joining |
| Support, rt cannot seal | The send fails with a plain reason and can be retried |
| Announcement, some members have no key | It goes out; the sender sees how many cannot read it |
| Announcement, rt cannot seal | It fails with a plain reason. Nothing is sent |
| A received string will not open | The ask still shows, with a short line that its note could not be read. Support answers the sender with the existing "could not read your request" status. An announcement shows its placeholder |

The placeholder announcement reads "Announcement" and "Update mattstack to
read this."

A locked keychain is not a failure to read: the message waits and the next tick
tries again, as support's unproved messages do today. It becomes unreadable
only after that wait runs out.

### Keeping it true

A test builds every kind of outgoing message and fails on any key or free text
outside an allowlist of routing fields, in the same spirit as
`no-switchboard-url-setting.test.ts`. Adding a text field to the wire then
means sealing it.

### Docs

`apps/board/docs/peer-boards.md` (Privacy), the support guide and the relay's
own comments say what the relay sees, that the text is sealed to its
recipients, and the limits listed under Non-goals.

## Separate change: pings

Its own PR, independent of the rest. The version ping stops sending changed
file paths, branch and upstream names and commit ids from the org settings
clone, and the names of stale skills. It keeps counts, the pull state, the
yes/no flags and the times, plus whether the clone is on its data branch. Org
name and forge username stay. The wire shape stays readable by the deployed
relay (empty lists and nulls), the relay's page drops those columns, and the
relay clears the old values from stored rows when it starts. The comment
"no repos, hostnames, paths or commands" becomes true.

## Left to the builder

- Command names, the sealed string's encoding, and where the code sits.
- Whether opened text is cached beside the ask row or opened on each read.
- Reading the key once per tick or holding it briefly, within the keychain
  constraint above.
- Exact wording of the lines a person sees, within rt's copy rules.

## Done when

- A relay database holding one of every message contains none of the text that
  was sent.
- Two boards, one new and one a release old, exchange an ask in both directions
  with no plain text leaving the new one.
- A recipient with no key, a dead daemon and a missing `age` each send an ask
  with no text and tell the sender.
- A sealed string copied onto another MR's ask does not open.
- The allowlist test fails when a text field is added to a payload.
