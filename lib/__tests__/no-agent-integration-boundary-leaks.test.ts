/**
 * Generic consumers reach a harness only through integration composition:
 * the registry (`builtins.ts`) and the few composition seams below. The
 * native protocol modules under lib/agent-integrations/{claude,codex}/ are
 * imported directly only by the files listed here, each with its reason.
 *
 * The list is a ratchet in both directions: a file that starts importing a
 * native module fails until it is listed (or, better, goes through the
 * integration), and a listed file that stops needing one fails until its row
 * is removed, so a migrated caller cannot leave a stale exception behind.
 * This complements the behaviour tests; it does not replace them.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..", "..");

type Why = "composition" | "native-entry" | "legacy";

type Allowed = { why: Why; reason: string; modules: string[] };

const C = "lib/agent-integrations/claude/";
const X = "lib/agent-integrations/codex/";

/**
 * composition: wires integrations into a registry, a service or the daemon.
 * native-entry: the harness itself calls this file (a hook program, a mod
 * transport verb, a harness-specific setup row), so it speaks that harness's
 * protocol by definition.
 * legacy: a generic consumer still reaching past the integration; migrate it
 * to the registry and delete its row.
 */
const ALLOWED: Record<string, Allowed> = {
  "lib/agent-integrations/builtins.ts": { why: "composition", reason: "the composition root of the built-in registry", modules: [`${C}integration.ts`, `${X}integration.ts`] },
  "lib/agent-integrations/worktrees.ts": { why: "composition", reason: "composes each harness's worktree lifecycle", modules: [`${X}worktrees.ts`] },
  "lib/setup/steps/agent-integrations.ts": { why: "composition", reason: "composes each harness's install steps", modules: [`${C}install.ts`, `${X}install.ts`] },
  "lib/skills/maintain-host.ts": { why: "composition", reason: "composes each harness's skills adapter for maintenance", modules: [`${C}skills.ts`, `${X}skills.ts`] },
  "lib/daemon.ts": { why: "composition", reason: "starts the Claude mod link service and relocation watcher with the daemon", modules: [`${C}mod-links.ts`, `${C}relocation.ts`] },

  "commands/agent-policy-hook.ts": { why: "native-entry", reason: "the program Codex runs as its policy hook", modules: [`${X}hook-manifest.ts`, `${X}policy.ts`] },
  "commands/worktree-hook.ts": { why: "native-entry", reason: "Claude Code's WorktreeCreate/WorktreeRemove hook", modules: [`${C}worktrees.ts`] },
  "lib/worktree/claude-hook.ts": { why: "native-entry", reason: "Claude Code's WorktreeCreate/WorktreeRemove hook", modules: [`${C}worktrees.ts`] },
  "lib/daemon/handlers/mod-session.ts": { why: "native-entry", reason: "the mod:* verbs the Claude Code mod calls", modules: [`${C}messaging.ts`, `${C}mod-links.ts`, `${C}sessions.ts`] },
  "lib/daemon/mod-link-hooks.ts": { why: "native-entry", reason: "the Claude mod link lifecycle hooks", modules: [`${C}mod-links.ts`, `${C}sessions.ts`] },
  "lib/daemon/handlers/policy.ts": { why: "native-entry", reason: "the policy:* verbs the Claude mod's tool.check calls", modules: [`${C}mod-links.ts`, `${C}mod-path.ts`] },
  "lib/daemon/handlers/relocation.ts": { why: "native-entry", reason: "the worktree:registered verb the Claude mod's relocation block calls", modules: [`${C}mod-links.ts`, `${C}mod-path.ts`, `${C}relocation.ts`] },
  "lib/daemon/handlers/stand-down.ts": { why: "native-entry", reason: "pushes stand-down to live Claude mod links", modules: [`${C}mod-links.ts`] },
  "lib/daemon/handlers/agent-integrations.ts": { why: "native-entry", reason: "agent:policy-receipt (Codex hook receipts) and the Claude mod link report", modules: [`${C}mod-links.ts`, `${C}mod-path.ts`, `${C}sessions.ts`, `${X}link.ts`, `${X}policy-receipts.ts`] },
  "commands/setup.ts": { why: "native-entry", reason: "rt setup codex-policy, the person's own Codex hook approval", modules: [`${X}policy-install.ts`, `${X}profile.ts`] },
  "lib/setup/validators/codex.ts": { why: "native-entry", reason: "the Codex setup rows", modules: [`${X}mcp-config.ts`, `${X}policy-install.ts`, `${X}profile.ts`, `${X}skills.ts`] },
  "lib/setup/uninstall.ts": { why: "native-entry", reason: "removes the Codex hook program uninstall recorded", modules: [`${X}policy-install.ts`] },

  "commands/chat.ts": { why: "legacy", reason: "chat sign-in reads the Claude session directly", modules: [`${C}sessions.ts`] },
  "lib/chat-session.ts": { why: "legacy", reason: "chat sign-in branches per harness", modules: [`${C}sessions.ts`, `${X}sign-in.ts`] },
  "lib/daemon/handlers/chat.ts": { why: "legacy", reason: "chat sign-in through the Claude mod", modules: [`${C}sessions.ts`] },
  "lib/agent-argv/claude.ts": { why: "legacy", reason: "the pre-integration rt agent argv builder", modules: [`${C}sessions.ts`] },
  "lib/agent-argv/index.ts": { why: "legacy", reason: "the pre-integration rt agent argv builder", modules: [`${C}sessions.ts`] },
  "lib/agent-integrations/context.ts": { why: "legacy", reason: "caller context reads the Claude mod path and Codex profile directly", modules: [`${C}mod-path.ts`, `${X}profile.ts`] },
  "lib/agent-integrations/legacy.ts": { why: "legacy", reason: "legacy session records map onto Codex profiles", modules: [`${X}profile.ts`] },
  "lib/daemon/command-router.ts": { why: "legacy", reason: "routes gate waits and mod commands to Claude directly", modules: [`${C}mod-links.ts`, `${C}questions.ts`, `${C}relocation.ts`, `${C}sessions.ts`] },
  "lib/daemon/gate-escape.ts": { why: "legacy", reason: "detects Claude's question form on screen", modules: [`${C}questions.ts`] },
  "lib/daemon/gate-push.ts": { why: "legacy", reason: "pushes gates to Claude's question form directly", modules: [`${C}questions.ts`] },
  "lib/daemon/reconciler.ts": { why: "legacy", reason: "detects Claude's question form on screen", modules: [`${C}questions.ts`] },
  "lib/daemon/handlers/agent.ts": { why: "legacy", reason: "writes the Claude gate hook settings for agent:start", modules: [`${C}hooks.ts`] },
  "lib/daemon/handlers/pane.ts": { why: "legacy", reason: "carries the Claude relocation watcher type", modules: [`${C}relocation.ts`] },
  "lib/daemon/herd-watchdog-adapters.ts": { why: "legacy", reason: "the watchdog nudges through Claude mod commands", modules: [`${C}mod-links.ts`, `${C}mod-path.ts`] },
  "lib/state/presence-store.ts": { why: "legacy", reason: "presence reads Claude mod execution state", modules: [`${C}mod-links.ts`] },
  "lib/mcp/temp-root-guard.ts": { why: "legacy", reason: "reads Codex plugin roots instead of the skills adapter", modules: [`${X}skills.ts`] },
  "lib/setup/skills-materialize.ts": { why: "legacy", reason: "reads the Codex plugin cache instead of the skills adapter", modules: [`${X}skills.ts`] },
  "lib/setup/steps/skills.ts": { why: "legacy", reason: "reads the Codex skills folder instead of the skills adapter", modules: [`${X}skills.ts`] },
  "lib/setup/validators/tools.ts": { why: "legacy", reason: "reads each harness's skills folder instead of the skills adapter", modules: [`${C}skills.ts`, `${X}skills.ts`] },
  "lib/skills/packs.ts": { why: "legacy", reason: "pack discovery reads each harness's settings and marketplaces directly", modules: [`${C}skills.ts`, `${X}skills.ts`] },
  "lib/skills/sources.ts": { why: "legacy", reason: "plugin discovery reads Claude's installed list directly", modules: [`${C}skills.ts`] },
  "lib/skills/sync.ts": { why: "legacy", reason: "pack sync calls Claude's skills operations directly", modules: [`${C}skills.ts`] },
  "lib/skills/writing-style-sources.ts": { why: "legacy", reason: "reads Claude's user skills folder directly", modules: [`${C}skills.ts`] },
  "commands/skills-writing-style.ts": { why: "legacy", reason: "reads Claude's user skills folder directly", modules: [`${C}skills.ts`] },
};

const NATIVE = /^lib\/agent-integrations\/(claude|codex)\//;
/** Static, type-only, dynamic and `typeof import()` forms alike. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

function isTest(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) || /\.test\.tsx?$/.test(path) || path.startsWith("e2e/") || /(^|\/)tests?\//.test(path);
}

function sources(): string[] {
  const res = spawnSync("git", ["ls-files", "-z", "--", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return res.stdout.split("\0").filter((p) => p && !isTest(p) && !NATIVE.test(p));
}

function nativeImports(path: string): string[] {
  const text = readFileSync(join(ROOT, path), "utf8");
  const found = new Set<string>();
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1]!;
    if (!spec.startsWith(".")) continue;
    const target = relative(ROOT, resolve(ROOT, dirname(path), spec));
    if (NATIVE.test(target)) found.add(target);
  }
  return [...found].sort();
}

describe("agent integration boundary", () => {
  const actual = new Map<string, string[]>();
  for (const path of sources()) {
    const imports = nativeImports(path);
    if (imports.length > 0) actual.set(path, imports);
  }

  test("no generic consumer imports a native protocol module outside the listed exceptions", () => {
    const leaks = [...actual.keys()].filter((path) => !ALLOWED[path]).map((path) => `${path} -> ${actual.get(path)!.join(", ")}`);
    expect(leaks).toEqual([]);
  });

  test("each exception names exactly the native modules its file imports", () => {
    const drift: string[] = [];
    for (const [path, allowed] of Object.entries(ALLOWED)) {
      const have = actual.get(path) ?? [];
      const want = [...allowed.modules].sort();
      if (have.join("\n") !== want.join("\n")) drift.push(`${path}: imports [${have.join(", ")}], listed [${want.join(", ")}]`);
    }
    expect(drift).toEqual([]);
  });

  test("every exception says why", () => {
    for (const [path, allowed] of Object.entries(ALLOWED)) {
      expect(["composition", "native-entry", "legacy"]).toContain(allowed.why);
      expect(allowed.reason.length, path).toBeGreaterThan(10);
    }
  });

  test("apps and packages never reach a native module", () => {
    expect([...actual.keys()].filter((p) => p.startsWith("apps/") || p.startsWith("packages/"))).toEqual([]);
  });
});
