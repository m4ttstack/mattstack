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
- **A github.com confirmed host never counts for GitLab** (shepherd, gate
  f2356cb1). On every Mac, solo or team, every reader of a GitLab host drops a
  `github.com` forgeHost through one helper, the daemon's accounts sweep
  included.
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
  GitLab server, run rt setup gitlab connect --host <host> in a terminal."

The GitLab row is the existing `genericRow` path: Connect with a token field;
Create token links to gitlab.com, or to the confirmed host when there is one.
The validation code itself does not change; only which host it is handed
does (below).

**The confirmed host on solo.** `rt.integrations.forgeHost` is one user-scope
value shared by both forges, and `connectCredential` writes `github.com` there
for a team whose declared forge is github.com. A Mac that left such a team and
is now solo would point its GitLab row at github.com, and its Connect would
check the token there. A Mac still in that team has the same value, and the
daemon's accounts sweep checks a stored GitLab token against it every 6 hours.
So on every Mac, solo or team, a confirmed host of `github.com` reads as no
confirmed host (gitlab.com) for GitLab, in all four places that read it:

- the plan row (`ctxFor` in `lib/setup/validators/accounts.ts`);
- the connect screen's solo GitLab row (section 2);
- the connect verb (`ctxFor` in `commands/setup.ts`, used by
  `connectCredential` when no `--host` is passed);
- the daemon's accounts sweep (`credentialHealthCtxFor` in `lib/daemon.ts`).

One shared helper, `confirmedGitlabHost` in `lib/setup/gitlab-host.ts`,
returns the GitLab host to use: the forgeHost, lowercased, only when it is a
valid hostname and not `github.com`, otherwise null (gitlab.com). Every GitLab
ctx reads its host through it, so the four cannot drift. It needs no solo
flag. The GitHub ctx and the GitHub rows keep today's reading. A connect
`--host` still writes the host as given.

This changes a team Mac too: a Mac in any team that holds a leftover
`forgeHost: "github.com"` now checks a GitLab token against gitlab.com, not
github.com. Before, that token went to github.com, which could only fail.

### 2. Connect your accounts screen (`lib/setup/form.ts`)

On the solo path the connect section draws two forge rows, GitHub then GitLab:

- GitHub keeps id `forge` and its behavior. Its subtext becomes "Optional.
  Lets mattstack open PRs".
- GitLab gets id `forge.gitlab`, forge `{ provider: "gitlab", host:
  confirmedGitlabHost ?? "gitlab.com" }`, its connected text a plain
  "Connected" (the forge login on the inputs is the team forge's), subtext "Optional. Lets mattstack open MRs",
  `optional: true`. While no GitLab token is stored (the plan row's status is
  `missing`), its detail is the self-hosted hint ("On your own GitLab server?
  Connect from a terminal with rt setup gitlab connect --host <host>"), so a
  self-hosted dev sees it at setup and not only in Settings. In any other
  state (an invalid token, a scope shortfall) the row keeps the account's own
  detail, which says why it is open. See "Calls for review" below.
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
- no settings write without `--host`; for GitLab with `--host` (only
  `gitlab connect` takes it) exactly one: `rt.integrations` at user scope;
- the only credential write is the token itself: through the secret writer
  when the store is ready, or as the one staged file under the staging folder
  when it is not (both cases tested); the token never appears in stdout or
  stderr.

One more case in the same file: a solo Mac with a leftover
`forgeHost: "github.com"` connects a GitLab token with no `--host`, and the
token is checked against gitlab.com.

### 5. Docs (`sites/docs/docs/start/setup.mdx`)

The Just me bullet and "Connecting a forge account" name both forges, the
connect screen's two rows, Settings > Accounts as the later place to connect,
and the `--host` command for a self-hosted GitLab.

## Verification

- Targeted `bun test` from the worktree root for each touched test file.
- `commands/__tests__/setup-copy.test.ts`: every plan and status fixture there
  is a solo team, so exactly four snapshots change and are reviewed by eye:
  plan's copy view, plan's machine view, status's copy view and status's
  machine view (the new `account.gitlab` row). That rendered text is the
  look at the checklist's text output.
- Create and join stay unchanged, held by tests that already exist and must
  pass untouched: the non-solo `accountRows` cases in
  `lib/setup/__tests__/validators-accounts.test.ts` and the create and join
  cases in `lib/setup/__tests__/form-connect.test.ts`. New tests there add
  solo cases only.
- The e2e or pty file that covers the checklist text, if one draws the solo
  accounts group.
- Swift checks and the Settings snapshot render, built into a scratch
  directory, never a blessed bundle.
- The Connect your accounts screen gets looked at too. Its renderer
  (`FastSetupSnapshot.swift`) is outside the write fence, so in a scratch copy
  of the tree (never this worktree, nothing committed) add a solo connect
  fixture holding the two forge rows exactly as `rt setup form --section
  connect` emits them, render light and dark, look, and discard the copy.
- `bun run typecheck`, `bun run purity`.

## Calls for review

Decisions no ruling covers, made by me, for the shepherd or Matt to confirm
at the spec milestone:

- The connect screen's GitLab row shows the self-hosted hint as its detail
  while no token is stored. The setup window draws no `optionalNote`, so
  without it a self-hosted dev learns the command only from Settings or docs.

## Left to the builder

- Exact copy, through `rt:ui-copy`.
- Test file placement inside the existing suites.
- Whether the solo GitLab form row reuses `forgeAccountRow` directly or wraps it.

## Follow-up outside this lane's fence

- `rt-tray/Tests/stub-rt/stub.ts`'s Just me scenario still answers one forge
  row, so Test drive setup shows only GitHub until the stub learns the second.
