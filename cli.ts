#!/usr/bin/env bun

/**
 * rt ... Zero-footprint repo CLI.
 *
 * All command navigation is handled by the command tree dispatcher.
 * Commands register declaratively; the dispatcher handles screen clearing,
 * breadcrumb headers, pickers, and repo context.
 *
 * Usage:
 *   rt                        interactive menu
 *   rt daemon status          direct subcommand
 *   rt daemon                 subcommand picker
 *   rt run                    direct command
 */

import { dispatch } from "./lib/command-tree.ts";
import { TREE } from "./lib/command-tree-def.ts";
import { buildFlavor, captureProcessFlavor, processFlavor, versionBanner } from "./lib/flavor.ts";
import { rtDir, migrateLegacyRtDir, migrateLegacyPluginsDir, LEGACY_RT_LABEL, RT_DIR_LABEL, trayAppPath } from "./lib/rt-paths.ts";

captureProcessFlavor();

const args = process.argv.slice(2);

// The generated PATH shims (lib/endpoint/shim.ts) exec
// `rt intercept run <command> -- "$@"` for every intercepted invocation, and
// that path must be byte-transparent — its stderr belongs to the wrapped
// command, not to rt. Decided here, before the migration block below, because
// that block is the first thing on the entry path that prints.
const isInterceptRun = args[0] === "intercept" && args[1] === "run";

// ─── Legacy state migration (RT-46) ──────────────────────────────────────────
// Move a real legacy rt dir into place BEFORE anything (the CLI logger
// included) can create the new tree and turn a clean rename into a conflict.
// The daemon entry runs its own copy of this (lib/daemon.ts) for the
// `bun run lib/daemon.ts` source path; the call is idempotent.
//
// The migration runs on EVERY entry path, intercepts included: an
// intercepted command really can be the first rt invocation after an upgrade.
const stateMigration = migrateLegacyRtDir();
const pluginsMigration = migrateLegacyPluginsDir();

// Called from __main: the output layer loads on demand, and a top-level
// await here would block bytecode compilation. The intercept path stays
// silent, since its stderr belongs to the wrapped command and a split-state
// warning would land there on every invocation.
async function reportMigrations(): Promise<void> {
  if (isInterceptRun) return;
  const acted = (result: string) => result === "migrated" || result === "conflict";
  if (!acted(stateMigration) && !acted(pluginsMigration)) return;
  const out = await import("./lib/ui/out.ts");
  if (stateMigration === "migrated") {
    out.note(out.line("done", "Moved your rt data to its new folder", RT_DIR_LABEL));
  } else if (stateMigration === "conflict") {
    out.note(
      out.line("warn", "Your rt data is in two folders"),
      out.callout("note", ["rt only reads ", out.strong(RT_DIR_LABEL)]),
      out.callout("fix", ["Merge ", out.strong(LEGACY_RT_LABEL), " into it by hand, then delete ", out.strong(LEGACY_RT_LABEL)]),
    );
  }
  if (pluginsMigration === "migrated") {
    out.note(out.line("done", "Moved your plugins so they travel with your home repo", "~/.mattstack/user/plugins"));
  } else if (pluginsMigration === "conflict") {
    out.note(
      out.line("warn", "Your plugins are in two folders"),
      out.callout("note", ["rt only reads ", out.strong("~/.mattstack/user/plugins")]),
      out.callout("fix", ["Merge ", out.strong("~/.mattstack/rt/plugins"), " into it by hand, then delete ", out.strong("~/.mattstack/rt/plugins")]),
    );
  }
}

// ─── Command Tree ────────────────────────────────────────────────────────────
//
// Branch nodes: have subcommands → dispatcher shows a picker
// Leaf nodes: have module/fn → dispatcher lazy-imports and calls the handler
//
// The tree lives in ./lib/command-tree-def.ts as the single source of truth
// for command names, descriptions, and structure. Handlers are lazy-loaded.

// ─── Entry ───────────────────────────────────────────────────────────────────

// Injected at compile time via `bun build --define RT_VERSION='"v1.x.x"'`.
// Falls back to "dev" when running from source.
declare const RT_VERSION: string;
const _RT_VERSION = (typeof RT_VERSION !== "undefined" ? RT_VERSION : null) ?? process.env.RT_VERSION ?? "dev";

const baseDir = import.meta.dir; // resolve module paths relative to cli.ts

// Everything below runs inside an async function rather than at true module
// scope: a real top-level await here would make cli.ts (and every module
// that imports it) async-initializing, which blocks `bun build --compile
// --bytecode`. __main().catch() below must keep the same crash behavior a
// top-level await would have had — see the call site at the end of the file.
async function __main() {
// Invocation logging + crash capture for every CLI entry path, including the
// ~100 process.exit() sites that never return to dispatch(). The daemon path
// is excluded — it installs its own pino crash handlers.
if (args[0] !== "--daemon") {
  const { installCliLogging, logCliEvent } = await import("./lib/cli-logger.ts");
  installCliLogging(args);
  // The daemon never sets this: its warnings stay on its own log surface.
  const { setWarningLog } = await import("./lib/ui/warn.ts");
  setWarningLog((module, message, context) => logCliEvent("warn", module, message, context), { quiet: isInterceptRun });
}
await reportMigrations();

if (args[0] === "--version" || args[0] === "-V") {
  const { payload } = await import("./lib/ui/out.ts");
  payload(versionBanner(_RT_VERSION, processFlavor(), buildFlavor(), { execPath: process.execPath, sourceDir: import.meta.dir }) + "\n");
} else if (args[0] === "--daemon") {
  // Hidden entry point: start the daemon server directly.
  // Used when rt is a compiled binary — daemon install spawns `rt --daemon`
  // instead of `bun run lib/daemon.ts`.
  const { startDaemon } = await import("./lib/daemon.ts");
  startDaemon();
} else if (isInterceptRun) {
  // Hidden fast path: the generated PATH shims (lib/endpoint/shim.ts) exec
  // `rt intercept run <command> -- "$@"` for every intercepted invocation
  // (e.g. `pnpm start`), and that MUST be byte-transparent — no screen
  // clear, no breadcrumb banner (dispatch()'s leaf-node ceremony), no
  // first-run setup, no plugin-tree load/skip notices. Bypass all of that
  // and call the handler directly, same tier as --daemon/--post-install.
  const { interceptRun } = await import("./commands/intercept.ts");
  await interceptRun(args.slice(2));
} else if (args[0] === "--post-install") {
  // Hidden entry point: the headless installer. Sweeps legacy state, then
  // runs `rt setup apply --non-interactive --team-of-one`. Remaining args
  // (e.g. `--json`, `--no-launch`) forward straight into that apply call.
  const { runPostInstall } = await import("./commands/post-install.ts");
  await runPostInstall(args.slice(1));
} else if (args[0] === "--grant-fda") {
  // Hidden entry point: open System Settings → Privacy → Full Disk Access.
  // The daemon inherits TCC grants from mattstack.app via SMAppService's
  // AssociatedBundleIdentifiers, so the grant goes on the tray app, not on rt.
  const { execSync } = await import("child_process");
  const out = await import("./lib/ui/out.ts");
  const trayPath = trayAppPath();
  out.print(
    out.line("needs-you", "Grant Full Disk Access to mattstack.app", "System Settings is opening"),
    out.callout("note", ["Click + under Full Disk Access and add ", out.strong(trayPath)], "The rt daemon takes the grant from the app."),
    out.callout("next", out.cmd("rt daemon restart")),
  );
  try {
    execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"');
  } catch {
    out.fail({ title: "System Settings did not open", next: "Open Privacy & Security, then Full Disk Access, yourself" });
    process.exit(1);
  }
} else {
  // ── First-run hint ────────────────────────────────────────────────────────
  // `rt setup` (not this hook) owns getting a machine set up... an auto-run
  // here would defeat `rt setup plan`'s canInstall being reachable
  // pre-install. A command that IS part of getting set up must reach its own
  // handler untouched; RT_APP_SOCKET means mattstack.app is driving rt and
  // already knows the setup state.
  const FIRST_RUN_HINT_SKIP = new Set([
    "setup", "team", "deps", "services", "flavor", "tools", "repos", "skills", "cron", "uninstall", "home", "secrets", "restore", "verify",
  ]);
  if (
    process.env.CI !== "true" &&
    process.env.RT_SKIP_SETUP !== "1" &&
    !process.env.RT_APP_SOCKET &&
    !FIRST_RUN_HINT_SKIP.has((args[0] === "--all" ? args[1] : args[0]) ?? "")
  ) {
    const { existsSync } = await import("fs");
    const { join } = await import("path");
    if (!existsSync(join(rtDir(), "daemon.json"))) {
      const out = await import("./lib/ui/out.ts");
      out.note(out.line("needs-you", "rt is not set up yet"), out.callout("next", ["Open mattstack.app, or run ", out.cmd("rt setup install")]));
    }
  }

  if (args[0] === "verify") {
    const { runVerify } = await import("./commands/verify.ts");
    await runVerify(args.slice(1));
    process.exit(0);
  }

  // ── Command dispatch ────────────────────────────────────────────────────
  const { routeSettingsNotices } = await import("./lib/settings/notice-channel.ts");
  await routeSettingsNotices(args);

  // User plugins merge into the tree at the root; built-ins always win.
  // ExecFailure propagates a plugin exec target's exit code as rt's own
  // (dispatch has already logged the error outcome by the time it rethrows);
  // every other error is sorted by lib/errors.ts.
  const { loadPluginTree, ExecFailure } = await import("./lib/plugins.ts");
  const fullTree = loadPluginTree(TREE);
  try {
    // --help/-h at any depth is intercepted by dispatch itself.
    await dispatch(fullTree, args, ["rt"], baseDir);
  } catch (err) {
    if (err instanceof ExecFailure) process.exit(err.code);
    const { exitFromDispatch } = await import("./lib/errors.ts");
    exitFromDispatch(err);
  }
}
}

// An error from before dispatch (the plugin tree, notice routing) takes the
// same exit as one from a command, so no path prints a bare stack.
__main().catch(async (err) => {
  const { exitFromDispatch } = await import("./lib/errors.ts");
  exitFromDispatch(err);
});
