# Fast Browser routing

For ordinary browser driving, use Fast Browser before any other browser
automation.

- Delegate multi-step browser work through the Agent tool's
  `fast-browser:browser-driver` agent type, spelled exactly that way.
  `browser-driver` and `fast browser` are not registered types.
- If that type is not in your agent list, drive the Fast Browser MCP tools
  yourself. Never guess another agent name, and never retry a failed spawn.
- Do not delegate a single lookup, where the spawn costs more than the
  snapshot it saves, or a task whose raw output you must audit yourself.
- Never fall back to Claude in Chrome unless the user asks for it.

Use the Fast Browser macro-first workflow and keep browser results
distilled.

The browser-driver runs on `haiku` at `medium` effort. Escalate to `sonnet`
at `medium` only when a Haiku run came back unfinished for a reason a better
brief would not fix: it wandered, misread a page, or reached a wrong
conclusion with the page in front of it. A run that stopped on missing
context gets the context and stays on Haiku. Never retry a stuck run
unchanged. Only `haiku` and `sonnet` drive the browser, never `opus` or
`fable` (hand a failed Sonnet run back to the user), and never `low` effort.

When the browser-driver returns a question its brief does not settle,
answer it with SendMessage to that same agent, never a fresh spawn, so it
keeps its place in the browser.
