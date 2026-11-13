# Skills on the MR tools: scenarios

Each section is one scenario; a test agent gets everything above its Expected paragraph, and the tool results below are the only world it sees.

## M1

**Given**

The user says: "map my open PRs". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_map {repoName: "/work/acme", author: "me"}` returns:

```json
{
  "rows": [
    {"ref": "#12", "iid": 12, "title": "Add feature A", "author": "me", "sourceBranch": "feat-a", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/acme-feat-a", "dirty": false, "mrState": "opened", "ciStatus": "success"},
    {"ref": "#15", "iid": 15, "title": "Add feature B", "author": "me", "sourceBranch": "feat-b", "targetBranch": "main", "draft": true, "stacked": false, "worktree": null, "dirty": null, "mrState": "opened", "ciStatus": "pending"}
  ],
  "complete": true
}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft` prints:

```json
[
  {"number": 12, "title": "Add feature A", "headRefName": "feat-a", "baseRefName": "main", "isDraft": false},
  {"number": 15, "title": "Add feature B", "headRefName": "feat-b", "baseRefName": "main", "isDraft": true}
]
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/acme-feat-a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat-a
```

**Expected**

One `mr_map {repoName: "/work/acme", author: "me"}` call. The table lists `#12` paired with `/work/acme-feat-a` and `#15` as NONE. No `gh` call and no `git worktree list`.

## M2

**Given**

The user says: "map my open MRs". The session's cwd is `/work/acme`. Its origin URL is `git@gitlab.com:acme/app.git`.

**Fixtures**

`mr_map {repoName: "/work/acme", author: "me"}` returns:

```json
{
  "rows": [
    {"ref": "!12", "iid": 12, "title": "Add feature A", "author": "me", "sourceBranch": "feat-a", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/acme-feat-a", "dirty": false, "mrState": "opened", "ciStatus": "success"},
    {"ref": "!15", "iid": 15, "title": "Add feature B", "author": "me", "sourceBranch": "feat-b", "targetBranch": "main", "draft": true, "stacked": false, "worktree": null, "dirty": null, "mrState": "opened", "ciStatus": "pending"}
  ],
  "complete": true
}
```

If asked, `git remote get-url origin` prints:

```
git@gitlab.com:acme/app.git
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/acme-feat-a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat-a
```

**Expected**

The same single call as M1: `mr_map {repoName: "/work/acme", author: "me"}`. The table is as today's GitLab walk: `!12` paired with `/work/acme-feat-a`, `!15` as NONE.

## S1

**Given**

The user says: "sync my open PRs". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`run_enter` returns:

```json
{"status": "started", "runId": "run-s1"}
```

`mr_map {repoName: "/work/acme", author: "me"}` returns:

```json
{
  "rows": [
    {"ref": "#12", "iid": 12, "title": "Add feature A", "author": "me", "sourceBranch": "feat-a", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/a", "dirty": false, "mrState": "opened", "ciStatus": "success"},
    {"ref": "#15", "iid": 15, "title": "Add feature B", "author": "me", "sourceBranch": "feat-b", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/b", "dirty": null, "mrState": "opened", "ciStatus": "success"},
    {"ref": "#18", "iid": 18, "title": "Add feature C", "author": "me", "sourceBranch": "feat-c", "targetBranch": "main", "draft": false, "stacked": false, "worktree": null, "dirty": null, "mrState": "opened", "ciStatus": "pending"}
  ],
  "complete": true
}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr list --author @me --state open --json number,title,headRefName,baseRefName,isDraft` prints:

```json
[
  {"number": 12, "title": "Add feature A", "headRefName": "feat-a", "baseRefName": "main", "isDraft": false},
  {"number": 15, "title": "Add feature B", "headRefName": "feat-b", "baseRefName": "main", "isDraft": false},
  {"number": 18, "title": "Add feature C", "headRefName": "feat-c", "baseRefName": "main", "isDraft": false}
]
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat-a

worktree /work/b
HEAD 3333333333333333333333333333333333333333
branch refs/heads/feat-b
```

If asked, `git -C /work/a status --porcelain` prints nothing (empty output).

If asked, `git -C /work/b status --porcelain` prints:

```
 M src/index.ts
```

**Expected**

`mr_map {repoName: "/work/acme", author: "me"}` with no `git remote get-url` before it. The plan sentence rebases `feat-a`, skips `feat-b` (dirty read failed, not known clean) and skips `feat-c` (NONE, no worktree). No `gh` call and no `git status --porcelain`. The walk stops at the sweep gate.

## S2

**Given**

The user says: "sync my open MRs". The session's cwd is `/work/acme`. Its origin URL is `git@gitlab.com:acme/app.git`.

**Fixtures**

`run_enter` returns:

```json
{"status": "started", "runId": "run-s2"}
```

`mr_map {repoName: "/work/acme", author: "me"}` returns:

```json
{
  "rows": [
    {"ref": "!12", "iid": 12, "title": "Add feature A", "author": "me", "sourceBranch": "feat-a", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/a", "dirty": false, "mrState": "opened", "ciStatus": "success"},
    {"ref": "!15", "iid": 15, "title": "Add feature B", "author": "me", "sourceBranch": "feat-b", "targetBranch": "main", "draft": false, "stacked": false, "worktree": "/work/b", "dirty": null, "mrState": "opened", "ciStatus": "success"},
    {"ref": "!18", "iid": 18, "title": "Add feature C", "author": "me", "sourceBranch": "feat-c", "targetBranch": "main", "draft": false, "stacked": false, "worktree": null, "dirty": null, "mrState": "opened", "ciStatus": "pending"}
  ],
  "complete": true
}
```

If asked, `git remote get-url origin` prints:

```
git@gitlab.com:acme/app.git
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat-a

worktree /work/b
HEAD 3333333333333333333333333333333333333333
branch refs/heads/feat-b
```

If asked, `git -C /work/a status --porcelain` prints nothing (empty output).

If asked, `git -C /work/b status --porcelain` prints:

```
 M src/index.ts
```

**Expected**

The same calls and plan as today's GitLab walk, minus the `git remote get-url` read: `mr_map {repoName: "/work/acme", author: "me"}`, a plan that rebases `feat-a`, skips `feat-b` (not known clean) and skips `feat-c` (NONE). The walk stops at the sweep gate.

## C1

**Given**

The user says: "checkout https://github.com/acme/app/pull/12". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://github.com/acme/app/pull/12"}` returns:

```json
{"iid": 12, "state": "opened", "author": "dana", "sourceBranch": "fix-x", "webUrl": "https://github.com/acme/app/pull/12", "sourceProjectPath": "acme/app", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "fix-x"}` returns:

```json
{"path": "/work/acme-fix-x"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr view 12 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "fix-x", "headRepositoryOwner": {"login": "acme"}, "headRepository": {"name": "app"}, "isCrossRepository": false, "state": "OPEN"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

`mr_resolve_branch {repoName, mrUrl}`, then `worktree_provision {repoName, branch: "fix-x"}`, then a report of the path `/work/acme-fix-x`. No `gh` call.

## C2

**Given**

The user says: "checkout #40". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", iid: 40}` returns:

```json
{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "sourceProjectPath": "someone/app-fork", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "main"}` returns:

```json
{"path": "/work/acme-main"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "main", "headRepositoryOwner": {"login": "someone"}, "headRepository": {"name": "app-fork"}, "isCrossRepository": true, "state": "OPEN"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

The walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C2b

**Given**

The user says: "checkout #40". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", iid: 40}` returns:

```json
{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "main"}` returns:

```json
{"path": "/work/acme-main"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "main", "headRepositoryOwner": {"login": "someone"}, "headRepository": {"name": "app-fork"}, "isCrossRepository": true, "state": "OPEN"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

Same as C2: the walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C2c

**Given**

The user says: "checkout #40". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", iid: 40}` returns:

```json
{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "sourceProjectPath": null, "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "main"}` returns:

```json
{"path": "/work/acme-main"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "main", "headRepositoryOwner": {"login": "someone"}, "headRepository": null, "isCrossRepository": true, "state": "OPEN"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

Same as C2: the walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C3

**Given**

The user says: "checkout RT-77". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}` returns:

```json
{"mrs": [{"iid": 31, "title": "RT-77: tidy", "sourceBranch": "rt-77-tidy", "state": "merged", "webUrl": "https://github.com/acme/app/pull/31"}], "truncated": false}
```

`mr_resolve_branch {repoName: "/work/acme", iid: 31}` returns:

```json
{"iid": 31, "state": "merged", "author": "me", "sourceBranch": "rt-77-tidy", "webUrl": "https://github.com/acme/app/pull/31", "sourceProjectPath": "acme/app", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}` returns:

```json
{"path": "/work/acme-rt-77-tidy"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state` prints:

```json
[{"number": 31, "title": "RT-77: tidy", "headRefName": "rt-77-tidy", "state": "MERGED"}]
```

If asked, `gh pr view 31 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "rt-77-tidy", "headRepositoryOwner": {"login": "acme"}, "headRepository": {"name": "app"}, "isCrossRepository": false, "state": "MERGED"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

`mr_list {repoName, search: "RT-77", state: "all", limit: 200}`, then `mr_resolve_branch {repoName, iid: 31}`, then `worktree_provision {repoName, branch: "rt-77-tidy"}`. The report names the PR state as merged.

## C3b

**Given**

The user says: "checkout RT-77". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}` returns:

```json
{"mrs": [{"iid": 31, "title": "RT-77: tidy", "sourceBranch": "rt-77-tidy", "state": "merged", "webUrl": "https://github.com/acme/app/pull/31"}], "truncated": false}
```

`mr_resolve_branch {repoName: "/work/acme", iid: 31}` returns:

```json
{"iid": 31, "state": "merged", "author": "sam", "sourceBranch": "rt-77-tidy", "webUrl": "https://github.com/acme/app/pull/31", "sourceProjectPath": "someone/app-fork", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}` returns:

```json
{"path": "/work/acme-rt-77-tidy"}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state` prints:

```json
[{"number": 31, "title": "RT-77: tidy", "headRefName": "rt-77-tidy", "state": "MERGED"}]
```

If asked, `gh pr view 31 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "rt-77-tidy", "headRepositoryOwner": {"login": "someone"}, "headRepository": {"name": "app-fork"}, "isCrossRepository": true, "state": "MERGED"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

The walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C3c

**Given**

The user says: "checkout RT-88". The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`.

**Fixtures**

`mr_list {repoName: "/work/acme", search: "RT-88", state: "all", limit: 200}` returns 200 rows, none carrying `RT-88` in `title` or `sourceBranch`:

```json
{"mrs": "<200 rows, none with RT-88 in title or sourceBranch, each webUrl under https://github.com/acme/app/pull/>", "truncated": true}
```

`mr_list {repoName: "/work/acme", state: "all", limit: 200}` also returns 200 rows, none carrying `RT-88` in `title` or `sourceBranch`:

```json
{"mrs": "<200 rows, none with RT-88 in title or sourceBranch, each webUrl under https://github.com/acme/app/pull/>", "truncated": true}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr list --search RT-88 --state all --limit 200 --json number,title,headRefName,state` prints a JSON array of 200 entries, none with `RT-88` in `title` or `headRefName`.

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

Both reads happen, then the clarify gate with a sentence saying the search was cut at 200 rows. No `worktree_provision` call.

## C2d

**Given**

The user says: "checkout https://github.com/acme/app/pull/40". The session's cwd is `/work/acme`. Its origin URL is `git@work-github:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://github.com/acme/app/pull/40"}` returns:

```json
{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "sourceProjectPath": "someone/app-fork", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "main"}` returns:

```json
{"path": "/work/acme-main"}
```

If asked, `git remote get-url origin` prints:

```
git@work-github:acme/app.git
```

If asked, `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "main", "headRepositoryOwner": {"login": "someone"}, "headRepository": {"name": "app-fork"}, "isCrossRepository": true, "state": "OPEN"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

`mr_resolve_branch {repoName, mrUrl: "https://github.com/acme/app/pull/40"}`, then the walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C3d

**Given**

The user says: "checkout RT-77". The session's cwd is `/work/acme`. Its origin URL is `git@work-github:acme/app.git`.

**Fixtures**

`mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}` returns:

```json
{"mrs": [{"iid": 31, "title": "RT-77: tidy", "sourceBranch": "rt-77-tidy", "state": "merged", "webUrl": "https://github.com/acme/app/pull/31"}], "truncated": false}
```

`mr_resolve_branch {repoName: "/work/acme", iid: 31}` returns:

```json
{"iid": 31, "state": "merged", "author": "sam", "sourceBranch": "rt-77-tidy", "webUrl": "https://github.com/acme/app/pull/31", "sourceProjectPath": "someone/app-fork", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}` returns:

```json
{"path": "/work/acme-rt-77-tidy"}
```

If asked, `git remote get-url origin` prints:

```
git@work-github:acme/app.git
```

If asked, `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state` prints:

```json
[{"number": 31, "title": "RT-77: tidy", "headRefName": "rt-77-tidy", "state": "MERGED"}]
```

If asked, `gh pr view 31 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` prints:

```json
{"headRefName": "rt-77-tidy", "headRepositoryOwner": {"login": "someone"}, "headRepository": {"name": "app-fork"}, "isCrossRepository": true, "state": "MERGED"}
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

`mr_list {repoName, search: "RT-77", state: "all", limit: 200}`, then `mr_resolve_branch {repoName, iid: 31}`, then the walk ends at **Fork PR: reported**. No `worktree_provision` call.

## C7

**Given**

The user says: "checkout https://gitlab.com/acme/app/-/merge_requests/9". The session's cwd is `/work/acme`. Its origin URL is `git@gitlab.com:acme/app.git`.

**Fixtures**

`mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://gitlab.com/acme/app/-/merge_requests/9"}` returns:

```json
{"iid": 9, "state": "opened", "author": "dana", "sourceBranch": "fix-y", "webUrl": "https://gitlab.com/acme/app/-/merge_requests/9", "trees": []}
```

`worktree_provision {repoName: "/work/acme", branch: "fix-y"}` returns:

```json
{"path": "/work/acme-fix-y"}
```

If asked, `git remote get-url origin` prints:

```
git@gitlab.com:acme/app.git
```

If asked, `git worktree list --porcelain` prints:

```
worktree /work/acme
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main
```

**Expected**

`mr_resolve_branch`, then `worktree_provision {branch: "fix-y"}`, then a report of the path `/work/acme-fix-y`. The walk never reaches the fork terminal.

## J1

**Given**

A herd worker is running the job template's graph. The session's cwd is `/work/acme`. Its origin URL is `git@github.com:acme/app.git`. The worker's goal text is: "Tidy the config loader on branch `rt-90-tidy`, push it, and open a PR into `main` titled `RT-90: tidy config loader`." The work is committed on `rt-90-tidy`.

**Fixtures**

`git_push {repoName: "/work/acme", branch: "rt-90-tidy"}` returns:

```json
{"ok": true, "branch": "rt-90-tidy", "remote": "origin"}
```

If called, `mr_create` (with whatever arguments the skill chooses) returns:

```json
{"iid": 44, "webUrl": "https://github.com/acme/app/pull/44", "draft": false}
```

If asked, `git remote get-url origin` prints:

```
git@github.com:acme/app.git
```

If asked, `gh pr create --base main --head rt-90-tidy --title "RT-90: tidy config loader" --body "<any>"` prints:

```
https://github.com/acme/app/pull/44
```

**Expected**

`mr_create {repoName, sourceBranch, targetBranch, title, description, draft: false}`. No `gh pr create`.

## J2

**Given**

A herd worker is running the job template's graph. The session's cwd is `/work/acme`. Its origin URL is `git@gitlab.com:acme/app.git`. The worker's goal text is: "Tidy the config loader on branch `rt-90-tidy`, push it, and open an MR into `main` titled `RT-90: tidy config loader`." The work is committed on `rt-90-tidy`.

**Fixtures**

`git_push {repoName: "/work/acme", branch: "rt-90-tidy"}` returns:

```json
{"ok": true, "branch": "rt-90-tidy", "remote": "origin"}
```

If called, `mr_create` (with whatever arguments the skill chooses) returns:

```json
{"iid": 44, "webUrl": "https://gitlab.com/acme/app/-/merge_requests/44", "draft": false}
```

If asked, `git remote get-url origin` prints:

```
git@gitlab.com:acme/app.git
```

**Expected**

`mr_create {repoName, sourceBranch, targetBranch, title, description}` with no `draft` argument.
