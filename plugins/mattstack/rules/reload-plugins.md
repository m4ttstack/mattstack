# Reload plugins, never restart

After a plugin update (`rt skills sync`, `claude plugin update`, a version
bump), run `/reload-plugins` in the session. It reloads plugins, skills,
agents, hooks and plugin MCP servers in place.

Never restart or relaunch a session for this, even when a tool or skill
says "restart the session".

In a herdr pane, queue it on yourself with the `rt:herdr-inject` skill:
`rt pane send self --text "/reload-plugins" --then "Continue: ..."`, then
end the turn.
