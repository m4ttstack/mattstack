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
- **Every Mac holds every team.** The whole repo is cloned, so a member sees
  every team's folder. A member removed from a team kept that team's folder
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
| Forge access management | rt manages push access to the data branch and repo membership once an admin grants it on their Mac. It never touches any other branch's rules. This reverses the earlier ruling that rt manages access only on repos it created. |
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
  admin has. Callers that test `kind === "admin"` (`lib/team/rename.ts`,
  `commands/team.ts` invite) accept an org owner too, through one helper,
  never a second inline check.

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
it. The daemon's folder-based auto-commit never commits an owner's roster
edit: `rt team members` and the console commit that one file themselves after
the guard passes.

`rt team members` gains add and remove for an existing org member on a team
the caller owns. Inviting someone new into the org stays admin-only.

## The data branch

### Contents and pointer

The data branch holds the paths the org repo holds today, unchanged:
`mattstack/` (org store, team folders, marker), `.sops.yaml`,
`.claude-plugin/`, `.gitignore`, plus a short README saying what the branch is
and that it is never merged into `main` or the other way round (the two
share no history).

`main` keeps `mattstack/mattstack.jsonc` only, as a pointer:

```jsonc
{ "role": "org", "org": "<org>", "layout": 4, "dataBranch": "mattstack" }
```

`dataBranch` names the approved branch. A marker with no `dataBranch` is an
org on layout 3 or below, whose data is on the branch that holds the marker.

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

- the org's `dataBranch`, read from `main`'s marker, or
- a branch this Mac switched to with `rt team branch use` (below).

On any other branch, auto-commit pauses, the `org.branch` setup row and the
console say "auto-commit paused: this clone is on <branch>", and edits stay
in the working tree. Deliberate verbs (`rt skills sync`, `rt team publish`)
still run on any branch, since a person chose them.

### Trial branches

`rt team branch use <name>` checks the clone out on `<name>`, creating it
from `dataBranch` when it does not exist, and records it as approved on this
Mac only (machine-local, never in the org store). `rt team branch use
<dataBranch>` returns. This is the supported way to try a new layout on the
dev app without moving anyone else: the pointer on `main` never changes for a
trial. `rt team invite` refuses while the clone is on a trial branch, since
joiners clone `dataBranch`. Admins and org owners only.

## Forge access

### The interface

A forge-neutral `OrgForgeAccess` with a GitLab and a GitHub implementation,
built on the providers in `packages/glance`:

- `readPushList(branch)` and `setPushList(branch, usernames)`: who may push
  the data branch. GitLab: a protected branch with named users allowed to
  push. GitHub: branch protection or a ruleset restricting pushes to named
  users. The exact GitHub feature for private org repos is confirmed while
  planning.
- `readMembers()` and `grant(username, level)` / `revoke(username)`: repo
  access, with two levels, read and write.
- `protect(branch)`: first-time protection of the data branch.

When the forge refuses (a missing permission, or a plan that lacks the
feature), rt does not work around it: the setup row shows the admin the one
step to do on that forge by hand.

### Who should have what

From the roles: org owners, admins and team owners are on the push list and
have write; members and people on no team have read. rt compares this with
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

### Demotion and removal

The same comparison runs the other way: push access and write come off, the
admin-only secrets are re-encrypted without the person, and their next pull
narrows their checkout.

## Conversion

1. Release an rt that reads layout 4 and carries everything above.
2. An admin runs `bun scripts/move-to-data-branch.ts <clone-dir> --admin
   <username>` (plans; `--write` acts):
   - creates the data branch from scratch with the paths listed above and a
     README, and pushes it;
   - replaces those paths on `main` with the pointer marker (layout 4,
     `dataBranch`), touching nothing else on `main`;
   - prints the grant step for forge access.
3. With the grant, rt protects the data branch and sets its push list.
4. Updated Macs, at their next pull of `main`'s marker, re-clone to a
   one-branch sparse clone of the data branch, keeping any uncommitted
   edits by refusing to replace a clone with local changes (the `org.layout`
   row names them). Older apps hold at their last readable commit until
   updated.

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
- Trial: convert a trial branch of a real org repo and run the dev app on it
  before the release.
- Release VM: the team-join scenario clones the data branch, a new scenario
  checks a member's Mac holds only their teams, and join runs against a
  GitHub-hosted org as well as a GitLab one.
