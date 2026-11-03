import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { packageEditorExtensions } from "../editor-extensions.ts";
import type { RunResult } from "../../subprocess.ts";

const ok: RunResult = { stdout: "", stderr: "", exitCode: 0 };

function recorder(failOn?: string) {
  const calls: { cmd: string; cwd: string | undefined }[] = [];
  const exec = async (argv: [string, ...string[]], opts?: { cwd?: string }): Promise<RunResult> => {
    const cmd = argv.join(" ");
    calls.push({ cmd, cwd: opts?.cwd });
    return failOn !== undefined && cmd.includes(failOn) && opts?.cwd?.endsWith("skill-blocks") ? { stdout: "", stderr: "vsce broke", exitCode: 1 } : ok;
  };
  return { exec, calls };
}

describe("packageEditorExtensions", () => {
  test("builds and packages both extensions to fixed paths, and returns build.sh's variables", async () => {
    const { exec, calls } = recorder();
    const env = await packageEditorExtensions(exec, "/scratch");
    expect(env).toEqual({
      RT_VSIX: "/scratch/extensions/vscode/rt-context/rt-context.vsix",
      RT_SKILL_BLOCKS_VSIX: "/scratch/extensions/vscode/skill-blocks/skill-blocks.vsix",
    });
    expect(calls).toEqual([
      { cmd: "bun run build", cwd: "/scratch/extensions/vscode/rt-context" },
      { cmd: "bunx vsce package --no-dependencies --out /scratch/extensions/vscode/rt-context/rt-context.vsix", cwd: "/scratch/extensions/vscode/rt-context" },
      { cmd: "bun run build", cwd: "/scratch/extensions/vscode/skill-blocks" },
      { cmd: "bunx vsce package --no-dependencies --out /scratch/extensions/vscode/skill-blocks/skill-blocks.vsix", cwd: "/scratch/extensions/vscode/skill-blocks" },
    ]);
  });

  test("a failed package names the extension and what it printed", async () => {
    const { exec } = recorder("vsce");
    const err = await packageEditorExtensions(exec, "/scratch").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).message).toContain("skill-blocks");
    expect((err as UserActionableError).message).toContain("vsce broke");
  });
});
