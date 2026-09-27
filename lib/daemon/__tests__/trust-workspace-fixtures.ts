/**
 * Claude Code 2.1.283's folder-trust dialog, captured with `rt pane peek`
 * from a herd worker stuck on it. Only the wide capture is byte-exact, at
 * 174 columns; the narrow capture's dialog text is verbatim from the same
 * pane at 120 columns, but its 120-column rule was rebuilt from the pane's
 * observed wrap width rather than captured directly. Only the employer path
 * segment and the cswap account email are replaced.
 */
export const FIXTURE_PATH = "/Users/matt/.mattstack/teams/acme/.worktrees/t38fix-devservers";

const WIDE_LINES = [
  "─".repeat(174),
  " Accessing workspace:",
  "",
  ` ${FIXTURE_PATH}`,
  "",
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to",
  " review what's in this folder first.",
  "",
  " Claude Code'll be able to read, edit, and execute files here.",
  "",
  " Security guide",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
];

export const CAPTURED_WIDE = WIDE_LINES.join("\n");

export const CAPTURED_NARROW = [
  "∙ ## Git",
  // A base letter plus a combining acute (U+0301), as macOS filenames produce: two code points, one terminal cell.
  "∙ café terminale, a decomposed accent test row padded to a fixed cell width xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "ever into the repo.",
  "∙ Tooling that manages its own workspace inside the repo writes where that",
  "∙ tooling specifies; the write fence lists those paths.",
  "∙",
  "∙ ## Delegation",
  "∙ For searches, codebase exploration, and mechanical subtasks, dispatch",
  "∙ subagents on cheaper models instead of doing them in your own context.",
  "∙ Reserve your own turns for design decisions and the work itself.",
  "∙ '",
  "Launching Account-3 (dev@example.test) [session mode]",
  "",
  "─".repeat(120),
  " Accessing workspace:",
  "",
  ` ${FIXTURE_PATH}`,
  "",
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
  " project, or work from your team). If not, take a moment to review what's in this folder first.",
  "",
  " Claude Code'll be able to read, edit, and execute files here.",
  "",
  " Security guide",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
].join("\n");

/** The wide capture with its path and cursor swapped; nothing else moves. */
export function workspaceScreen(opts: { path?: string; cursor: "no" | "yes" }): string {
  return WIDE_LINES.map((line) => {
    if (line === ` ${FIXTURE_PATH}`) return ` ${opts.path ?? FIXTURE_PATH}`;
    if (line === " ❯ No, exit") return opts.cursor === "no" ? line : "   No, exit";
    if (line === "   Yes, I trust this folder") return opts.cursor === "yes" ? " ❯ Yes, I trust this folder" : line;
    return line;
  }).join("\n");
}

// Copied verbatim from apps/board/src/client/board/gate-gallery.fixtures.ts'
// TRUST_SCREEN (the Account-2 pane's own capture), rule included.
export const CAPTURED_ACCOUNT_2 = `∙ ## Messages
∙ Anything from the shepherd or a reviewer arrives in your context as a chat
∙ message (\`[#<room>] <handle> #<n>: ...\` or \`[dm] <handle> #<n>: ...\`).
∙ Reply with \`rt chat dm <handle> "..."\`, never with a direct agent message. A
∙ message that changes your task is a new instruction; a message that only
∙ informs needs no reply.
∙
∙ ## Git
∙ Commit incrementally on this branch. This job is the integration job, so it pushes: It pushes and opens PRs as the pla
n says (Task 1 in this worktree, Task 3 in its own tools worktree), pushes the team pack directly (that push is the p
ublish the operator approved), and merges a PR only on the operator'\\''s answer. Never force-push. Never push to main
 directly, except the team pack push above. Questions, milestones, and reports go through the \`rt herd\` commands ab
ove, never into the repo.
∙ Tooling that manages its own workspace inside the repo writes where that
∙ tooling specifies; the write fence lists those paths.
∙
∙ ## Delegation
∙ For searches, codebase exploration, and mechanical subtasks, dispatch
∙ subagents on cheaper models instead of doing them in your own context.
∙ Reserve your own turns for design decisions and the work itself.
∙ '
Account-2 (agent@example.com) is already the active default login... launching the agent directly.

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Accessing workspace:

 /Users/pat/.mattstack/teams/acme

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;
