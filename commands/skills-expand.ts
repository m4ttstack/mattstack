/**
 * rt skills expand -- paste mattstack attachments into hand-written skills.
 *
 *   rt skills expand --src <dir> --out <dir> [--mattstack-dir <root>] [--check] [--strict] [--dry-run] [--json]
 *
 * The source dir holds one directory per skill; each SKILL.md may carry
 * `{{include:<attachment>}}` lines and nothing else placeholder-shaped. The
 * output dir is owned by expand: every dir in it is regenerated or removed,
 * and a dir expand did not write stops the run before anything is touched.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { TREE } from "../lib/command-tree-def.ts";
import { listAgentSafe } from "../lib/command-tree-resolve.ts";
import { mcpTools } from "../lib/mcp/tools.ts";
import { checkExpanded, expandSkills, planRemoval, writeExpanded, type ExpandDrift, type ExpandedSkill } from "../lib/skills/expand.ts";
import { deriveRules, formatHit, isScriptPath, lintScriptFile, lintSkillText } from "../lib/skills/mcp-lint.ts";
import { resolvePluginRoots, resolvePluginRootsFromDir } from "../lib/skills/sources.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

type Flags = { src: string; out: string; mattstackDir: string | null; check: boolean; strict: boolean; dryRun: boolean; json: boolean };

function fail(failure: out.FailureInput): never {
  out.fail(failure);
  process.exit(1);
}

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) fail({ title: `${flag} needs a value` });
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
      default: fail({ title: `rt skills expand does not take ${a}` });
    }
  }
  if (!flags.src) fail(usageFailure("Which folder holds the skills to expand?", "rt skills expand --src <dir> --out <dir>"));
  if (!flags.out) fail(usageFailure("Which folder should the expanded skills go in?", "rt skills expand --src <dir> --out <dir>"));
  return flags;
}

/**
 * Lints the expansion in memory, so --check and --dry-run see what a write
 * would produce. Script hits are advisory, as they are for `skills check`:
 * they go to stderr as one advisory block and never fail the run.
 */
function lintExpanded(outDir: string, skills: ExpandedSkill[]): { lint: string[]; advisory: string[] } {
  const rules = deriveRules(
    mcpTools(),
    listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd })),
  );
  const lint: string[] = [];
  const advisory: string[] = [];
  for (const s of skills) {
    const home = join(outDir, s.name);
    lint.push(...lintSkillText(s.skillMd, join(home, "SKILL.md"), rules).map(formatHit));
    for (const f of s.files) {
      if (f.path.endsWith(".md")) {
        lint.push(...lintSkillText(readFileSync(f.copyFrom, "utf8"), join(home, f.path), rules).map(formatHit));
      } else if (isScriptPath(f.path)) {
        advisory.push(...lintScriptFile(readFileSync(f.copyFrom, "utf8"), join(home, f.path), rules).map(formatHit));
      }
    }
  }
  return { lint, advisory };
}

function emit(flags: Flags, payload: { ok: boolean; mode: "expand" | "check"; skills: string[]; removed: string[]; drift: ExpandDrift[]; lint: string[] }, blocks: Block[]): void {
  if (flags.json) {
    out.json(payload);
    return;
  }
  out.print(...blocks);
}

const hits = (n: number): string => `${n} lint ${n === 1 ? "hit" : "hits"}`;

export async function skillsExpand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const roots = flags.mattstackDir ? resolvePluginRootsFromDir(flags.mattstackDir) : resolvePluginRoots();

  let skills: ExpandedSkill[];
  try {
    skills = expandSkills({ srcDir: flags.src, outDir: flags.out, roots });
  } catch (err) {
    fail({ title: (err as Error).message });
  }

  const { lint, advisory } = flags.strict ? lintExpanded(flags.out, skills) : { lint: [], advisory: [] };
  if (advisory.length > 0) out.note(out.verbatim(advisory, "advisory"));

  if (flags.check) {
    const drift = checkExpanded(flags.out, skills);
    const ok = drift.length === 0 && lint.length === 0;
    emit(
      flags,
      { ok, mode: "check", skills: skills.map((s) => s.name), removed: [], drift, lint },
      ok ? [out.line("done", "The expanded skills are current", `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`)] : [],
    );
    if (!ok) {
      fail({
        title: drift.length > 0 ? "The expanded skills are out of date" : `The expanded skills have ${hits(lint.length)}`,
        ...(drift.length > 0 ? { next: out.cmd(`rt skills expand --src ${flags.src} --out ${flags.out}${flags.mattstackDir ? ` --mattstack-dir ${flags.mattstackDir}` : ""}`) } : {}),
        details: [...drift.map((d) => `${d.skill}: ${d.causes.join(", ")}`), ...lint].join("\n"),
      });
    }
    return;
  }

  let result: { written: string[]; removed: string[] };
  try {
    result = flags.dryRun ? { written: skills.map((s) => s.name), removed: planRemoval(flags.out, skills) } : writeExpanded(flags.out, skills);
  } catch (err) {
    fail({ title: (err as Error).message });
  }
  const rows = [
    ...result.written.map((name) => ({ op: "+" as const, name, ...(flags.dryRun ? { hint: "would write" } : {}) })),
    ...result.removed.map((name) => ({ op: "-" as const, name, ...(flags.dryRun ? { hint: "would remove" } : {}) })),
  ];
  emit(flags, { ok: lint.length === 0, mode: "expand", skills: result.written, removed: result.removed, drift: [], lint }, rows.length > 0 ? [out.changes(rows)] : []);
  if (lint.length > 0) fail({ title: `${hits(lint.length)} in the expanded skills`, details: lint.join("\n") });
}
