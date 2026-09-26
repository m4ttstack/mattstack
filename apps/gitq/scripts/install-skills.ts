#!/usr/bin/env bun
/** Symlink each skills/<dir> (with a `name:` in its SKILL.md frontmatter)
    into ~/.claude/skills/<name>, so board-launched panes and manual
    sessions can invoke them as /gitq:<action>. Idempotent. An alternate
    destination dir can be passed as the first argument (used by tests). */
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ROOT = join(import.meta.dir, '..');
const SKILLS_SRC = join(ROOT, 'skills');
const dest = process.argv[2] ?? join(homedir(), '.claude', 'skills');

function skillName(dir: string): string | null {
  const md = join(SKILLS_SRC, dir, 'SKILL.md');
  if (!existsSync(md)) return null;
  const match = readFileSync(md, 'utf8').match(/^name:\s*(\S+)\s*$/m);
  return match ? match[1]! : null;
}

mkdirSync(dest, { recursive: true });
for (const dir of readdirSync(SKILLS_SRC)) {
  if (!statSync(join(SKILLS_SRC, dir)).isDirectory()) continue;
  const name = skillName(dir);
  if (!name) continue;
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
