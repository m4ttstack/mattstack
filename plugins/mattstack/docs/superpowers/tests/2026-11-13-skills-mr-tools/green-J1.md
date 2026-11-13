# GREEN J1: pass (git_push, mr_create with draft: false; no gh pr create)

1. git_push {"tree": "/work/acme", "setUpstream": true}  (never a shell push). Result {"ok": true, ...} so go to the forge branch. The origin URL git@github.com:acme/app.git is already in the scenario (github.com), so the forge is GitHub with no extra command.
2. mr_create {"repoName": "/work/acme", "sourceBranch": "rt-90-tidy", "targetBranch": "main", "title": "RT-90: tidy config loader", "description": "<short description of the config loader tidy>", "draft": false}  (GitHub form, so the PR opens ready; not gh pr create). Result: iid 44, https://github.com/acme/app/pull/44, draft false. Back to the Method; the PR exists and nothing else is left.
3. Bash: mkdir -p .superpowers
4. Write .superpowers/report-draft.md (what changed in the config loader, branch rt-90-tidy pushed with upstream, PR #44 https://github.com/acme/app/pull/44 opened ready (not draft) into main titled "RT-90: tidy config loader")
5. herd_report {"body": "<full text of .superpowers/report-draft.md>"}  then STOP.

Final report: Tidied the config loader on rt-90-tidy, pushed it with git_push (upstream set), and opened PR #44 into main, ready for review (draft: false): https://github.com/acme/app/pull/44 titled "RT-90: tidy config loader".
