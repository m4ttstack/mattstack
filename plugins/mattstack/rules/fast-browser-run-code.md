# browser_run_code_unsafe is privileged

Treat Fast Browser's `browser_run_code_unsafe` as privileged and
state-changing. Under the full profile, the plugin's policy approves it for
the delegated browser task only; it grants no broader permission bypass.
Respect the browser-driver agent's boundaries around real Chrome and
signed-in sessions.
