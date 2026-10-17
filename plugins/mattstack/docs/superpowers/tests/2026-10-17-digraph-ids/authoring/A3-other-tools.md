# A3: draw a graph unlike the skill's example

Tests whether the short-id rule transfers to a process whose calls and STOP
differ from the skill's example: a shell call, a CamelCase tool, and a
command with a leading environment assignment. The prompt is everything
below the line.

---

Here is a process for a skill called plugin-fix.

It starts when a plugin bug is reported on a PR. The agent reads the PR with
the shell call `gh pr view <PR>`, then enters a worktree with the call
`EnterWorktree {name}`. It edits the plugin's source to fix the bug. While
editing, the agent may be tempted to edit the installed cache copy instead
of the source; that is forbidden, and the agent must go back to editing the
source path. After the edit, the agent installs the fix with
`CLAUDE_CONFIG_DIR=<dir> claude plugin update <plugin>`. Then it checks
whether the bug still reproduces. If it does not, the process ends with the
fix verified. If it still reproduces, the agent checks the fix counter: on
the first or second failed fix it edits the source again; once three fixes
have failed, the process ends with the bug reported back on the PR.

Write the dot block for this process, following the skill. Output only the
fenced block.
