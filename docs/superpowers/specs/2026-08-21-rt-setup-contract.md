# rt ↔ mattstack.app setup contract (v1)

The JSON the app renders and the verbs it drives. Companion to
`2026-08-20-mattstack-app-installer-design.md` §5.2–5.3. L1 (rt) implements
it; L3 (app) renders it; the XCUITest stub emits it. Changes bump `contract`.

## Invocation

The app spawns the bundled `rt` by absolute path with `--json` and reads
stdout. Streaming verbs emit NDJSON (one JSON object per line). Exit codes:
`0` ok · `2` user-actionable failure (stdout carries `{ "error": {...} }`) ·
`1` bug. The app passes `RT_APP_SOCKET=<tray.sock>` so rt can call back for
permission status; rt passes nothing back on argv that is secret (codes and
tokens travel on stdin).

Common envelope on every JSON result: `{ "contract": 1, "at": "<ISO-8601>", ... }`.

## `rt setup plan --json` → Plan

```jsonc
{
  "contract": 1,
  "at": "2026-08-21T04:00:00Z",
  "team": { "slug": "acme", "name": "Acme", "mode": "join" | "create" | "restore" | "none" },
  "groups": [
    { "id": "mac" | "accounts" | "access" | "tools",
      "title": "Your Mac",
      "rows": [ Row, ... ] }
  ],
  "canInstall": false,
  "requiredMissing": ["perm.fda", "account.gitlab"]
}
```

Row:

```jsonc
{
  "id": "perm.fda",                       // stable, dotted; namespaces: perm.*, tool.*, account.*, access.*, pack.*
  "kind": "permission" | "tool" | "account" | "access" | "info",
  "title": "Full Disk Access",
  "why": "Reads your repositories' git state so the daemon can show branch and MR status.",
  "required": true,
  "optionalNote": null | "Works without this; you'll see menu-bar badges instead.",
  "status": "ready" | "missing" | "invalid" | "needs-you" | "checking" | "skipped" | "error",
  "detail": "Not granted" | "git 2.50.1" | "token can't see group acme",
  "action": null | Action,
  "recheck": "on-activate" | "on-change" | "manual"   // how the app refreshes this row
}
```

Action (exactly one shape, discriminated by `type`):

```jsonc
{ "type": "open-settings", "label": "Open Full Disk Access Settings…", "target": "fda" | "login-items" | "notifications" | "keyboard" }
{ "type": "request-permission", "label": "Allow", "which": "notifications" }
{ "type": "connect", "label": "Connect", "integration": "gitlab" | "github" | "linear" | "slack" | "switchboard" | "sdm" | "doppler" | "ldcli",
  "fields": [ { "name": "token", "label": "Personal access token", "secret": true, "hint": "scopes: read_api, read_user" } ],
  "alternatives": [ { "id": "use-gh", "label": "Use gh login" } ] }
{ "type": "oauth", "label": "Connect", "integration": "slack", "verb": ["setup","slack","connect"] }   // rt opens the browser and completes the flow
{ "type": "owner-once", "label": "Create the team's Slack app…", "integration": "slack", "fields": [ { "name": "configToken", "label": "App configuration token", "secret": true } ] }
{ "type": "install", "label": "Install", "tool": "herdr", "via": "brew" | "vendor" | "apple-clt" | "bundled-link" }
{ "type": "link-bundled", "label": "Use mattstack's", "tool": "gh" }
{ "type": "steps", "label": "Show steps…", "steps": ["Open chrome://extensions", "Turn on Developer mode", "Load unpacked → ~/.fast-browser/extension/current/unpacked"] }
{ "type": "open-url", "label": "Download", "url": "https://claude.ai/download" }
{ "type": "run", "label": "Re-check", "verb": ["setup","status"] }
```

The app maps actions to behaviour: `open-settings`/`request-permission` are
handled natively (PermissionsService); every other action spawns the named rt
verb (`connect` → `rt setup <integration> connect` with fields on stdin as
JSON; `install` → `rt tools install <tool>`; `link-bundled` → `rt deps link
<tool>`; `run` → the given verb) and then re-requests the plan.

## `rt setup status --json` → Plan

Same shape; `team.mode` reflects the installed state; used post-install and by
`rt verify`.

## `rt setup <integration> connect --json` (stdin: `{"token": "..."}` or `{"useGh": true}`)

→ `{ "contract":1, "integration":"gitlab", "status":"ready"|"invalid", "detail":"...", "scopesSeen":["read_api"] }`

## `rt setup <integration> status --json`

Same envelope as `connect`. For `github`, when gh is authenticated the
envelope also carries `"handle": "<gh login>"` and `"owners": ["<handle>",
"<org>", ...]` (the handle plus `gh api user/orgs[].login`) — the app's
team-create card offers them as `--create-repo` owners.

## `rt setup <integration> create-app --json` (owner-once; stdin: `{"configToken": "..."}`)

The app sends the token as JSON on stdin (no `--config-token-stdin` flag).

## `rt setup apply [--from <stepId>] --json` → NDJSON stream

```jsonc
{ "event": "plan",  "steps": [ { "id": "home.init", "title": "Create your settings home repo", "kind": "rt" | "app" | "privileged" } , ... ] }
{ "event": "step",  "id": "home.init", "state": "running" }
{ "event": "log",   "id": "home.init", "line": "gh repo create m4ttheweric/mattstack-home --private" }
{ "event": "step",  "id": "home.init", "state": "done", "detail": "pushed main" }
{ "event": "need",  "id": "services.register", "request": { "type": "app-register-services", "plists": ["com.mattstack.daemon.plist","com.mattstack.deck.plist"] } }   // rt asks the app to do a native thing; app replies via tray.sock and rt continues
{ "event": "need",  "id": "proxy.install", "request": { "type": "app-privileged", "op": "proxy-install" } }
{ "event": "step",  "id": "repos.clone", "state": "partial", "detail": "cloned 0, present 1, failed 1 (big-repo)", "remedy": "..." }   // finished, but some of its work did not land; the run goes on
{ "event": "step",  "id": "pack.install", "state": "failed", "detail": "claude plugin install exited 1", "remedy": "Open Claude Code once so it finishes first-run, then Retry." }
{ "event": "done",  "ok": false, "failedStep": "pack.install" }
```

A step's `state` is `running`, `done`, `partial`, `skipped`, `needs-you` or
`failed`. Only `failed` stops the run. `needs-you` means the step did its part
and left something only the member can do (verify's `"to connect: Slack, team
Doppler"`). `partial` means the step finished but some of its work did not
land: its `detail` names what, its `remedy` says how to retry, and the app
shows it with a warning badge and a Retry that resumes with `--from` that
step, so every later step sees what the retry lands.

`kind: "app"` and `"privileged"` steps are executed by the app when the `need`
event arrives (ServicesRegistrar / PrivilegedInstaller). The app records the
outcome and serves it at `GET /setup/need/<id>` on tray.sock as
`{ "state": "pending" | "done" | "failed", "detail": "..." }`. That route
always answers 200 with that body — an unknown or not-yet-started id is
`pending`, never 404 (rt tolerates a 404 as `pending` anyway); `POST` → 405,
empty id → 400. rt polls (1 s) until `done`/`failed`, with a 10-minute
timeout; `done` → the step succeeds with `detail`, `failed` → the step fails
with `detail`. Steps are idempotent; `--from` resumes.

`need.request.type` (v1): `app-register-services { plists }` ·
`app-unregister-services { plists }` · `app-privileged { op: "proxy-install" |
"proxy-remove" }`. The app's NeedBroker must handle all three; anything else
is recorded `failed: unknown need type`.

`services.register` plists: `com.mattstack.daemon[.dev].plist` always;
`com.mattstack.deck[.dev].plist` only when `deck` is bundled (rt checks
`Contents/Helpers/deck` and logs "deck not bundled yet — only the daemon is
registered" otherwise). The app reports a plist whose `BundleProgram` is
missing as `ok:false, status:"notFound"`; rt decides.

Invite codes are copy-paste/deep-link only (16-byte id ‖ 32-byte key,
Crockford base32, ~77 chars, chunked for display). Relay base URL defaults to
`https://switchboard.mattstack.dev` (matt-gated DNS; `RT_INVITE_RELAY_URL`
overrides).

Team-scope secrets layout (in the home repo): `teams/<slug>/.sops.yaml` and
`teams/<slug>/mattstack/secrets/<domain>.json`, domains `board` and `rt`
(`secrets.write` writes them; `rt team join` materializes them).

## Step ids (v1, in rt's order)

`home.init` | `home.restore` · `team.create` | `team.join` · `secrets.write` ·
`git.identity` · `path.link` · `settings.seed` · `repos.clone` ·
`services.register` (app) · `proxy.install` (privileged) · `deck.managed` ·
`skills.materialize` · `skills.link` · `board.keys` · `cron.triage` ·
`intercepts.install` · `plugins.install` · `linear.mcp` · `claude.permissions` ·
`fastbrowser.setup` · `herdr.integration` · `extension.install` ·
`services.start` · `snapshot.push` · `verify`

## `rt setup update [--force] --json` → NDJSON stream

The app runs this at every launch after its services settle; by hand it
re-applies setup after an update. Three outcomes, decided by rt:

- `~/.mattstack/rt/daemon.json` absent: `{ "event": "done", "ok": true, "skipped": "not-set-up" }`, exit 0.
- `setup-state.json`'s `lastUpdate.version` equals the running rt version and no `--force`: `{ "event": "done", "ok": true, "skipped": "current" }`, exit 0. A `dev` build never counts as current.
- Another update run holds `~/.mattstack/rt/setup-update.lock` (a live pid, younger than 30 minutes): `{ "event": "done", "ok": true, "skipped": "running" }`, exit 0. A lock left by a dead pid, or older than that, is taken over. A lock file that cannot be created or read does not stop the run: it runs unguarded and logs a `warn:` line.
- Otherwise the same `plan` / `step` / `log` events as apply, over: pending migrations (`id: "migration.<id>"`, recorded in `setup-state.json`'s `migrations` when `done` or `skipped`), then every update-safe step in contract order, then `verify`. A `failed` item never stops the run, and a migration that throws is one more `failed` item (`detail: "bug: <message>"`, not recorded). A step that throws a plain error is a bug: it is reported `failed` with the same detail, the run ends after `done`, and the verb exits 1 without stamping. `done` carries `failedStep` (the first) and `failedSteps` (all). `need` never occurs. Otherwise the version is stamped in `lastUpdate` whatever the outcome; exit 2 when any item is `failed` or `needs-you`, and one `setup_update` notification is posted through the tray (`id: "setup_update:<version>"`).

An update run never re-asserts what the member undid: `plugins.install` leaves a disabled plugin disabled and does not reinstall a plugin or re-add a marketplace that `setup-state.json` records rt adding but that is now absent (one with no record is new and still installs, unless the listing shows its marketplace is not registered), and `extension.install` installs only into detected editors listed in `extensionEditors` (`skipped` when none is).

`--from` and `--only` are refused (`unknown-flag`).

`setup-state.json` gains `migrations: string[]` and `lastUpdate: { version, at }`.

## tray.sock (app → rt callbacks and app-side truth)

`GET /permissions` → `{ "fda": {"status":"granted"|"denied"|"unknown","detail":"..."}, "notifications": {"status":"authorized"|"denied"|"notDetermined"|"provisional"}, "loginItems": {"status":"enabled"|"requiresApproval"|"notRegistered"|"notFound"} }`
`POST /permissions/request` `{ "which": "notifications" }` → `{ ok }`
`GET /services` → `{ "agents": [ { "label": "com.mattstack.daemon", "status": "enabled"|"requiresApproval"|"notRegistered"|"notFound" } ] }`
`POST /services/register` `{ "plists": [...] }` → `{ ok, results }` · `POST /services/restart` `{ "label" }`
`POST /privileged/proxy-install` → `{ ok, detail }` (raises the admin prompt)
`GET /setup/need/<id>` → 200 `{ state, detail }` always (`pending` for unknown ids; app-recorded outcome of a `need` event; rt polls until `done`|`failed`) · `POST` → 405
`POST /update/check` → `{ ok }` · `GET /version` → `{ "version": "2.8.0", "build": 2008000, "flavor": "prod"|"dev", "path": "/Applications/mattstack.app" }` — `build` is the numeric `CFBundleVersion` = `major*1e6 + minor*1e3 + patch` (2.8.0 → 2008000)

## `rt team create <name> (--remote <url> | --create-repo <owner>) [--others] --json`

→ `{ "contract":1, "slug", "name", "remote", "created": true|false }`
(`created:false` when the team zone already exists for that remote).
`--create-repo <owner>` creates `<owner>/mattstack-team-<slug>` with gh and
uses its URL as the remote; `--remote <url>` uses an existing empty repo.
`--others` marks the team as having members beyond the creator. Missing both
→ exit 2 `remote-required`.

## `rt team status [--team <slug>] --json`

→ `{ "contract":1, "slug", "name", "remote", "lastPush": "<ISO-8601>"|null, "members": [ { "username" } ] }`

## `rt setup intent restore <org>/<repo> --json`

Records the restore intent after the app has run the real `rt restore
<org>/<repo> --json` (age key on stdin as `{"ageKey": "..."}`; the settings
lane owns that verb). `rt setup apply`'s `home.restore` step then only
verifies the clone and the Keychain key.

## `rt team join --json` (stdin: `{"code": "..."}`) / `--dry-run`

→ `{ "contract":1, "team": {"slug","name","owner"}, "access": "ok"|"denied"|"unreachable", "peering": "applied"|"idle"|"unavailable", "peeringFix"?: "...", "message": "..." }`
(exit 0 even when `access` is `denied`/`unreachable`; exit 2 for
`invite-unknown`/`invite-malformed`, and for the resumable
`secrets-store-not-ready` (refused before the redeem) and
`peering-store-failed` (after it; rerun `rt team join` with no code).
`peeringFix` is present exactly when `peering` is `unavailable`, and the
`team.join` step then ends `partial` with it as the remedy. Later runs do
not keep the step: the `account.switchboard` row reads the gap at check
time instead. Once the switchboard is reachable, that row is `needs-you`
with the re-invite remedy while any cloned team this machine joined by
invite (`joinedByRt` in `~/.mattstack/rt/teams/<slug>.json`) declares an
https switchboard in its own settings store and neither source the board
reads holds a token (its own `.env` `SWITCHBOARD_TOKEN`, or rt's
`switchboardToken`, asked through the plan's secret presence check). A
secrets store that cannot answer makes the row `error` with "could not read
your secrets store", never read as absent. Because the row is required and
`verify` runs it, a joined machine with no token, including one that joined
before the check existed, ends `rt setup update` needing the member. A
secrets store that keeps failing blocks the join outright, with no bypass,
by design: finishing without the token would lose it.

## `rt team invite --handle <h> [--require-peering] --json`

→ `{ "contract":1, "code": "...", "expiresAt": "...", "pasteBlock": "Install mattstack from … then open mattstack://join/… or paste …", "forgeAccess": "granted"|"manual"|"skipped", "manualSteps": [...], "peering": "embedded"|"missing"|"none", "peeringWarning"?: "..." }`

`peering` is `none` when the team declares no switchboard, and `missing`
when it does but no board token could be sealed into the invite;
`peeringWarning` (the same sentence warned on stderr) is present exactly
then. `--require-peering` refuses a `missing` invite before anything is
minted (exit 2 `peering-not-embedded`).

## `rt uninstall --json [--keep-data|--delete-data] [--yes] [--dry-run]`

→ dry-run: `{ "contract":1, "actions": [ { "id":"deck.managed-remove", "title":"Remove mattstack's apps from deck" }, { "id":"services.unregister", "title":"Stop and remove the rt daemon and deck services" }, ... ] }`; real run: NDJSON like `apply`.

Action ids (v1, in order): `deck.managed-remove` · `services.unregister` ·
`proxy.remove` · `path.unlink` · `shell.remove` · `extension.uninstall` ·
`plugins.uninstall` · `data` (only with `--delete-data`) · `app.trash`.
`deck.managed-remove` comes first because `services.unregister` stops deck.
It skips, and lists deck's apps in `stayed`, while the other flavor's app is
installed: both flavors' decks share one registry.
`--delete-data` requires `--yes` (non-TTY without it → exit 2
`confirm-required`; the app's confirmation sheet is the consent, so the app
always passes `--yes`). `--keep-data` needs no `--yes`.

## Stub

`RT_STUB_SCENARIO=<name>` (DEBUG builds only) makes the app spawn
`rt-tray/Tests/stub-rt/stub.ts` instead of the bundled rt. Companion env:
`RT_STUB_PATH` (required; absolute path to `stub.ts`), `RT_STUB_BUN`
(optional; default `~/.bun/bin/bun`), `RT_STUB_STATE_DIR` (optional; where
scenario state such as "granted after first check" persists). Scenarios ship
canned responses for every verb above: `create-happy`, `join-happy`,
`join-no-access`, `perm-denied-then-granted`, `apply-fail-retry`, `restore`,
`uninstall`.
