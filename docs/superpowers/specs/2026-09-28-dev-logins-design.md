# Dev logins: saved dev-server credentials a browser run can use

Ticket: RT-329. Related: FB-13 (flow input steps and secrets).

## Problem

A pipeline stage that captures browser evidence against a dev server stops at
the app's login page whenever the browser's session with the identity provider
has expired. The skills forbid typing a credential, so the run asks at a gate
and waits for the human to log in by hand. An unattended run becomes an
attended one.

The login page in practice is a hosted identity-provider page (an Auth0
universal login on its own host, for example `https://login.example.com`).
The human's normal Chrome session usually carries the login, so this page
appears only after that session lapses.

## Goal

When a saved login exists for the page's origin, the run fills it and carries
on with no human step. When none exists, the run asks as it does today, and
the gate offers to save one. No value reaches the model, a transcript, a
report, MR text or a log by accident. What deliberate extraction is and is
not stopped is spelled out in the threat model.

## Decisions

These were settled in the design conversation.

1. **The credential is the human's own dev login**, not a separate test user.
   It must be a password used only for that dev tenant; the UI says so.
2. **One login per site, not per repo.** A login is keyed by the login page's
   origin. Every repo and worktree that redirects to that page shares it. This
   replaces the ticket's "scoped per repo".
3. **Storage is rt's sops store**, user scope only, never a team store.
4. **Delivery is Fast Browser asking the rt daemon**, never a file on disk.
5. **The site lock and the attempt limit live below the skills**: the lock in
   the browser runtime, the limit in the daemon. A skill rule can be talked
   around; these cannot.
6. **A value is fetched at the moment of the fill**, one login at a time.
   Nothing is loaded at startup, so a newly saved login works on the next
   attempt with no restart. (A spike showed `/reload-plugins` does not restart
   plugin MCP servers, and `/mcp`'s reconnect is an interactive menu an agent
   cannot drive.)
7. **Three entry points:** a Dev logins pane in the app's Settings window
   (reachable any time after install), `rt logins` in the terminal, and a
   "Save a login" button on the gate that opens the app's add sheet.

## Threat model

Defended:

- **Accidental exposure to the model.** Values never appear in tool output,
  gate answers, command arguments, `rt logins list`, logs or events. The
  runtime's redaction covers the encoded forms a value takes on the wire
  (section 3), because the login POST body is form-encoded and a password
  with `@`, `&`, `+`, `%` or a space would otherwise pass exact-string
  redaction.
- **A page stealing a value.** A lookalike page, a redirect target, or a
  hostile or opaque-origin frame inside the real page gets nothing: the
  runtime fills only the resolved element whose own frame origin exactly
  matches the login's origin.
- **A page reading the filled value back to the model.** While the active
  page is on a saved login's origin, the runtime refuses the tools that can
  read page state or request bodies (section 3).
- **Account lockout.** The daemon grants at most one password fill per login
  per 5 minutes and 5 per day, across every session on the machine. A
  replaced login resets its counters.
- **A login saved for the wrong site.** The add sheet makes the human type
  the host of a first-time origin before Save enables (section 6). Neither a
  crafted `mattstack://` link nor a run steered to a lookalike page can
  pre-approve an origin.

Not defended, stated so nobody assumes otherwise:

- **The agent, or a page steering it, deliberately extracting a value by
  code.** `browser_run_code_unsafe` runs inside the runtime's own Node
  process, and a `vm` context is not a security boundary. Code that escapes
  it could read a value the runtime holds. The design narrows the window (a
  value exists in the runtime only from the fill to the end of that tool
  call plus the redaction set), but it does not close it.
- **A hostile process running as the same macOS user.** It can read the API
  token file and call the daemon, the same boundary every rt secret has
  today (the board scope already serves forge tokens this way). The daemon
  cannot verify who is on the other end of its socket (its Bun server
  exposes no peer credentials), so it logs every value it serves with the
  caller-declared client and pid, labelled unverified. That makes reads
  visible; it does not prove who made them.
- **Plaintext on disk during a write.** rt's secret writes stage plaintext
  under `~/.mattstack/rt/tmp/` for the length of one sops encrypt and unlink
  it afterwards (`lib/secrets/store.ts`). The encrypted file then travels
  with the home repo and state backups, like every other user secret.

## Design

### 1. Storage (rt)

- A new secrets domain `dev-logins` in the user store
  (`~/.mattstack/user/secrets/dev-logins.json`, sops + age).
- One key per login. The value is JSON: `{"origin", "email", "password"}`.
- The key is derived from the origin: the host, then `_<port>` when the port
  is not the scheme default, then `_http` when the scheme is `http`.
  `https://login.example.com` is `login.example.com`;
  `http://localhost:3000` is `localhost_3000_http`. Hosts containing `_` are
  refused, so keys cannot collide.
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
| `rt logins list [--json]` | Origins, emails and placeholder names; never passwords | yes |
| `rt logins open-add <origin>` | Opens `mattstack://dev-logins/add?origin=<origin>`; collects nothing | yes |
| `rt logins add <origin>` | Hidden-input prompts for email and password; `--json` reads `{email, password}` from stdin (the app's path) | no |
| `rt logins remove <origin>` | Deletes one login | no |

- `open-add` is its own leaf because `agentSafe` is per leaf
  (`lib/command-tree.ts`); `add` and `remove` are never reachable through
  `rt_verb`.
- `add` refuses an origin that fails the origin rules and never accepts a
  value as an argument. `omitBehavior`: `add` and `open-add` are `prompt`,
  `remove` is `picker` over saved logins, gated on
  `isTTY && !json && !RT_BATCH`.
- `list --json` shape: `[{origin, email, fields: {email: "<name>",
  password: "<name>"}}]`. The names are the reserved placeholder names
  (section 3): `devlogin:<key>:email` and `devlogin:<key>:password`.
- New socket-only daemon verb `logins:fill` for the Fast Browser launcher.
  Payload `{token, client, pid, name}` where `name` is one placeholder name.
  It requires the API token, resolves the login, and for a `password` name
  applies the attempt limit before answering. It answers
  `{origin, kind, value}` or a refusal (`unknown`, `limited` with the time the
  limit lifts). Every answer and refusal is logged at `info` with the name,
  origin and caller-declared `{client, pid}` (unverified), never the value.
- The attempt limit is kept in the daemon's memory, keyed by login, and reset
  when `add` replaces that login. A daemon restart resets it too; that is
  acceptable because a restart is rare and itself visible.
- No `secrets:read` scope is added, and no bus event carries login data.

### 3. Browser runtime (the Playwright fork)

Changes shipped in one runtime release:

- **Reserved names.** A fill value that starts with `devlogin:` is a saved
  login placeholder. It is never typed literally: it resolves through the
  launcher channel below or the call fails. Bare-name secrets from the
  existing `--secrets` file keep today's behavior (the cloud contract is
  unchanged); a `--secrets` file that defines a `devlogin:` name is refused
  at load.
- **Launcher channel.** `--secrets-channel-fd=<n>` names a duplex socket to
  the launcher. For a `devlogin:` value the runtime sends
  `{"name": "<placeholder>"}` and waits up to 10 s for
  `{origin, kind, value}` or a refusal. Values are requested per fill and
  never cached across fills.
- **Site lock.** The runtime resolves the target to one element handle, reads
  that element's frame origin from the browser's frame URL (never from page
  JavaScript), and fills that same handle with `elementHandle.fill`. It
  refuses when:
  - the frame origin is not exactly the login's origin (scheme, host, port);
  - the frame origin is opaque (`about:blank`, `srcdoc`, `data:`, sandboxed);
  - `kind` is `password` and the element is not `<input type="password">`;
  - the call is `browser_type` with `slowly: true` (keystrokes go to whatever
    has focus, which a frame can steal mid-sequence).
  A refusal types nothing and names the placeholder and the reason.
- **Readback refusal.** While the active tab's top-level origin is a saved
  login's origin, the runtime refuses `browser_evaluate`,
  `browser_run_code_unsafe`, `browser_network_request` and
  `browser_network_requests`. The login page is only a stop on the way back
  to the app; nothing on it needs those tools.
- **Redaction of encoded forms.** Once a value has been filled it joins the
  redaction set for the rest of the runtime's life. Redaction replaces the
  raw value and its URL-encoded, form-encoded (`+` for space),
  JSON-escaped and HTML-escaped forms in every tool output and every file the
  runtime writes (traces, sessions, network captures).
- **Logging.** `filled saved login for <origin>` on success, the refusal
  reason on failure, never a value.

### 4. Fast Browser launcher and flows

- The launcher spawns the runtime with an extra duplex stdio slot and passes
  `--secrets-channel-fd=3`. On each request it calls the daemon's
  `logins:fill` over the unix socket with a small Node client
  (`http.request({socketPath})`, token from `~/.mattstack/rt/api-token`),
  and relays the answer. It holds a value only for the length of that relay.
- With no rt, no token, or the daemon down, it answers every request with a
  refusal; nothing else changes. Fast Browser without rt behaves exactly as
  today.
- Values are never logged, written to disk, put in an env var, or passed
  through a macro or `browser_run_code_unsafe`.
- **Flow compile.** A traced step whose value is a `devlogin:` placeholder is
  never compiled into a flow. A trace containing one compiles with that
  segment dropped and a note in the flow's review metadata, so replays can
  never repeat a login attempt.

### 5. Skills

- **`fast-browsing` (Fast Browser):** a login procedure.
  1. A page is a login page when it has a visible password field, or a
     visible email field on an origin `rt logins list` knows (the
     identifier-first case: email on one screen, password on the next).
  2. Run `rt logins list --json` and look for the page's origin.
  3. Found: fill the fields the page shows with their placeholders in one
     `browser_fill_form` and submit. On an identifier-first page, repeat once
     for the password screen on the same origin. Then a required check that
     the page left the login origin. Never retried.
  4. Stop and return an outcome to the caller with the origin when:
     no saved login (`no-saved-login`), the check fails or the runtime says
     `limited` (`saved-login-failed`), or the page shows 2FA, a captcha or an
     account chooser (`needs-human`).
  The existing "never type a credential" rule narrows to "never type a
  credential yourself; only a saved login's `devlogin:` placeholders".
- **A team pack's evidence skill:** maps the outcomes to its login gate. The
  gate question always prints the full origin.
  - `no-saved-login`: **Save a login for this site** / **Log in by hand** /
    **Leave uncaptured**. Save runs `rt logins open-add <origin>`, then retries
    the fill every 5 s for up to 2 minutes. An unsaved login fails fast with
    `unknown` and costs no attempt, so polling is safe and each run checks its
    own runtime.
  - `saved-login-failed`: **Update login** (same flow) / **Log in by hand** /
    **Leave uncaptured**.
  - The pack change carries no rt ticket ids.
- mattstack's `stage-evidence` does not change.

### 6. App (mattstack.app)

- **Settings → Dev logins pane**, next to the Fast Browser pane: one row per
  login (origin, email, `••••••`), with Add, Replace and Delete. No reveal
  control exists anywhere. The empty state explains what a dev login is and
  that the password should be used only for the dev tenant.
- **Add / Replace sheet:** origin, email, password (`SecureField`), styled
  like the setup `ConnectSheet`. Submit runs `rt logins add <origin> --json`
  with `{email, password}` on stdin, through the same redacted stdin path the
  checklist already uses. Delete confirms, then runs
  `rt logins remove <origin> --json`.
- **First-time origin confirmation.** When the origin has no saved login, the
  sheet shows it in large text, and Save stays disabled until the human types
  the host into a confirmation field. The sheet adds a warning line for a
  punycode (`xn--`) host and for `http`. Replacing an existing login skips
  the typed confirmation.
- **Link route** `mattstack://dev-logins/add?origin=<origin>`: parsed in
  `Sources-core/Launch/` like `JoinLink`, buffered for launch-by-link like
  `pendingJoinCode`. It opens Settings on the Dev logins pane with the add
  sheet. Any parameter other than `origin` is ignored; an origin that fails
  the origin rules shows an error instead of the sheet.

## Rollout

Four repos, landed in this order. Each works on its own; with no saved
logins, everything behaves as it does today.

1. The Playwright fork: reserved names, launcher channel, site lock, readback
   refusal, encoded redaction. Runtime release. The bare-name `--secrets`
   contract is unchanged, so this ships without touching the cloud path.
2. Fast Browser: bump `runtime-lock.json`, launcher channel and daemon client,
   flow-compile exclusion, `fast-browsing` login procedure.
3. rt: `dev-logins` domain, `rt logins`, `logins:fill` with the attempt limit,
   the Settings pane, the link route. The two agent-safe leaves mean
   regenerating the mattstack plugin's MCP tools reference.
4. The team pack's evidence skill.

## Testing

Security tests, each of which must fail when its protection is removed:

- Site lock refuses: `https://login.example.com.evil.test`,
  `http://login.example.com`, another port, a cross-origin iframe inside the
  right top-level page, `about:blank`, `srcdoc` and sandboxed frames, a
  non-password input for a password entry, and `browser_type` with `slowly`.
- A `devlogin:` value that does not resolve fails the call and types nothing.
- Readback tools are refused while the tab is on a saved login's origin.
- Canary value, seeded with `@`, `&`, `+`, `%` and a space, then a login run:
  the value appears in no raw or encoded form in tool output,
  `~/.fast-browser/output` (traces, sessions, network captures), runtime,
  launcher, daemon, CLI or tray logs, bus events, or `rt logins list --json`.
- `logins:fill` refuses a wrong token; grants one password fill per login per
  5 minutes across two simulated clients; resets on replace.
- A trace containing a `devlogin:` step compiles with the step dropped.
- The CLI refuses a value passed as an argument, an origin that fails the
  origin rules, and a host containing `_`.
- The link route ignores extra parameters and never pre-fills a password; a
  first-time origin keeps Save disabled until the host is typed.

Behavior tests:

- A login saved while a run is waiting is used on its next attempt with no
  restart.
- Fast Browser with no rt behaves as today.

End to end, on the real machine:

- Log the browser out of the dev tenant, run an evidence capture, and see it
  log in and capture. Repeat with a wrong saved password and see one attempt,
  then the gate; a second run within 5 minutes gets `limited`.
- Screenshot the Dev logins pane, the add sheet (first-time and replace) and
  the empty state in light and dark.

rt is a public repository: fixtures use neutral origins
(`login.example.com`), and `scripts/repo-purity.sh` runs before every push.

## Out of scope

- Recorded flows filling secrets: FB-13. Flows never carry a `devlogin:`
  step (section 4).
- 2FA, captchas and account choosers: always the human.
- Sharing logins with teammates.
