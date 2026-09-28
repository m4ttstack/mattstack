/**
 * rt skills expand -- paste mattstack attachments into hand-written skills.
 *
 *   rt skills expand --src <dir> --out <dir> [--mattstack-dir <root>] [--check] [--strict] [--dry-run] [--json]
 *
 * The source dir holds one directory per skill; each SKILL.md may carry
 * `{{include:<attachment>}}` lines and nothing else placeholder-shaped. The
 * output dir is owned by expand: every dir in it is regenerated or removed.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { TREE } from "../lib/command-tree-def.ts";
import { listAgentSafe } from "../lib/command-tree-resolve.ts";
import { mcpTools } from "../lib/mcp/tools.ts";
import { checkExpanded, expandSkills, writeExpanded, type ExpandDrift, type ExpandedSkill } from "../lib/skills/expand.ts";
import { deriveRules, formatHit, isScriptPath, lintScriptFile, lintSkillText } from "../lib/skills/mcp-lint.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir } from "../lib/skills/sources.ts";

type Flags = { src: string; out: string; mattstackDir: string | null; check: boolean; strict: boolean; dryRun: boolean; json: boolean };

function fail(message: string): never {
  console.error(`rt skills expand: ${message}`);
  process.exit(1);
}

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { src: "", out: "", mattstackDir: null, check: false, strict: false, dryRun: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--src": flags.src = requireFlagValue(a, args[++i]); break;
      case "--out": flags.out = requireFlagValue(a, args[++i]); break;
      case "--mattstack-dir": flags.mattstackDir = requireFlagValue(a, args[++i]); break;
      case "--check": flags.check = true; break;
      case "--strict": flags.strict = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--json": flags.json = true; break;
      default: fail(`unknown flag ${a}`);
    }
  }
  if (!flags.src) fail("--src <dir> is required");
  if (!flags.out) fail("--out <dir> is required");
  return flags;
}

/**
 * Lints the expansion in memory, so --check and --dry-run see what a write
 * would produce. Script hits are advisory, as they are for `skills check`:
 * they go to stderr and never fail the run.
 */
function lintExpanded(outDir: string, skills: ExpandedSkill[]): string[] {
  const rules = deriveRules(
    mcpTools(),
    listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd })),
  );
  const lint: string[] = [];
  for (const s of skills) {
    const home = join(outDir, s.name);
    lint.push(...lintSkillText(s.skillMd, join(home, "SKILL.md"), rules).map(formatHit));
    for (const f of s.files) {
      if (f.path.endsWith(".md")) {
        lint.push(...lintSkillText(readFileSync(f.copyFrom, "utf8"), join(home, f.path), rules).map(formatHit));
      } else if (isScriptPath(f.path)) {
        for (const hit of lintScriptFile(readFileSync(f.copyFrom, "utf8"), join(home, f.path), rules)) {
          console.error(`(advisory) ${formatHit(hit)}`);
        }
      }
    }
  }
  return lint;
}

function emit(flags: Flags, payload: { ok: boolean; mode: "expand" | "check"; skills: string[]; removed: string[]; drift: ExpandDrift[]; lint: string[] }, lines: string[]): void {
  if (flags.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  for (const line of lines) console.log(line);
}

export async function skillsExpand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const roots = flags.mattstackDir ? resolvePluginRootsFromDir(flags.mattstackDir) : resolvePluginRoots();

  let skills: ExpandedSkill[];
  try {
    skills = expandSkills({ srcDir: flags.src, outDir: flags.out, roots });
  } catch (err) {
    fail((err as Error).message);
  }

  const lint = flags.strict ? lintExpanded(flags.out, skills) : [];

  if (flags.check) {
    const drift = checkExpanded(flags.out, skills);
    const ok = drift.length === 0 && lint.length === 0;
    emit(flags, { ok, mode: "check", skills: skills.map((s) => s.name), removed: [], drift, lint }, ok ? [`expanded skills current (${skills.length})`] : []);
    if (!ok) {
      for (const d of drift) console.error(`${d.skill}: ${d.causes.join(", ")}`);
      for (const hit of lint) console.error(hit);
      process.exit(1);
    }
    return;
  }

  const result = flags.dryRun ? { written: skills.map((s) => s.name), removed: [] as string[] } : writeExpanded(flags.out, skills);
  const lines = [...result.written.map((n) => `+ ${n}`), ...result.removed.map((n) => `- ${n}`)];
  emit(flags, { ok: lint.length === 0, mode: "expand", skills: result.written, removed: result.removed, drift: [], lint }, lines);
  if (lint.length > 0) {
    for (const hit of lint) console.error(hit);
    process.exit(1);
  }
}
