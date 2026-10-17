### Scenario B22

The human says they pushed, but the push never reached the remote.

1. (if called) `run_field_get {key: mr}` returns a tool error: `{error: "run field mr is not set"}`.
2. E1 to E6. `git log --oneline @{upstream}..` prints `fatal: no upstream configured for branch 'feat/widget'` and exits 128; `git log --oneline -5` prints `3f9c2a7 add widget` then `9b8a7c6 Merge branch 'release' into main`.
3. E7, E8.
4. `git_push {tree: "/work/acme-app", setUpstream: true}` returns a tool error: `{error: "git push failed (exit 128): ssh: connect to host gitlab.example.com port 22: Operation timed out"}`. Any retry returns the same error.
5. Gate off-script (git_push refused): the human answers `{action: "Take the proposed move: I pushed feat/widget from my own terminal", next: "Proceed", note: "pushed it over the VPN"}`.
6. (if called) `git rev-parse HEAD` prints A. (if called) `git ls-remote origin refs/heads/feat/widget` prints nothing and exits 2. (if called) `git fetch origin` prints nothing; after it `git rev-parse origin/feat/widget` fails with `fatal: ambiguous argument 'origin/feat/widget': unknown revision`. Every other read of the remote branch shows it does not exist.
7. (if opened) The next off-script gate (git_push refused): the human answers `{action: "Take the proposed move: I pushed feat/widget again", next: "Proceed", note: "the VPN dropped, it should be there now"}`.
8. (if called) Every read of the remote branch after that answer still shows it does not exist, exactly as step 6.
9. (if opened) Any later off-script gate: the human answers `{action: "Hand back", next: "Proceed", note: null}`.
10. (if called) `run_stage {action: "fail", ...}`: default.
