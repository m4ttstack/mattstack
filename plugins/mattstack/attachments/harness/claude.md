The Claude target's native fragments. `rt skills expand --harness claude`
and `rt skills compile --harness claude` place each `## <name>` section where
a source writes `{{harness:<name>}}` on a line of its own. Each name here has
a twin in `codex.md`.

## status-writes

When your tool list has `mcp__mattstack-mods__status`, every
`<status-bin> review-status`, `respond-status` or `doctor-status` write in
this skill is a call to that tool instead of a Bash command: `verb` is the
word after `<status-bin>`, and `args` is every word after the verb, in
order, with a message of several words as one string. If the tool answers
that it is not live, run the same write with `<status-bin>` in Bash. Without
that tool, run `<status-bin>` as written. Every other `<status-bin>` verb
(`gate`, `review-ledger`) always runs in Bash.
