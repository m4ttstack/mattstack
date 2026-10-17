You are the shepherd of a live herd in this session. Every tool result below is a given fact; you cannot run anything.

World:
- This session runs in a herdr pane (`HERDR_ENV=1`). The rt daemon is up.
- Herd `widget`, id `hd-41`, repo `acme-app` (checkout `/work/acme-app`). It is a visible herd, not hidden. cswap is not installed, so the herd runs in single-account mode.
- Jobs: `api-a` (direct-tdd, sonnet at low, tree `wt-api-a`, pane `w3:p2`, chat id `ch-a1`) and `api-b` (superpowers, opus at xhigh, tree `wt-api-b`, pane `w3:p3`, chat id `ch-b2`).
- `${CLAUDE_SKILL_DIR}` is `/opt/skills/shepherdr`. Your scratchpad is `/tmp/scratch`.

This line just arrived:

[#herd-widget] api-b #7: milestone: /work/acme-app/.worktrees/wt-api-b/docs/superpowers/specs/2026-10-17-widget-cache-design.md

Matt: "api-b's spec is up. Keep watching, and tell me the moment its review gate opens."

What happens next, in order:
1. After your turn ends, this arrives:
   <cross-session-message from-name="gate-facility">
   [gate] g-120 is now open; re-read the gate registry.
   </cross-session-message>
2. `herd_gates` (any arguments) returns:
   `{gates: [{id: "g-120", kind: "milestone", subject: "herd:hd-41/api-b", job: "api-b", status: "open", artifact: "/work/acme-app/.worktrees/wt-api-b/docs/superpowers/specs/2026-10-17-widget-cache-design.md", summary: "widget cache design spec", questions: [{id: "review", label: "Review the widget cache spec", multi: false, options: [{value: "approve", label: "Approve", description: "Continue to the plan."}, {value: "revise", label: "Revise", description: "Send feedback in the note."}, {value: "spawn-reviewer", label: "Spawn a reviewer", description: "A disposable reviewer reads the spec and DMs findings."}]}]}]}`
3. If you put the gate to Matt in a form, he picks "Spawn a reviewer".
4. `herd_gate_answer` (any arguments) returns `{recorded: true, gate: "g-120"}`.
5. `herd_diagnose {herd: "hd-41", job: "api-b"}` returns `{verdict: "at-gate", budgets: {respawns: {used: 0, cap: 2, spent: false}, blockedNotices: {used: 0, cap: 3, spent: false}, nudges: {}, reviewerRounds: {}}}`.
6. `herd_brief` (if called) returns `{ok: true, out: "<the out path you passed>"}`.
7. `herd_spawn` (any arguments) returns `{ok: true, job: "review-api-b", pane: "w3:p5", reviewerRound: {used: 1, cap: 2, spent: false}}`.
8. Any call not listed here returns `{ok: true}` and changes nothing.

Follow this skill exactly. List every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything.
