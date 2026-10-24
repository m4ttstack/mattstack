/**
 * rt settings extension — Install rt's editor extensions (rt-context, skill-blocks) in local editors.
 *
 * Detects VS Code-compatible editors by scanning /Applications and ~/Applications
 * for .app bundles that contain `bin/code` or similar CLI wrappers. Shows a fuzzy
 * picker to let the user choose which editors to install into.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import { logCliEvent } from "../lib/cli-logger.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { BUNDLED_VSIX_FILES, findBundledVsixes } from "../lib/setup/tools-install.ts";
import { childEnv } from "../lib/subprocess.ts";
import { interactive } from "../lib/ui/gate.ts";
import * as out from "../lib/ui/out.ts";
import { openStep, settleBackground, type StepHandle } from "../lib/ui/spawn.ts";
import { detectEditors, type DetectedEditor } from "../lib/editors.ts";

// ─── VSIX Finder ─────────────────────────────────────────────────────────────

/** Each bundled file name and the extensions/vscode folder its source lives in. */
const SOURCE_DIRS: Record<(typeof BUNDLED_VSIX_FILES)[number], string> = {
  "rt-context.vsix": "rt-context",
  "skill-blocks.vsix": "skill-blocks",
};

/** Development mode only: a packaged `.vsix` in the source tree, built on demand. */
function findInSource(sourceDirName: string): string | null {
  const metaUrl = fileURLToPath(import.meta.url);
  if (metaUrl.startsWith("/$bunfs")) return null; // compiled binary — no source access

  const sourceDir = resolve(metaUrl, "../../extensions/vscode", sourceDirName);
  if (!existsSync(sourceDir)) return null;

  const glob = new Bun.Glob("*.vsix");
  for (const match of glob.scanSync(sourceDir)) {
    return join(sourceDir, match);
  }

  // 3. Try building if source exists
  const pkgJson = join(sourceDir, "package.json");
  if (existsSync(pkgJson)) {
    try {
      out.print(out.line("running", `Building ${sourceDirName} from source`));
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

/** The app's `Contents/Resources` first, then beside the binary, then the source tree for any file neither holds. */
function findVsixes(
  p: Pick<Probes, "exists" | "home"> = createRealProbes(),
  besideBinaryDir?: string,
  fromSource: (sourceDirName: string) => string | null = findInSource,
): string[] {
  const bundled = findBundledVsixes(p, besideBinaryDir);
  const found: string[] = [];
  for (const file of BUNDLED_VSIX_FILES) {
    const hit = bundled.find((path) => basename(path) === file) ?? fromSource(SOURCE_DIRS[file]);
    if (hit) found.push(hit);
  }
  return found;
}

// ─── Install ─────────────────────────────────────────────────────────────────

type InstallOutcome = { ok: true } | { ok: false; output: string; timedOut?: true };
type Installer = (cliPath: string, vsixPath: string) => Promise<InstallOutcome>;

async function installAll(cliPath: string, vsixPaths: readonly string[], install: Installer): Promise<InstallOutcome> {
  for (const vsixPath of vsixPaths) {
    const result = await install(cliPath, vsixPath).catch(
      (err): InstallOutcome => ({ ok: false, output: err instanceof Error ? err.message : String(err) }),
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}

const INSTALL_TIMEOUT_MS = 30_000;

/** An editor CLI prints progress first and its verdict last. */
function failureHint(result: { output: string; timedOut?: true }): string {
  if (result.timedOut) return `it did not finish within ${INSTALL_TIMEOUT_MS / 1000} seconds`;
  return result.output.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "it gave no reason";
}

const KILL_GRACE_MS = 2_000;

type Drain = { text: () => string; done: Promise<void>; cancel: () => void };

function drain(stream: ReadableStream<Uint8Array>): Drain {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    try {
      for (;;) {
        const { done: ended, value } = await reader.read();
        if (ended) return;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      /* cancelled after a timeout */
    }
  })();
  return { text: () => text, done, cancel: () => void reader.cancel().catch(() => {}) };
}

// Async rather than execSync: a blocked loop can starve the step's spinner
// process of the message that starts it.
// The macOS `code` launcher starts Electron as a child that inherits its pipes,
// so a timeout signals the whole process group and stops waiting on the pipes
// after the grace period even if something outside the group still holds them.
async function installWithCli(cliPath: string, vsixPath: string, timeoutMs = INSTALL_TIMEOUT_MS): Promise<InstallOutcome> {
  const proc = Bun.spawn([cliPath, "--install-extension", vsixPath, "--force"], {
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv(),
  });
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      /* group already gone */
    }
  };
  const stdout = drain(proc.stdout);
  const stderr = drain(proc.stderr);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const abandoned = new Promise<null>((giveUp) => {
    timer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => giveUp(null), KILL_GRACE_MS);
    }, timeoutMs);
  });
  const finished = Promise.all([stdout.done, stderr.done, proc.exited]).then(([, , exit]) => exit);
  const code = await Promise.race([finished, abandoned]);
  clearTimeout(timer);
  clearTimeout(killTimer);
  if (timedOut) {
    signalGroup("SIGKILL");
    stdout.cancel();
    stderr.cancel();
  }
  if (code === 0 && !timedOut) return { ok: true };
  const output = [stdout.text().trim(), stderr.text().trim()].filter(Boolean).join("\n");
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
  vsixPaths: readonly string[],
  install: Installer = installWithCli,
): Promise<number> {
  let installed = 0;
  for (const editor of editors) {
    if (interactive()) await settleBackground();
    const step = stepFor(`Installing in ${editor.name}`);
    const result = await installAll(editor.cliPath, vsixPaths, install);
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
      out.summary("done", "The editor extensions are installed", [`${installed} of ${editors.length} editors`]),
      out.callout("next", "Restart your editor to turn it on"),
    );
  }
  return installed;
}

export const __test__ = { installInto, installWithCli, findVsixes };

export interface ExtensionDeps {
  findVsixes: () => string[];
  detectEditors: () => DetectedEditor[];
  pick: (editors: DetectedEditor[]) => Promise<string[] | null>;
  install: Installer;
}

function realExtensionDeps(): ExtensionDeps {
  return {
    findVsixes: () => findVsixes(),
    detectEditors: () => detectEditors(),
    pick: async (editors) => {
      const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
      return filterableMultiselect({
        message: "Select editors to install rt's extensions into",
        options: editors.map((e) => ({ value: e.cliPath, label: e.name, hint: e.appPath })),
      });
    },
    install: installWithCli,
  };
}

export async function installExtension(_args: string[] = [], _ctx: unknown = {}, deps: ExtensionDeps = realExtensionDeps()): Promise<void> {
  const vsixPaths = deps.findVsixes();
  if (vsixPaths.length === 0) {
    out.fail({ title: "rt could not find its editor extension", why: "It ships beside the rt program and is missing there." });
    process.exit(1);
  }
  logCliEvent("debug", "extension", "vsix found", { paths: vsixPaths });

  const editors = deps.detectEditors();
  if (editors.length === 0) {
    out.print(out.line("pending", "No editor that takes VS Code extensions was found", "install Cursor, VS Code or a similar editor first"));
    return;
  }

  const selected = await deps.pick(editors);

  if (!selected || selected.length === 0) {
    out.print(out.line("skipped", "No editors selected"));
    return;
  }

  const installed = await installInto(
    selected.map((cliPath) => editors.find((e) => e.cliPath === cliPath)!),
    vsixPaths,
    deps.install,
  );
  if (installed === 0) process.exit(1);
}
