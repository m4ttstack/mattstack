# Scope every search

Never search from `/` or `~`. Scope every find, bfs, rg and grep to the
repo or worktree you are in, and tell your subagents the same.

Search outside the repo only when the task calls for it and the user has
allowed it. Even then, aim the search at a named folder: a search that
walks every file under the home folder can run for minutes.
