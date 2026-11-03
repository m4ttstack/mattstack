# Settings backup without the gh CLI

## Why

Every member so far has kept their settings on their Mac only. "Store in a
remote repo" asked for a URL and push access they had to arrange themselves.
Creating the repo for them only worked on a Mac signed in to the `gh` CLI.
The new "Your settings" tiles (setup.pen QB1 to QB4) make GitHub the obvious
pick. This design makes that pick work on any Mac.

## Goals

- "Store in a GitHub repo" ends with a private repo that rt created and
  pushed to, whatever the Mac had installed beforehand.
- No URL to paste, no `gh`, no ssh key.
- The sign-in happens on "Last bit: this Mac", never during the run (the run
  may not open a browser).

## Non-goals

- GitLab or any other host for the settings repo.
- Changing how team forge tokens work.

## Approaches

1. **rt signs in to GitHub itself (picked).** GitHub's device sign-in: you
   confirm a short code on github.com. rt keeps the token in its own secret
   store, creates the repo through GitHub's API and pushes through its
   existing git credential helper.
2. rt downloads `gh`, then runs `gh auth login --web`. There's no app to
   register, but it adds one more tool to ship and pin.
3. A prefilled github.com/new link plus a pasted URL. Push access is still
   left to the member, which is the likely reason everyone skipped it.

## How it works

**Who needs to sign in.** A Mac on a GitHub team already holds a github.com
token from setup's forge step. If that token can create repos, nobody sees a
sign-in at all. Only Macs on GitLab teams, and Just me Macs with no GitHub
token, get the "Sign in to GitHub" step (QB3).

**Signing in.** The GitHub tile on such a Mac leads to one button. The
button runs a new hidden verb, `rt setup github sign-in`. That verb asks
GitHub for a device code using mattstack's OAuth app, which Matt registers
once with device flow on, asking for the `repo` scope (the same scope `gh`
asks for). The tray shows the code, opens github.com/login/device, and rt
waits for the token in the background. The row waits until the token lands,
the way the Claude sign-in row waits on its code.

**Keeping the token.** It goes into rt's personal secret store as the
github.com forge token, the slot a GitHub team's token uses. github.com is
already a host the credential helper trusts, so nothing changes there.

**Making the repo.** The staged create (`homeBackup: { mode: "remote",
create: true }`) stays as it is today. Only the step that lands it changes:
`setHomeRemote` creates `<login>/mattstack-home` as a private repo through
GitHub's REST API with rt's token, and falls back to `gh repo create` only
when rt holds no token. It then names rt's credential helper in the home
repo's git config and pushes.

**Copy.** QB2: "rt creates it as a private repo when setup runs", with the
repo name shown once rt knows the login. QB3: "Sign in to GitHub" and
"Opens your browser once. rt then makes a private repo for you".

## Needs Matt

- Register a GitHub OAuth app owned by the m4ttstack org, with device flow
  enabled and no callback needed. Its client id ships in rt; it isn't a
  secret.

## Left to the builder

- Polling interval and expiry handling follow GitHub's device-flow
  responses (`slow_down`, `expired_token`).
- How the waiting row is shown follows the existing Claude sign-in row.
