# Dev logins: saved dev-server credentials a browser run can use

Ticket: RT-329. Related: FB-13 (flow input steps and secrets).

## Problem

A pipeline stage that captures browser evidence against a dev server stops at
the app's login page whenever the browser's session with the identity provider
has expired. The skills forbid typing a credential, so the run asks at a gate
and waits for the human to log in by hand. An unattended run becomes an
attended one.

The login page in practice is a hosted identity-provider page (an Auth0
universal login on its own host, for example `https://login.example.com`),
with email and password on one screen. The human's normal Chrome session
usually carries the login, so this page appears only after that session
lapses.

## Goal

When a saved login exists for the page's origin, the run fills it and carries
on with no human step. When none exists, the run asks as it does today, and
the gate offers to save one. The password never reaches the model, a
transcript, a report, MR text or a log.

## Decisions

These were settled in the design conversation.

1. **The credential is the human's own dev login**, not a separate test user.
   It must be a password used only for that dev tenant; the UI says so.
2. **One login per site, not per repo.** A login is keyed by the login page's
   origin. Every repo and worktree that redirects to that page shares it. This
   replaces the ticket's "scoped per repo".
3. **Storage is rt's sops store**, user scope only, never a team store.
4. **Delivery is Fast Browser asking the rt daemon**, never a file on disk.
5. **The site lock lives in the browser runtime**, not in a skill.
6. **Saving a login takes effect without restarting Fast Browser.** A spike
   showed `/reload-plugins` does not restart plugin MCP servers (same PIDs
   before and after), and `/mcp`'s reconnect is an interactive menu an agent
   cannot drive.
7. **Three entry points:** a Dev logins pane in the app's Settings window
   (reachable any time after install), `rt logins` in the terminal, and a
   "Save a login" button on the gate that opens the app's add sheet.

## Threat model

What this design defends against:

- **The model seeing a value** through any normal path: tool output, gate
  answers, command arguments, `rt logins list`, logs, events.
- **A page stealing a value.** A malicious or lookalike page, or a hostile
  iframe inside a real page, gets nothing: the runtime fills a saved value only
  into a field whose own frame origin exactly matches the login's origin.
- **Account lockout.** A saved login is tried once per page visit; a failure
  goes to the human.
- **A crafted app link planting a login.** A `mattstack://dev-logins/add` link
  can prefill the origin only. The human still types the password, and the
  sheet shows the origin prominently.

What it does not defend against, stated so nobody assumes otherwise:

- **A deliberately hostile process running as the same macOS user.** Such a
  process can already read the API token file and every other rt secret's
  decryption path. Dev logins sit inside the same boundary as the forge
  tokens the board scope already serves. The daemon cannot verify who is on
  the other end of its socket (its Bun server exposes no peer credentials),
  so it logs every read of the `fast-browser` scope with the client name and
  pid the caller declares, labelled as unverified. That makes reads visible;
  it does not prove who made them.

## Design

### 1. Storage (rt)

- A new secrets domain `dev-logins` in the user store
  (`~/.mattstack/user/secrets/dev-logins.json`, sops + age).
- One key per login. The value is JSON: `{"origin", "email", "password"}`.
- The key is derived from the origin so it passes `KEY_PATTERN`: the host,
  then `-<port>` when the port is not the scheme default, then `-http` when
  the scheme is `http`. `https://login.example.com` is `login.example.com`;
  `http://localhost:3000` is `localhost-3000-http`.
- Origin rules: `https` for any host; `http` only for `localhost` and
  `127.0.0.1`. The host is lowercased and IDN-normalized to punycode before
  keying. No path, query or fragment is kept.
- Never written to the team store. `rt secrets` keeps working on the domain
  for rotation, but `rt logins` is the supported surface.

### 2. rt verbs and daemon

`rt logins` (new command group, registered in `lib/module-registry.ts`,
plain-language descriptions, `bun run docs:gen` after):

| Verb | Does | Agent-safe |
|---|---|---|
| `rt logins list [--json]` | Origins and emails, never passwords, plus the runtime placeholder names | yes |
| `rt logins add <origin>` | Hidden-input prompts for email and password; `--json` reads `{email, password}` from stdin (the app's path) | no |
| `rt logins add <origin> --in-app` | Opens `mattstack://dev-logins/add?origin=<origin>`; collects nothing | yes |
| `rt logins remove <origin>` | Deletes one login | no |

- `add` refuses an origin that fails the origin rules, and never accepts a
  value as an argument. `omitBehavior`: `add` is `prompt`, `remove` is
  `picker` over saved logins, both gated on `isTTY && !json && !RT_BATCH`.
- `list --json` shape: `[{origin, email, fields: {email: "<name>",
  password: "<name>"}}]`. The names are the placeholder names Fast Browser
  registers (section 3), so an agent never guesses one.
- After any write, the verb emits the bus event `dev-logins.changed` with
  `{origins}` through the daemon. The event never carries a value or email.
- `secrets:read` gains a `fast-browser` scope over the unix socket. It
  requires the API token like every scope, returns only the `dev-logins`
  domain as `{logins: [{origin, email, password}]}`, and logs the read at
  `info` with the origins read and the caller-declared `{client, pid}`
  (unverified), never the values. The HTTP `/api/secrets` route does not forward `scope`, so this
  scope is socket-only by construction; keep it that way.

### 3. Browser runtime (the Playwright fork)

Two changes, shipped in one runtime release:

- **Site-locked secrets.** A new input channel `--secrets-fd=<n>` carries
  newline-delimited JSON frames: `{"secrets": [{name, value, origin, kind}]}`
  where `kind` is `email` or `password`. Each frame replaces the whole set.
  When `browser_fill_form` or `browser_type` resolves a `<secret>NAME</secret>`
  placeholder from this set, it fills only if:
  - the target element's own frame origin equals the entry's origin exactly
    (scheme, host, port), and
  - for `kind: password`, the target is an `<input type="password">`.
  Otherwise the call fails with an error naming the placeholder and the
  mismatch, and types nothing.
- **No literal fallback for any placeholder.** An unresolved
  `<secret>NAME</secret>` fails the call instead of typing the name. This
  applies to the existing `--secrets` file path too.
- Values stay redacted from tool output as today. The runtime logs
  `filled saved login for <origin>` on success, never a value.

The existing `--secrets=<file>` (cloud path) keeps working and is not
site-locked; a name present in both sources is refused at load.

### 4. Fast Browser launcher

- At startup, when `~/.mattstack/rt/api-token` and the daemon socket exist,
  the launcher calls `secrets:read` with scope `fast-browser` over the socket
  (a small hand-rolled client, the way the VS Code extension does it), maps
  each login to two entries (`<key>.email`, `<key>.password`), and writes one
  frame to a pipe passed to the runtime as `--secrets-fd=3`.
- It keeps the pipe open and subscribes to the daemon's `/ws` broadcast. On
  `dev-logins.changed` it re-reads and writes a new frame, then posts
  `fast-browser.logins-loaded` with `{origins}` to the daemon.
- With no rt, no token, or the daemon down, it starts with an empty set and
  retries the subscription with backoff; nothing else changes.
- Values live only in the launcher's memory between the read and the pipe
  write. They are never logged, never written to disk, never put in an env
  var, and never passed through a macro or `browser_run_code_unsafe`.
- Any rt dependency is optional: Fast Browser without rt behaves exactly as
  today.

### 5. Skills

- **`fast-browsing` (Fast Browser):** a login procedure.
  1. A page is a login page when it has a visible password field.
  2. Run `rt logins list --json` and look for the page's origin.
  3. Found: one `browser_fill_form` with both placeholders, submit, then a
     required check that the page left the login origin. Never retried.
  4. Not found, or the check fails, or the page shows 2FA, a captcha or an
     account chooser: stop and return the outcome to the caller
     (`no-saved-login`, `saved-login-failed`, `needs-human`) with the origin.
  The existing "never type a credential" rule narrows to "never type a
  credential yourself; only a saved login's placeholders".
- **A team pack's evidence skill:** maps the outcomes to its login gate.
  - `no-saved-login`: **Save a login for this site** / **Log in by hand** /
    **Leave uncaptured**. Save runs `rt logins add <origin> --in-app`, then
    waits with `rt events wait` for `fast-browser.logins-loaded` naming the
    origin (60 s cap), then retries once.
  - `saved-login-failed`: **Update login** (same flow) / **Log in by hand** /
    **Leave uncaptured**.
  - The pack change carries no rt ticket ids.
- mattstack's `stage-evidence` does not change.

### 6. App (mattstack.app)

- **Settings → Dev logins pane**, next to the Fast Browser pane: one row per
  login (origin, email, `••••••`), with Add, Replace and Delete. No reveal
  control exists anywhere. An empty state explains what a dev login is and
  that the password should be used only for the dev tenant.
- **Add / Replace sheet:** origin, email, password (`SecureField`), styled
  like the setup `ConnectSheet`. Submit runs `rt logins add <origin> --json`
  with `{email, password}` on stdin; Delete confirms, then runs
  `rt logins remove <origin> --json`.
- **Link route** `mattstack://dev-logins/add?origin=<origin>`: parsed in
  `Sources-core/Launch/` like `JoinLink`, buffered for launch-by-link like
  `pendingJoinCode`. It opens Settings on the Dev logins pane with the add
  sheet showing the origin in large text. Any parameter other than `origin`
  is ignored; an origin that fails the origin rules shows an error instead of
  the sheet.

## Rollout

Four repos, landed in this order. Each works on its own; with no saved
logins, everything behaves as it does today.

1. The Playwright fork: `--secrets-fd`, site lock, no literal fallback.
   Runtime release; bump Fast Browser's `runtime-lock.json`.
2. Fast Browser: launcher fetch, pipe and subscription; `fast-browsing`
   login procedure.
3. rt: `dev-logins` domain, `rt logins`, the `fast-browser` scope, the event,
   the Settings pane, the link route. `rt logins list` in the agent-safe set
   means regenerating the mattstack plugin's MCP tools reference.
4. The team pack's evidence skill.

## Testing

Security tests, each of which must fail when its protection is removed:

- A saved login refuses to fill on a different origin, including
  `https://login.example.com.evil.test`, `http://login.example.com`, a
  different port, and a cross-origin iframe inside the right top-level page.
- A password entry refuses a non-password input on the right origin.
- An unresolved placeholder fails the call and types nothing.
- No value appears in tool output, runtime or daemon logs, bus events,
  `rt logins list --json`, or the launcher's stderr (seeded canary value,
  grep every sink).
- `secrets:read` with a wrong token or an unknown scope returns nothing; the
  `fast-browser` scope returns only `dev-logins`.
- The CLI refuses a value passed as an argument and an origin that fails the
  origin rules.
- The link route ignores extra parameters and never pre-fills a password.

Behavior tests:

- A change event reaches a running launcher and replaces the runtime's set
  without a restart.
- Fast Browser with no rt starts with an empty set and behaves as today.

End to end, on the real machine:

- Log the browser out of the dev tenant, run an evidence capture, and see it
  log in and capture. Repeat with a wrong saved password and see one attempt,
  then the gate.
- Screenshot the Dev logins pane, the add sheet and the empty state in light
  and dark.

rt is a public repository: fixtures use neutral origins
(`login.example.com`), and `scripts/repo-purity.sh` runs before every push.

## Out of scope

- Recorded flows (`flow-runner`) filling secrets: FB-13. A login here uses a
  direct `browser_fill_form`, never a flow.
- 2FA, captchas and account choosers: always the human.
- Sharing logins with teammates.
