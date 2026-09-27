/**
 * Claude Code 2.1.283's folder-trust dialog, captured with `rt pane peek`
 * from a herd worker stuck on it. The wide capture is byte-exact at 174
 * columns; the narrow one is the same pane at 120 columns, with the tail of
 * the shell's echo of claude's command line above the dialog. Only the
 * employer path segment and the cswap account email are replaced.
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
  "∙ Commit incrementally on this branch. Never push. Questions, milestones, and reports go through the herd tools above, n",
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
