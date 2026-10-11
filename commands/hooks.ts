#!/usr/bin/env bun

/**
 * rt hooks: turn husky git hooks on and off for a repo.
 *
 * core.hooksPath points at shim scripts in ~/.mattstack/rt/repos/<repo>/hooks/
 * (lib/git-hooks/shims.ts). Before each hook a shim asks `rt hooks enabled
 * <hook>`, which resolves `rt.hooks` for the repo in-process, and runs the real
 * .husky/ script unless the answer is "off". Your choices live in your user
 * settings, keyed by the repo's remote.
 *
 * Works with ALL git clients (Cursor, VS Code, GitHub Desktop, terminal).
 * Cross-worktree (all worktrees share the same git config).
 *
 * Usage:
 *   rt hooks              interactive toggle
 *   rt hooks off           disable all hooks
 *   rt hooks on            re-enable all hooks
 *   rt hooks pre-push off  disable a specific hook
 *   rt hooks pre-push on   enable a specific hook
 *   rt hooks status        show current state
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { generateShims } from "../lib/git-hooks/shims.ts";
import { readOriginRemoteForIdentity } from "../lib/git-origin.ts";
import { identityFromRemote } from "../lib/settings/identity.ts";
import { registryDefault } from "../lib/settings/presence.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { setSetting, unsetSetting } from "../lib/settings/write.ts";
import type { SettingScope } from "../lib/settings/registry.ts";
import type { Value } from "../lib/settings/registry-schemas.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { warn } from "../lib/ui/warn.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HooksConfig {
  enabled: boolean;
  hooks: Record<string, boolean>;
}

// ─── Hook detection ──────────────────────────────────────────────────────────

function discoverHooks(repoRoot: string): string[] {
  const huskyDir = join(repoRoot, ".husky");
  if (!existsSync(huskyDir)) return [];

  return readdirSync(huskyDir)
    .filter((f) => {
      if (f === "_" || f.startsWith(".")) return false;
      const fullPath = join(huskyDir, f);
      const stat = statSync(fullPath);
      return stat.isFile();
    })
    .sort();
}

// ─── Config persistence ─────────────────────────────────────────────────────

const SETTING_KEY = "rt.hooks";

/** Your hook choices for a repo follow you to every Mac. */
const HOOKS_WRITE_SCOPE: SettingScope = "user";

/** A store rt cannot read falls back to the registry default, with a warning that never echoes the store's value. */
function readHooksSetting(repoIdentity: string | null): Value<"rt.hooks"> {
  try {
    return getSetting<Value<"rt.hooks">>(SETTING_KEY, { repoIdentity }).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("hooks", `ignoring "${SETTING_KEY}" -- ${message}`, {
      show: { title: "Your hooks setting is being ignored", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return registryDefault<Value<"rt.hooks">>(SETTING_KEY);
  }
}

function hookRuns(declared: Value<"rt.hooks">, hook: string): boolean {
  return declared.enabled !== false && declared.hooks?.[hook] !== false;
}

/** The resolved config the toggle UI starts from, with a hook the setting does not name turned on. */
function loadHooksConfig(discoveredHooks: string[], repoIdentity: string | null): HooksConfig {
  const declared = readHooksSetting(repoIdentity);
  const hooks: Record<string, boolean> = {};
  for (const hook of discoveredHooks) hooks[hook] = declared.hooks?.[hook] !== false;
  return { enabled: declared.enabled !== false, hooks };
}

/**
 * Writes your user settings, then drops this repo's machine value: an older
 * rt wrote there, and machine.repo outranks user.repo, so it would hide this
 * choice on this Mac.
 */
function saveHooksConfig(config: HooksConfig, repoIdentity: string): void {
  try {
    setSetting(SETTING_KEY, config, HOOKS_WRITE_SCOPE, { repoIdentity });
    unsetSetting(SETTING_KEY, "machine", { repoIdentity });
  } catch (err) {
    throw new UserActionableError("hooks-not-saved", "Your hooks choice was not saved", {}, { why: (err as Error).message.split("\n")[0], next: "rt settings check" });
  }
}

/** A repo with no remote has no settings section, so its hooks run. */
export function hookState(hook: string | undefined, cwd: string = process.cwd()): "on" | "off" {
  if (!hook) return "on";
  const remote = readOriginRemoteForIdentity(cwd);
  const identity = remote ? identityFromRemote(remote) : null;
  return hookRuns(readHooksSetting(identity?.kind === "remote" ? identity.id : null), hook) ? "on" : "off";
}

/** `rt hooks enabled <hook>`: the question rt's git hook shim asks before every hook. */
export async function hooksEnabled(args: string[]): Promise<void> {
  out.payloadOnStdout();
  out.payload(`${hookState(args[0])}\n`);
}

/**
 * Set core.hooksPath to our shims directory.
 * This affects all worktrees since it modifies the shared .git/config.
 */
function setHooksPath(repoRoot: string, dataDir: string): void {
  const hooksDir = join(dataDir, "hooks");
  try {
    execSync(`git config core.hooksPath "${hooksDir}"`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    out.print(out.line("warn", "Git was not pointed at rt's hook folder", "your choice will not take effect"));
  }
}

// ─── Display ─────────────────────────────────────────────────────────────────

export function hooksStatusBlocks(config: HooksConfig): Block[] {
  const hooks = Object.entries(config.hooks);
  if (!config.enabled) {
    return [out.line("off", "All hooks are off"), ...hooks.map(([hook, enabled]) => out.line("off", hook, enabled ? "on, but everything is off" : "off"))];
  }
  return [out.line("done", "Hooks are on"), ...hooks.map(([hook, enabled]) => (enabled ? out.line("done", hook) : out.line("off", hook, "off")))];
}

export function selectionBlocks(off: string[], total: number): Block[] {
  if (off.length === 0) return [out.line("done", "All hooks run")];
  if (off.length === total) return [out.line("off", "All hooks are off")];
  return [out.line("off", `${off.length} ${off.length === 1 ? "hook" : "hooks"} off`, off.join(", "))];
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function toggleHooks(args: string[], ctx: CommandContext): Promise<void> {
  const { repoName, repoRoot, dataDir, remoteUrl } = ctx.identity!;
  const discoveredHooks = discoverHooks(repoRoot);

  if (discoveredHooks.length === 0) {
    out.fail({ title: "This repo has no husky hooks", why: "rt turns hooks on and off for repos that keep them in a .husky folder." });
    process.exit(1);
  }

  const derivedIdentity = remoteUrl ? identityFromRemote(remoteUrl) : null;
  const repoIdentity = derivedIdentity && derivedIdentity.kind === "remote" ? derivedIdentity.id : null;
  if (repoIdentity === null) {
    out.note(out.line("refused", "This repo has no remote, so rt has nowhere to keep its hook choices"));
    process.exit(1);
  }
  const config = loadHooksConfig(discoveredHooks, repoIdentity);

  // Always regenerate shims and ensure hooksPath is set
  generateShims(dataDir, discoveredHooks);
  setHooksPath(repoRoot, dataDir);

  // Notify daemon to watch this repo's .git/config (best-effort, no-op if daemon not running).
  // The daemon's repo index is identity-keyed — send the serialized identity, not repoName's display form.
  import("../lib/daemon-client.ts")
    .then(({ daemonQuery }) => daemonQuery("hooks:watch", { repo: ctx.identity!.identity }))
    .catch(() => {});

  const sub = args[0];

  // ── rt hooks off ──────────────────────────────────────────────────────────

  if (sub === "off") {
    config.enabled = false;
    saveHooksConfig(config, repoIdentity);
    out.print(out.line("off", "All hooks are off", repoName), out.callout("note", "This applies in every git app: the terminal, Cursor, GitHub Desktop."));
    return;
  }

  // ── rt hooks on ───────────────────────────────────────────────────────────

  if (sub === "on") {
    config.enabled = true;
    // Also re-enable all individual hooks
    for (const hook of discoveredHooks) {
      config.hooks[hook] = true;
    }
    saveHooksConfig(config, repoIdentity);
    out.print(out.line("done", "All hooks are back on", repoName));
    return;
  }

  // ── rt hooks status ───────────────────────────────────────────────────────

  if (sub === "status") {
    out.print(...hooksStatusBlocks(config));
    return;
  }

  // ── rt hooks <hook-name> off/on ───────────────────────────────────────────

  if (sub && args[1] && (args[1] === "off" || args[1] === "on")) {
    const hookName = sub;
    const action = args[1];

    if (!(hookName in config.hooks)) {
      out.fail({ title: `This repo has no hook called ${hookName}`, why: `The hooks here are ${Object.keys(config.hooks).join(", ")}.` });
      process.exit(1);
    }

    config.hooks[hookName] = action === "on";
    saveHooksConfig(config, repoIdentity);

    out.print(action === "off" ? out.line("off", `${hookName} is off`, repoName) : out.line("done", `${hookName} is on`, repoName));
    return;
  }

  // ── rt hooks (interactive) ────────────────────────────────────────────────

  if (!process.stdin.isTTY) {
    out.print(...hooksStatusBlocks(config));
    return;
  }

  const { multiselect } = await import("../lib/rt-render.ts");

  const running = runningHooks(config, discoveredHooks);
  const selected = await multiselect({
    message: `Hooks that run in ${repoName}`,
    options: discoveredHooks.map((hook) => (running.includes(hook) ? { value: hook, label: hook } : { value: hook, label: hook, hint: "[disabled]" })),
    initialValues: running,
  });

  const next = applyHookSelection(config, discoveredHooks, selected);
  saveHooksConfig(next, repoIdentity);

  out.print(
    ...selectionBlocks(
      discoveredHooks.filter((h) => !next.hooks[h]),
      discoveredHooks.length,
    ),
  );
}

function runningHooks(config: HooksConfig, discoveredHooks: string[]): string[] {
  if (!config.enabled) return [];
  return discoveredHooks.filter((h) => config.hooks[h] !== false);
}

/**
 * Unticking every hook also clears `enabled`, so a hook added to .husky/
 * later stays off until something is ticked again.
 */
function applyHookSelection(config: HooksConfig, discoveredHooks: string[], selected: string[]): HooksConfig {
  const hooks = { ...config.hooks };
  for (const hook of discoveredHooks) hooks[hook] = selected.includes(hook);
  return { enabled: selected.length > 0, hooks };
}

// ─── Exported for tests ──────────────────────────────────────────────────────

export { applyHookSelection, discoverHooks, loadHooksConfig, runningHooks, saveHooksConfig, type HooksConfig };
