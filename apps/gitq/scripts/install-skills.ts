#!/usr/bin/env bun
/** Symlink each skills/<dir> (with a `name:` in its SKILL.md frontmatter)
    into a harness's own skills folder as <name>, so board-launched panes and
    manual sessions can invoke them as gitq:<action>. Idempotent.

    With the harness integrations switch off that folder is
    ~/.claude/skills, as always. With it on, it is the folder of each
    harness turned on (Codex's is $CODEX_HOME/skills). `--harness <id>`
    picks one harness, and a folder given as the last argument replaces its
    default (used by tests).

    gitq's skills name no Claude-only variable and no harness fragment, so
    skills/ is also their Codex build; a skill with a file that does is not
    linked for another harness. An id gitq has no skills for is skipped. */
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { codexHomeFor, enabledHarnesses, integrationsSwitchOn } from '@mattstack/rt-client';

const ROOT = join(import.meta.dir, '..');
const SKILLS_SRC = join(ROOT, 'skills');
const HOME = process.env.HOME ?? homedir();

/** The harness's own skills folder, or why gitq cannot link into it. */
function skillsDirFor(harness: string): { dir: string } | { skip: string } {
  if (harness === 'claude') return { dir: join(HOME, '.claude', 'skills') };
  if (harness === 'codex') {
    const home = codexHomeFor({ ...process.env, HOME });
    return home.ok ? { dir: join(home.data, 'skills') } : { skip: home.error.message };
  }
  return { skip: `gitq has no skills for ${harness}` };
}

function parseArgs(argv: string[]): { harness?: string; dest?: string } {
  const out: { harness?: string; dest?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--harness') out.harness = argv[++i];
    else out.dest = argv[i];
  }
  return out;
}

function targets(): { harness: string; dest: string }[] {
  const args = parseArgs(process.argv.slice(2));
  const chosen = args.harness !== undefined ? [args.harness] : integrationsSwitchOn() && !args.dest ? enabledHarnesses() : ['claude'];
  return chosen.flatMap((harness) => {
    const found = skillsDirFor(harness);
    if ('skip' in found) {
      console.error(`skip    ${harness}: ${found.skip}`);
      return [];
    }
    return [{ harness, dest: args.dest ?? found.dir }];
  });
}

function skillName(dir: string): string | null {
  const md = join(SKILLS_SRC, dir, 'SKILL.md');
  if (!existsSync(md)) return null;
  const match = readFileSync(md, 'utf8').match(/^name:\s*(\S+)\s*$/m);
  return match ? match[1]! : null;
}

const CLAUDE_ONLY_MARKERS = ['${CLAUDE_', '{{harness:'];

/** The first file under a skill folder that only Claude's build can carry as written, relative to it; null when none does. */
export function claudeOnlyFile(skillDir: string, rel = ''): string | null {
  for (const entry of readdirSync(join(skillDir, rel), { withFileTypes: true })) {
    const path = rel ? join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const found = claudeOnlyFile(skillDir, path);
      if (found) return found;
    } else if (entry.isFile()) {
      const text = readFileSync(join(skillDir, path), 'utf8');
      if (CLAUDE_ONLY_MARKERS.some((m) => text.includes(m))) return path;
    }
  }
  return null;
}

function linkInto(harness: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const dir of readdirSync(SKILLS_SRC)) {
    if (!statSync(join(SKILLS_SRC, dir)).isDirectory()) continue;
    const name = skillName(dir);
    if (!name) continue;
    const claudeOnly = harness === 'claude' ? null : claudeOnlyFile(join(SKILLS_SRC, dir));
    if (claudeOnly) {
      console.error(`skip    ${name}: ${claudeOnly} is written for Claude's build only, so it has no ${harness} build`);
      continue;
    }
    const src = join(SKILLS_SRC, dir);
    const link = join(dest, name);
    let existing: string | null = null;
    try {
      existing = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : 'not-a-symlink';
    } catch {
      // nothing at the link path yet
    }
    if (existing === src) {
      console.log(`ok      ${name} -> ${src}`);
      continue;
    }
    if (existing === 'not-a-symlink') {
      console.error(`skip    ${name}: ${link} exists and is not a symlink; remove it and re-run`);
      continue;
    }
    if (existing !== null) rmSync(link);
    symlinkSync(src, link);
    console.log(`linked  ${name} -> ${src}`);
  }
}

if (import.meta.main) {
  const chosen = targets();
  if (chosen.length === 0) console.log('No skills were linked: no agent gitq has skills for is turned on.');
  for (const { harness, dest } of chosen) linkInto(harness, dest);
}
