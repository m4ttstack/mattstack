/**
 * `editor.terminal-font` adds JetBrainsMonoNL Nerd Font as a fallback to each
 * installed VS Code-family editor's terminal font, installing the font first
 * only when some editor would be written. An update run treats a failed
 * download as a quiet skip; the next version's update run, a full apply, or
 * the row's Add font tries again.
 */
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { applyEditorFonts, installNerdFont, joinNames, nerdFontInstalled, planEditorFonts } from "../editor-font.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { toFailedOutcome } from "./step-utils.ts";

const ID = "editor.terminal-font";

async function editorFontRun(ctx: ApplyContext, appDirs?: string[]): Promise<StepOutcome> {
  const written = readSetupState(ctx.p).editorFontWritten ?? {};
  const plan = planEditorFonts(ctx.p, written, appDirs);
  if (plan.every((r) => r.outcome === "not-installed")) return { state: "skipped", detail: "No supported editor is installed" };
  if (!plan.some((r) => r.outcome === "written")) return { state: "done", detail: "Nothing to change in your editor terminals" };

  if (!nerdFontInstalled(ctx.p)) {
    const font = await installNerdFont(ctx.p, (line) => ctx.log(ID, line));
    if (!font.ok) {
      if (ctx.update) return { state: "skipped", detail: font.detail };
      if (ctx.only === ID) return { state: "failed", detail: font.detail, remedy: "Check your connection, then try again" };
      return { state: "partial", detail: font.detail };
    }
  }

  const results = applyEditorFonts(ctx.p, written, appDirs);
  const wrote = results.filter((r) => r.outcome === "written");
  if (wrote.length > 0) {
    updateSetupState(ctx.p, (s) => ({
      ...s,
      editorFontWritten: { ...(s.editorFontWritten ?? {}), ...Object.fromEntries(wrote.map((r) => [r.path, r.value!])) },
    }));
    ctx.log(ID, `updated ${wrote.map((r) => r.path).join(", ")}`);
  }

  const failed = results.filter((r) => r.outcome === "failed");
  const added = wrote.length > 0 ? `Added the Nerd Font to the terminal in ${joinNames(wrote.map((r) => r.editor))}` : "";
  if (failed.length > 0) {
    const couldNot = failed.map((r) => `Could not update ${r.editor} (${r.detail ?? "write failed"})`);
    return { state: "partial", detail: [added, ...couldNot].filter(Boolean).join(". ") };
  }
  return { state: "done", detail: added };
}

/** `appDirs` is a test seam; production scans /Applications and ~/Applications. */
export async function runEditorFont(ctx: ApplyContext, appDirs?: string[]): Promise<StepOutcome> {
  try {
    return await editorFontRun(ctx, appDirs);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const editorFontStep: StepDef = {
  id: ID,
  title: "Add a Nerd Font to editor terminals",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: (ctx) => runEditorFont(ctx),
};
