# Solo install: a forge row for GitHub and for GitLab (RT-349)

## Intent

A Just me install drops the team, not the forge. Today the solo checklist and
the Connect your accounts screen offer only a GitHub row, so a GitLab-only solo
dev has nowhere to connect a token. Settings > Accounts draws the same plan
rows, so it has the same gap. The fix gives solo both forges, each optional.

## Goals

- A GitLab-only solo dev connects a token from the setup window's Connect
  your accounts screen and from Settings > Accounts, without re-running setup.
- Connecting either forge on a solo install never touches the app toggles
  (deck's per-app `enabled`) or any team state. A test pins this.

## Non-goals

- No forge picker, no new setting, no new verb.
- No self-hosted GitLab host field in the Connect sheet.
- No change to the create, join or restore plans or screens. Their
  `rt setup plan --json` output stays byte-identical.
- No Swift change on the setup window (`rt-tray/Sources/Setup/`): it draws
  rt's rows and keys on no forge row id.

## Rulings this design rests on

- **Two rows, not a picker** (shepherd, gate b3b72eba). Solo shows an optional
  GitHub row and an optional GitLab row. A dev connects either or both.
- **Self-hosted GitLab goes through the terminal** (shepherd, gate fd5e6fe5).
  The GitLab row checks a token against gitlab.com, or against a host this
  Mac already confirmed. A dev on their own GitLab server runs
  `rt setup gitlab connect --host <host>` once, and the row's note says so.
- **One forge per team, read for solo.** The rule binds a team. A solo install
  has no team, so nothing picks a forge for it: both rows show, and connecting
  one does not hide or disable the other. Once the dev creates or joins a team,
  the team's forge decides the forge row, as today (`declaredIntegrations`
  lists only the team's forge). A token stored for the other forge stays
  stored and stops showing. That is existing behavior, unchanged here.
- Forge-aware copy: PR on GitHub, MR on GitLab. Tokens are never logged or
  shown. Rows follow `.claude/rules/setup.md`.

## Approaches considered

1. **Two optional rows (picked).** Both forges always listed on solo. Settings >
   Accounts picks them up from the plan's accounts group with no Swift change.
   Costs one extra row on the screen for a dev who uses one forge.
2. **Forge picker.** One "Code host" row with a GitHub/GitLab choice, then that
   forge's token row. Needs a stored choice (a new settings key), a choose
   verb, and new setup-window Swift. More moving parts for one saved row.
3. **Two rows, hide the other once one connects.** Saves a row after connect,
   but a dev with both forges loses the second, and the plan grows state it
   does not need.

## How the code works today (checked against main at `2e68600d0`)

The ticket's file notes are still accurate, with shifted lines:

- `lib/setup/validators/accounts.ts`, `accountRows` (about line 514): on solo
  with no team forge and no pack requirements, `declared` is one entry,
  `github`, optional, with `SOLO_FORGE_NOTE` (line 485): "Works without this.
  Connect a GitHub or GitLab account later to open PRs and MRs from rt."
- `lib/setup/form.ts`, `drawnForge` (line 478, "Just me always draws GitHub"):
  returns GitHub on solo. `formOwnedIds` (line 486) owns `account.github` on
  solo. `forgeRow` (line 556) draws one `forge` row, subtext
  `FORM_COPY.connect.soloForge`, `optional: true`.
- `rt-tray/Sources/Settings/SettingsView.swift:15` routes `.accounts` to
  `AccountsPane`, which draws `ChecklistScreen` with `presentation: .accounts`.
  `ReadinessModel.groups(for: .accounts)` keeps the plan's `accounts` group.
  So a new row in that group reaches Settings with no Swift change.
- `rt setup gitlab connect` (`connectCredential` in `commands/setup.ts`) on a
  solo Mac: the team snapshot is empty and no org clone exists, so `slug` is
  empty and `recordForgeIdentity` never runs. It writes the token to rt's
  secret store (or stages it before the key exists) and, only with `--host`,
  the user-scope `rt.integrations` setting. It calls no deck verb.

## Design

### 1. Plan rows (`lib/setup/validators/accounts.ts`)

On solo with no team forge and no pack requirements, `declared` becomes two
optional entries in this order: `github`, then `gitlab`. Each carries its own
note in place of the shared `SOLO_FORGE_NOTE`. Draft copy (final wording
through `rt:ui-copy`):

- GitHub: "Works without this. Connect GitHub to open PRs from rt."
- GitLab: "Works without this. Connect GitLab to open MRs from rt. On your own
  GitLab server, run rt setup gitlab connect --host <host> first."

The GitLab row is the existing `genericRow` path: Connect with a token field;
Create token links to gitlab.com, or to the confirmed host when there is one.
Nothing about how a row validates changes.

### 2. Connect your accounts screen (`lib/setup/form.ts`)

On the solo path the connect section draws two forge rows, GitHub then GitLab:

- GitHub keeps id `forge` and its behavior. Its subtext becomes "Optional.
  Lets mattstack open PRs".
- GitLab gets id `forge.gitlab`, forge `{ provider: "gitlab", host: confirmed
  host ?? "gitlab.com" }`, subtext "Optional. Lets mattstack open MRs",
  `optional: true`. Until it is connected, its detail is the self-hosted hint
  ("On your own GitLab server? Run rt setup gitlab connect --host <host>
  first"), so a self-hosted dev sees it at setup and not only in Settings.
  (My call: the form draws no `optionalNote`, and this is the only place a
  dev on this screen would learn the command.)
- `formOwnedIds` on solo owns both `account.github` and `account.gitlab`.
- Neither row holds Continue.

`drawnForge` stays the single source for create and join. Solo gets its own
small helper that returns the two forges, so the create and join rows do not
change.

### 3. Settings > Accounts (`rt-tray/Sources/Settings/`)

No view code changes. Two additions:

- A check in `Tests/MattstackCoreChecks/AccountsPaneChecks.swift`: a solo plan
  (`mode: none`, empty slug) with both forge rows shows both in
  `groups(for: .accounts)`, and the GitLab row's Connect dispatches
  `["setup", "gitlab", "connect", "--json"]` with the token on stdin.
- A rendered look: `SettingsExtrasSnapshot` (already wired in `main.swift`)
  also renders the solo accounts group, light and dark, built into a scratch
  directory, so the pane is looked at, not only asserted.

### 4. The no-side-effect pin (acceptance 2)

A test in `commands/__tests__/setup-connect.test.ts` drives
`integrationConnect` on a solo Mac (empty team snapshot, no org clone) for
GitLab and for GitHub with a token the fake forge accepts. It asserts:

- no file write under the orgs folder, the team-local store, deck's state, the
  setup intent or `setup-state.json`;
- no exec of `deck` or `git`;
- no settings write without `--host`, and with `--host` exactly one:
  `rt.integrations` at user scope;
- the stored secret is the only credential write, and the token never
  appears in stdout or stderr.

### 5. Docs (`sites/docs/docs/start/setup.mdx`)

The Just me bullet and "Connecting a forge account" name both forges, the
connect screen's two rows, Settings > Accounts as the later place to connect,
and the `--host` command for a self-hosted GitLab.

## Verification

- Targeted `bun test` from the worktree root for each touched test file;
  `commands/__tests__/setup-copy.test.ts` snapshot updates only for the solo
  plan, reviewed by eye.
- Create, join and restore plan snapshots unchanged.
- The e2e or pty file that covers the checklist text, if one draws the solo
  accounts group.
- Swift checks and the snapshot render built into a scratch directory, never
  a blessed bundle.
- `bun run typecheck`, `bun run purity`.

## Left to the builder

- Exact copy, through `rt:ui-copy`.
- Test file placement inside the existing suites.
- Whether the solo GitLab form row reuses `forgeAccountRow` directly or wraps it.

## Follow-up outside this lane's fence

- `rt-tray/Tests/stub-rt/stub.ts`'s Just me scenario still answers one forge
  row, so Test drive setup shows only GitHub until the stub learns the second.
