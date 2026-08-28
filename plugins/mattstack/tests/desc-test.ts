#!/usr/bin/env bun
/**
 * desc-test.ts -- selection micro-test for skill descriptions.
 *
 * Builds a roster (name + description) from every skills/<dir>/SKILL.md, then
 * for each scenario in desc-test/scenarios.json fires REPS fresh single-shot
 * `claude -p` picks (haiku by default) that must choose a skill from the
 * roster alone. Run it BEFORE and AFTER a description edit; a regression
 * means the new wording lost a trigger -- tighten it, don't ship it.
 *
 * Usage: bun run desc-test [--reps 5] [--model haiku] [--scenarios <path>]
 * Pass = every rep of every scenario picks the expected skill (a single miss
 * is variance worth a human read, per superpowers:writing-skills).
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Scenario {
  task: string;
  expect: string;
}

export function parseFrontmatter(
  text: string,
): { name: string; description: string; hidden: boolean } | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const nameMatch = fm.match(/^name:\s*(\S+)\s*$/m);
  if (!nameMatch) return null;
  const folded = fm.match(/^description:\s*>-\n((?:  .*\n?)*)/m);
  const single = fm.match(/^description:\s*(.+)$/m);
  const raw = folded ? folded[1] : single ? single[1] : null;
  if (raw === null) return null;
  const hidden = /^disable-model-invocation:\s*true\s*$/m.test(fm);
  return {
    name: nameMatch[1],
    description: raw.split(/\s+/).filter(Boolean).join(" "),
    hidden,
  };
}

/** Roster from a repo root: skills/<category>/<skill>/SKILL.md, the pack's
 *  compiled verbs at skills/<verb>/SKILL.md, and plugin/skills/<skill>/SKILL.md.
 *  Hidden (disable-model-invocation) skills are excluded, matching the
 *  platform's listing behavior. */
export function buildRoster(repoRoot: string): string {
  const entries: { name: string; description: string }[] = [];
  const addSkillDir = (dir: string) => {
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) return;
    const parsed = parseFrontmatter(readFileSync(skillPath, "utf8"));
    if (parsed && !parsed.hidden) entries.push(parsed);
  };
  const skillsRoot = join(repoRoot, "skills");
  if (existsSync(skillsRoot)) {
    for (const cat of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!cat.isDirectory()) continue;
      const catDir = join(skillsRoot, cat.name);
      // A compiled verb sits flat (skills/<name>/SKILL.md); hand-authored
      // skills sit one category deep. A dir with its own SKILL.md is a skill,
      // never a category.
      if (existsSync(join(catDir, "SKILL.md"))) {
        addSkillDir(catDir);
        continue;
      }
      for (const s of readdirSync(catDir, { withFileTypes: true })) {
        if (s.isDirectory()) addSkillDir(join(catDir, s.name));
      }
    }
  }
  const pluginRoot = join(repoRoot, "plugin", "skills");
  if (existsSync(pluginRoot)) {
    for (const s of readdirSync(pluginRoot, { withFileTypes: true })) {
      if (s.isDirectory()) addSkillDir(join(pluginRoot, s.name));
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries.map((e) => `- **${e.name}**: ${e.description}\n`).join("");
}

export function scoreRuns(
  picks: string[],
  expected: string,
): { correct: number; total: number; pass: boolean } {
  const clean = (s: string) => s.trim().replace(/^[`'"*\s]+|[`'"*\s.]+$/g, "");
  const correct = picks.filter((p) => clean(p) === expected).length;
  return { correct, total: picks.length, pass: correct === picks.length };
}

async function pickOnce(roster: string, task: string, model: string): Promise<string> {
  const prompt =
    `You are choosing which skill to invoke for a task, based only on this ` +
    `roster of skill names + descriptions. Use no tools.\n\n${roster}\n` +
    `Task: "${task}"\n\nReply with exactly one skill name from the roster and nothing else.`;
  const proc = Bun.spawn(["claude", "-p", prompt, "--model", model], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`claude -p failed: ${await new Response(proc.stderr).text()}`);
  }
  return out;
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "..");
  const reps = Number(arg("--reps", "5"));
  const model = arg("--model", "haiku");
  const scenariosPath = arg("--scenarios", join(repoRoot, "tests", "desc-test-scenarios.json"));
  const rosterRoot = arg("--root", repoRoot);

  const scenarios: Scenario[] = JSON.parse(readFileSync(scenariosPath, "utf8"));
  const roster = buildRoster(rosterRoot);
  console.log(`${roster.split("\n").filter(Boolean).length} skills in roster; ` +
    `${scenarios.length} scenarios x ${reps} reps on ${model}\n`);

  let failed = 0;
  for (const s of scenarios) {
    const picks = await Promise.all(
      Array.from({ length: reps }, () => pickOnce(roster, s.task, model)),
    );
    const score = scoreRuns(picks, s.expect);
    if (!score.pass) failed++;
    const detail = score.pass
      ? ""
      : `  picks: ${picks.map((p) => p.trim()).join(", ")}`;
    console.log(
      `${score.pass ? "PASS" : "FAIL"} ${score.correct}/${score.total}  ` +
        `${s.expect}  <- "${s.task}"${detail}`,
    );
  }
  if (failed > 0) {
    console.error(`\n${failed} scenario(s) regressed -- read the stray picks, tighten the wording, re-run.`);
    process.exit(1);
  }
  console.log("\nAll scenarios pass.");
}
