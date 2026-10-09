#!/usr/bin/env bun
/** Symlink each skills/<dir> (with a `name:` in its SKILL.md frontmatter)
    into a harness's own skills folder as <name>, so board-launched panes and
    manual sessions can invoke them as gitq:<action>. Idempotent.

    With the harness integrations switch off that folder is
    ~/.claude/skills, as always. With it on, it is the folder of each
    harness turned on (Codex's is $CODEX_HOME/skills). `--harness <id>`
    picks one harness, and a folder given as the last argument replaces its
    default (used by tests).

    gitq's skills name no Claude-only variable, so skills/ is also their
    Codex build; a skill that does is not linked for Codex. */
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { enabledHarnesses, integrationsSwitchOn } from '@mattstack/rt-client';

const ROOT = join(import.meta.dir, '..');
const SKILLS_SRC = join(ROOT, 'skills');
const HOME = process.env.HOME ?? homedir();

function skillsDirFor(harness: string): string | null {
  if (harness === 'claude') return join(HOME, '.claude', 'skills');
  if (harness === 'codex') return join(process.env.CODEX_HOME || join(HOME, '.codex'), 'skills');
  return null;
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
  return chosen.map((harness) => {
    const dest = args.dest ?? skillsDirFor(harness);
    if (dest === null || skillsDirFor(harness) === null) {
      console.error(`gitq has no skills for ${harness}`);
      process.exit(1);
    }
    return { harness, dest };
  });
}

function skillName(dir: string): string | null {
  const md = join(SKILLS_SRC, dir, 'SKILL.md');
  if (!existsSync(md)) return null;
  const match = readFileSync(md, 'utf8').match(/^name:\s*(\S+)\s*$/m);
  return match ? match[1]! : null;
}

function claudeOnly(dir: string): boolean {
  return readFileSync(join(SKILLS_SRC, dir, 'SKILL.md'), 'utf8').includes('${CLAUDE_');
}

function linkInto(harness: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const dir of readdirSync(SKILLS_SRC)) {
    if (!statSync(join(SKILLS_SRC, dir)).isDirectory()) continue;
    const name = skillName(dir);
    if (!name) continue;
    if (harness !== 'claude' && claudeOnly(dir)) {
      console.error(`skip    ${name}: it names a Claude-only variable, so it has no ${harness} build`);
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

const chosen = targets();
if (chosen.length === 0) console.log('No agent is turned on, so no skills were linked.');
for (const { harness, dest } of chosen) linkInto(harness, dest);
