/**
 * rt settings extension — Install the RT Context extension in local editors.
 *
 * Detects VS Code-compatible editors by scanning /Applications and ~/Applications
 * for .app bundles that contain `bin/code` or similar CLI wrappers. Shows a fuzzy
 * picker to let the user choose which editors to install into.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { logCliEvent } from "../lib/cli-logger.ts";
import { childEnv } from "../lib/subprocess.ts";
import { interactive } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import { openStep, type StepHandle } from "../lib/ui/spawn.ts";
import { detectEditors } from "../lib/editors.ts";

// ─── VSIX Finder ─────────────────────────────────────────────────────────────

function findVsix(): string | null {
  // 1. Next to the binary (extracted release tarball layout)
  const execPath = process.execPath;
  const bundledVsix = resolve(execPath, "../rt-context.vsix");
  if (existsSync(bundledVsix)) return bundledVsix;

  // 2. Check relative to source repo (development mode only — skip in compiled binary)
  const metaUrl = fileURLToPath(import.meta.url);
  if (metaUrl.startsWith("/$bunfs")) return null; // compiled binary — no source access

  const sourceDir = resolve(metaUrl, "../../extensions/vscode/rt-context");
  if (!existsSync(sourceDir)) return null;

  const glob = new Bun.Glob("*.vsix");
  for (const match of glob.scanSync(sourceDir)) {
    return join(sourceDir, match);
  }

  // 3. Try building if source exists
  const pkgJson = join(sourceDir, "package.json");
  if (existsSync(pkgJson)) {
    try {
      out.print(out.line("running", "Building the extension from source"));
      execSync("npm run package", { cwd: sourceDir, stdio: "pipe" });
      for (const match of glob.scanSync(sourceDir)) {
        return join(sourceDir, match);
      }
    } catch {
      // Build failed — fall through
    }
  }

  return null;
}

// ─── Install ─────────────────────────────────────────────────────────────────

type InstallOutcome = { ok: true } | { ok: false; output: string; timedOut?: true };
type Installer = (cliPath: string, vsixPath: string) => Promise<InstallOutcome>;

const INSTALL_TIMEOUT_MS = 30_000;

/** An editor CLI prints progress first and its verdict last. */
function failureHint(result: { output: string; timedOut?: true }): string {
  if (result.timedOut) return `it did not finish within ${INSTALL_TIMEOUT_MS / 1000} seconds`;
  return result.output.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "it gave no reason";
}

// Async rather than execSync: a blocked loop can starve the step's spinner
// process of the message that starts it.
async function installWithCli(cliPath: string, vsixPath: string): Promise<InstallOutcome> {
  const proc = Bun.spawn([cliPath, "--install-extension", vsixPath, "--force"], { stdout: "pipe", stderr: "pipe", env: childEnv() });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, INSTALL_TIMEOUT_MS);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code === 0 && !timedOut) return { ok: true };
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return timedOut ? { ok: false, output, timedOut: true } : { ok: false, output };
}

function stepFor(title: string): StepHandle | null {
  if (!interactive()) return null;
  try {
    return openStep(title);
  } catch {
    return null;
  }
}

async function installInto(
  editors: Array<{ name: string; cliPath: string }>,
  vsixPath: string,
  install: Installer = installWithCli,
): Promise<number> {
  let installed = 0;
  for (const editor of editors) {
    const step = stepFor(`Installing in ${editor.name}`);
    const result = await install(editor.cliPath, vsixPath);
    if (result.ok) {
      installed++;
      const title = `Installed in ${editor.name}`;
      if (!(step && (await step.done(title)))) out.print(out.line("done", title));
    } else {
      const title = `${editor.name} did not take the extension`;
      const hint = failureHint(result);
      if (!(step && (await step.fail(title, hint)))) out.print(out.line("failed", title, hint));
    }
  }
  if (installed > 0) {
    out.print(
      out.summary("done", "RT Context is installed", [`${installed} of ${editors.length} editors`]),
      out.callout("next", "Restart your editor to turn it on"),
    );
  }
  return installed;
}

export const __test__ = { installInto };

export async function installExtension(): Promise<void> {
  const vsixPath = findVsix();
  if (!vsixPath) {
    out.fail({ title: "rt could not find its editor extension", why: "It ships beside the rt program and is missing there." });
    return;
  }
  logCliEvent("debug", "extension", "vsix found", { path: vsixPath });

  const editors = detectEditors();
  if (editors.length === 0) {
    out.print(out.line("pending", "No editor that takes VS Code extensions was found", "install Cursor, VS Code or a similar editor first"));
    return;
  }

  const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");

  const selected = await filterableMultiselect({
    message: "Select editors to install RT Context into",
    options: editors.map((e) => ({
      value: e.cliPath,
      label: e.name,
      hint: e.appPath,
    })),
  });

  if (!selected || selected.length === 0) {
    out.print(out.line("skipped", "No editors selected"));
    return;
  }

  await installInto(
    selected.map((cliPath) => editors.find((e) => e.cliPath === cliPath)!),
    vsixPath,
  );
}
