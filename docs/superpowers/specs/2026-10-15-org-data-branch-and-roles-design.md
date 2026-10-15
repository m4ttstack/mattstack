# Org data branch, sparse checkouts and roles

Date: 2026-10-15. Status: design approved in brainstorming, spec awaiting
review. Builds on `2026-10-01-org-and-teams-design.md` and
`2026-10-06-orgs-root-design.md`.

## Problem

An org's shared data (`mattstack/`, `.sops.yaml`, `.claude-plugin/`) lives on
the org repo's `main`. Three things follow, and all three bit a real org:

- **Publishing needs write access to `main`.** A team owner who is not a
  maintainer of the repo cannot publish their own pack or settings, because
  the forge only lets maintainers push `main`. Granting it opens `main` to
  everything else in that repo. Many orgs keep mattstack data in a repo that
  also holds application code (a company monorepo, or an internal tools
  repo), so `main` is exactly the branch that must stay closed.
- **Every Mac holds every team.** Join already makes a sparse cone clone of
  `.claude-plugin` and `mattstack` (`ORG_CLONE_FOLDERS`,
  `lib/team/org-clone.ts`), but every team folder is in the cone, so a member
  sees every team's folder. A member removed from a team kept that team's folder
  and could still pick it in the console; deleting the folder by hand left
  a clone whose pulls could stop and whose deletions an agent feared pushing.
- **"Admin" is spread across four places.** The `admins` list in the org
  store is the only part rt reads. Forge write access, the switchboard admin
  token (local to one Mac) and repo membership are set up by hand, so a
  second admin cannot do what the first one does without manual steps.

The goal is not confidentiality. Members may read other teams' data; they
just should not see it, switch to it, or be able to break it by accident.

## Decisions

| Decision | Ruling |
|---|---|
| Forges | GitLab and GitHub are equal from the start. Every forge action goes through one forge-neutral interface with an implementation per forge. |
| Where the data lives | On its own branch, `mattstack` by default, in whatever repo the org picks. The branch starts from scratch and holds only mattstack files, never application code. `main` holds a small pointer naming the branch. |
| What each Mac holds | A one-branch, sparse clone of the data branch, its contents decided by the person's role and recomputed after every pull. |
| Team branches | Rejected. Same clutter fix as sparse checkout, at the cost of several checkouts per Mac, drifting org copies and one push per branch for cross-team changes. |
| Repo per team | Rejected for now. Only worth it for real confidentiality. |
| Roles | Org owner, admin, team owner, member, and org member on no team. |
| Team membership | Stays in the roster in the org store. A finer write guard lets a team owner change only their own team's membership. No layout change for this. |
| Forge enforcement | The forge limits who may push the data branch. Which files a pusher may change is enforced by rt, not the forge. Owners are trusted with the branch. |
| Merge requests | None. Not for owners now, not for member proposals later. |
| Forge access management | rt manages push access to the data branch and repo membership once an admin grants it on their Mac. It never touches any other branch's rules. This reverses the earlier ruling that rt manages access only on repos it created: the `createdByRt` gate in front of `rtMayManageMembership` (`commands/team.ts`) is dropped. |
| Forge calls | rt keeps its own CLI path (`gh` and `glab`, `lib/team/forge.ts`) for every write. glance stays read-only, since it is a public npm package. |
| History | The data branch starts with fresh history; the old history stays on `main`. |

## Roles

| Role | Recorded in | Can do |
|---|---|---|
| Org owner | new `owners` list in `mattstack.org` | Everything an admin can, plus change the `owners` and `admins` lists, rename or delete the org |
| Admin | `admins` list in `mattstack.org` (exists) | Invite into the org, create teams, name team owners, edit org settings and any team's folder |
| Team owner | `teams.<team>.owners` in `mattstack.org` (exists) | Edit their team's settings and pack; add or remove existing org members on their team |
| Member | roster entry with teams | Read the org and their teams |
| On no team | roster entry with no teams | Read the org store only |

- An org whose `mattstack.org` has no `owners` list treats its admins as
  owners, so an existing org behaves as today until an owner list is written.
- `roleOf` (`packages/rt-client/src/settings/org-roles.ts`) returns the new
  `org-owner` kind. `ownedRoots` and `mayWritePath` give an org owner what an
  admin has. Every caller that tests `kind === "admin"` (`lib/team/rename.ts`,
  `commands/team.ts` invite, `lib/team/publish.ts`, `viewerFrom` in
  `packages/settings-kit/src/server.ts`) accepts an org owner too, through
  one helper, never a second inline check.

### Write rules

| Change | Who |
|---|---|
| `owners` list | org owners |
| `admins` list, creating a team, a team's `owners` | admins, org owners |
| New roster entry (an invite) | admins, org owners |
| A roster entry's `teams` membership for team T | T's owners, admins, org owners |
| Team T's folder (settings, pack) | T's owners, admins, org owners |
| Org store, anything else | admins, org owners |

The roster rule is field-level: a team owner's edit to the org store is
accepted only when the before and after differ solely in `teams` arrays, and
only by adding or removing their own team names. The guard lives beside
`writeRefusalFor` in `org-roles.ts`, so the settings writer and the CLI share
it. Roster edits today come from the board's members screen
(`saveRosterMembers`, `apps/board/src/config.ts`) and `rt team members`, both
through `setSetting`. So the guard runs in three places, and no new daemon
verb is needed:

- **`setSetting`** (`packages/rt-client/src/settings/write.ts`): a write to
  the org store is accepted when the guard passes for this Mac's role.
- **The daemon's auto-commit** (`readAuthorization`,
  `lib/daemon/home-snapshot.ts`): the org store is in an owner's scope only
  while its working change passes the guard, and out of an admin's scope
  while it changes `owners`.
- **`publishTeam`** (`lib/team/publish.ts`): a pending org store change is
  accepted when the guard passes on the published and the local versions.

(Amended while planning: the console has no roster editor of its own, so the
earlier `team:members-teams` handler had no caller.)

`rt team members` gains add and remove for an existing org member on a team
the caller owns. Inviting someone new into the org stays admin-only.

## The data branch

### Contents and pointer

The data branch holds the paths the org repo holds today, unchanged:
`mattstack/` (org store, team folders, marker), `.sops.yaml`,
`.claude-plugin/`, `.gitignore`, plus a short README saying what the branch is
and that it is never merged into `main` or the other way round (the two
share no history).

Both branches carry a marker at `mattstack/mattstack.jsonc`, and both read:

```jsonc
{ "role": "org", "org": "<org>", "layout": 4, "dataBranch": "mattstack" }
```

- **On the data branch** it is the clone's own marker: `pickedCloneReady`
  (`lib/team/org-layout.ts`) reads `layout` from it as today, and a Mac
  learns its approved branch from its `dataBranch`. A one-branch clone never
  fetches `main`, so nothing after join reads `main`.
- **On `main`** it is the pointer, and it is the only mattstack file left
  there. Only join, conversion and a pre-layout-4 clone still tracking `main`
  read it.

A marker with no `dataBranch` is an org on layout 3 or below, whose data is
on the branch that holds the marker.

### Layout 4

This is a layout change: `ORG_LAYOUT` (`lib/team/org-marker.ts`) goes from 3
to 4. A layout 4 clone is a one-branch clone of `dataBranch`. Paths inside it
are unchanged, so the settings resolver, packs and marketplace read as
before. The layout gate (`layoutGate`, `lib/daemon/home-snapshot.ts`) holds
an older app at its last readable commit when `main`'s marker moves to 4, so
no older app reads the pointer as an empty org.

### What each Mac checks out

`git sparse-checkout` in cone mode, set from the role after every pull that
moves the clone (`createOnPulled`, `lib/daemon/team-snapshots.ts`), and at
clone time.

| Role | Checked out |
|---|---|
| Org owner, admin | everything |
| Team owner, member | root files, `mattstack/org/`, `mattstack/mattstack.jsonc`, `mattstack/teams/<team>/` for each team the roster lists them on |
| On no team | root files, `mattstack/org/`, `mattstack/mattstack.jsonc` |

- `listTeamFolders` then sees only the teams this Mac holds, so the console's
  team picker (`viewerFrom`, `packages/settings-kit/src/server.ts`) and every
  other reader narrow with no change of their own.
- Removing a folder from the checkout is held when the folder has
  uncommitted or unpushed changes. The `org.sparse` setup row says which
  folder and why, and the next pull after a push retries.
- A clone that still has a folder this Mac's role no longer reaches, with no
  local changes, loses it at the next pull. That is the fix for a removed
  member who keeps a team's folder.
- To verify while planning: `.claude-plugin/marketplace.json` lists every
  team's pack, some of whose folders a sparse clone lacks. Confirm Claude
  Code's `plugin marketplace update` and `plugin install` of the Mac's own
  pack tolerate the missing folders. If they do not, materialize writes a
  per-Mac marketplace file listing only the packs this Mac holds.

### Branch-aware auto-commit

The daemon's auto-commit and push run only when the clone is on an approved
branch:

- the org's `dataBranch`, read from the clone's own marker, or
- a branch this Mac switched to with `rt team branch use` (below).

On any other branch, auto-commit pauses, the `org.branch` setup row and the
console say "auto-commit paused: this clone is on <branch>", and edits stay
in the working tree. Deliberate verbs (`rt skills sync`, `rt team publish`)
still run on any branch, since a person chose them.

### Trial branches

`rt team branch use <name>` checks the clone out on `<name>`, creating it
from `dataBranch` when it does not exist, and records it as approved on this
Mac only (machine-local, never in the org store). It fetches the branch first
when the remote has it, and switches in place (rewriting the one-branch fetch
refspec), so it can also move a clone onto a branch with unrelated history,
such as a trial data branch made by the conversion script. `rt team branch
use <dataBranch>` returns. This is the supported way to try a new layout on
the dev app without moving anyone else: the pointer on `main` never changes
for a trial. `rt team invite` refuses while the clone is on a trial branch
(see Create and join: it checks the branch against `main`'s pointer), since
joiners must clone the real data branch. Admins and org owners only.

### Create and join

`rt team create`, `rt team invite` and `rt team join` hard-code `main` today
(`lib/team/invite.ts`, `lib/team/join.ts`). Under layout 4:

- **Create** makes the data branch from scratch with the org's files and a
  marker, and commits the pointer to `main` (a new org's repo is empty, so
  `main` is writable).
- **Reading `main`'s pointer** (invite and an older invite's join): `git
  fetch --depth 1 --filter=blob:none origin main` into a temporary bare
  repo, then `git show FETCH_HEAD:mattstack/mattstack.jsonc`. It works on
  both forges and fetches one commit and one file's blob.
- **Invite** reads `main`'s pointer and refuses unless the clone is checked
  out on the branch the pointer names, replacing today's refusal off `main`.
  It keys on the pointer, never on the clone's own marker, because a trial
  data branch's marker names the trial. The sealed pointer carries that
  `dataBranch`.
- **Join** clones `dataBranch` with `--single-branch` and extends today's
  sparse cone clone (`ORG_CLONE_FOLDERS`) with the role-based folders, never
  a second clone path. An invite from an older rt carries no `dataBranch`:
  join then reads `main`'s pointer the same way, and clones `main` as today
  when it names none.

## Forge access

### The interface

A forge-neutral `OrgForgeAccess` with a GitLab and a GitHub implementation,
beside today's `grantRead` in `lib/team/forge.ts`, calling the forge through
`glab api` and `gh api`:

- `readPushList(branch)` and `setPushList(branch, usernames)`: who may push
  the data branch. GitLab: a protected branch with named users allowed to
  push. GitHub: branch protection or a ruleset restricting pushes to named
  users. The exact GitHub feature for private org repos is confirmed while
  planning.
- `readMembers()` and `grant(username, level)` / `revoke(username)`: repo
  access, with two levels, read and write.
- `protect(branch)`: first-time protection of the data branch.

When the forge refuses (a missing permission), rt does not work around it:
the setup row shows the admin the one step to do on that forge by hand. When
the forge's plan cannot limit pushes to named people at all, the row says so
plainly: anyone with write access can push the data branch, and only rt's
own guard limits what they change there.

### Who should have what

From the roles: org owners, admins and team owners are on the push list and
have write; members and people on no team have read.

| | Read | Write | Push list |
|---|---|---|---|
| GitLab | Reporter | Developer | "Allowed to push and merge" on the protected data branch names the user |
| GitHub | read | write | the branch rule's push restriction names the user |

Repo membership is repo-wide (write lets a person push any unprotected branch
in that repo); only the push list is specific to the data branch. rt compares this with
what the forge has and reports the difference in the `org.forge-access`
setup row on admin and org-owner Macs: who to add, who to remove.

### When rt applies it

Only after an admin grants it on their Mac, through the existing machine-local
latch (`rtMayManageMembership`, `lib/team/team-local.ts`), now offered on any
org repo, not only one rt created. With the grant, rt applies the difference
after every roster or role change that Mac makes, and on each update run.
Without it, the row only reports. rt never edits rules on any branch other
than the data branch.

### Admin-only secrets

The switchboard admin token moves from one Mac's local secrets into a new
admin-only encrypted file, `mattstack/org/admin-secrets/`, with its own
`.sops.yaml` creation rule whose recipients are the org owners' and admins'
age keys. Promoting or demoting an admin re-encrypts it. The existing org
secrets (`mattstack/org/secrets/`, every member a recipient) are unchanged;
per-team secrets are out of scope.

`lib/secrets/team-store.ts` owns exactly one creation rule today and refuses
a `.sops.yaml` with more (`TeamSopsYamlHandEditedError`). It grows to own
both rules: `writeTeamRecipients` and re-encryption take the rule, and
re-encryption runs per rule with that rule's recipients. A third rule, or one
it did not write, is still refused.

The token's readers change together, per the switchboard rule in AGENTS.md:
invite (`lib/team/invite.ts`), join (`lib/team/join.ts`), board peering
(`lib/team/board-peers.ts`, `lib/team/peer.ts`) and the
`account.board-peering` row (`lib/setup/validators/accounts.ts`). Each reads
the admin-only file first and the local secret second, so a Mac that has not
pulled the move keeps working.

### Demotion and removal

The same comparison runs the other way: push access and write come off, the
admin-only secrets are re-encrypted without the person, and their next pull
narrows their checkout.

## Conversion

1. Release an rt that reads layout 4 and carries everything above.
2. An admin runs `bun scripts/move-to-data-branch.ts <clone-dir> --admin
   <username>` (plans; `--write` acts). Flags: `--data-branch <name>`
   (default `mattstack`) and `--no-pointer` (create the data branch only,
   for a trial). It:
   - creates the data branch from scratch with the paths listed above, a
     layout 4 marker and a README, and pushes it;
   - commits the pointer to `main`, replacing those paths and touching
     nothing else on `main`. Where the admin can push `main`, it pushes.
     Where `main` takes changes only by that repo's own rules, it pushes the
     commit to a branch, prints it, and the admin lands it that way;
   - before the pointer lands, checks that `main`'s mattstack paths have not
     changed since the data branch was made, and copies them across again
     when they have, so an edit made in between is not lost;
   - prints the grant step for forge access.
   Until the pointer is on `main`, nothing moves: every Mac keeps reading
   `main` on layout 3, and the data branch is unused.
3. With the grant, rt protects the data branch and sets its push list.
4. Updated Macs move in place, not by a fresh clone. The layout gate
   (`layoutGate`) reads the fetched `main` marker; on layout 4 with a
   `dataBranch` it returns a new "moved" verdict, and the daemon holds the
   pull instead of fast-forwarding `main` (a fast-forward would delete the
   org files from the working tree). The `org.folder` converge step, which
   runs on every `rt setup update` and full `rt setup apply`, then fetches
   `dataBranch`, rewrites the fetch refspec to that one branch, checks it
   out and sets the sparse cone. git's own refusal to check out over local
   changes is the safety: a clone with uncommitted edits stays on `main`,
   held, and the `org.layout` row names the files. `rt team pull` runs the
   same move on demand. Because `rt setup update` runs once per app version,
   an app that updated before the pointer landed would otherwise wait for the
   next release: the `org.layout` row's remedy for a held clone is `rt team
   pull`, and the daemon runs that move itself once a held clone is clean.
   Older apps hold at their last readable commit until updated.

To try the conversion before the release, run the script with `--data-branch
<trial> --no-pointer` against the real repo, then `rt team branch use
<trial>` on the dev app's Mac. Nobody else's Mac sees either branch.

The `rt-settings` skill's layout runbook gains layout 4's script and the
trial-branch verb.

## Members proposing changes (later, not built)

Room left for a member's change to go to `mattstack-proposal/<user>-<time>`,
shown in the team owner's console, applied by the owner's rt to the data
branch on their OK. No merge request. Its own spec.

## Optional follow-up

A stray-commit check on admin Macs: each incoming commit on the data branch
is compared with its author's role, and one outside it is flagged in the
console. Flags only; never blocks or reverts.

## Testing

- Unit: role resolution including an org with no `owners` list; the
  field-level roster guard; the sparse set per role; held folder removal;
  the auto-commit branch rule; the push-list difference; marker parsing with
  and without `dataBranch`.
- `OrgForgeAccess`: the same contract tests against a GitLab and a GitHub
  fake, plus one live run per forge against the test repos.
- Conversion: dry run on a copy of a real org clone, then `--write`.
- Trial: `--data-branch <trial> --no-pointer` on a real org repo, then
  `rt team branch use <trial>` on the dev app's Mac, before the release.
- The move: a layout 3 clone with and without local edits, the held pull,
  and `org.folder`'s in-place switch.
- Release VM: the team-join scenario clones the data branch, a new scenario
  checks a member's Mac holds only their teams, and join runs against a
  GitHub-hosted org as well as a GitLab one.
