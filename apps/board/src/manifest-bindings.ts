import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { BoardConfig } from './config.ts';
import { projectPathFromWebUrl } from './data.ts';

export type BoardSkillKind = 'review' | 'respond' | 'doctor';

/** Strip full-line `//` comments from JSONC text. Only lines whose trimmed
    content starts with `//` are removed, so a `//` inside a string value
    (e.g. a `https://` URL) survives. The per-pack skills.jsonc that
    `rt skills materialize` writes opens with a `//` provenance header. */
export function stripJsonc(raw: string): string {
  return raw
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

export interface ResolvedBoardSkill {
  skill: string;
  source: 'manifest' | 'config';
  pack: string | null;
}

/** review and respond have no config fallback, so theirs is "" (the generic
    wrapper); doctor's is cfg.doctorSkill. */
function configSkillFor(kind: BoardSkillKind, cfg: BoardConfig): string {
  return kind === 'doctor' ? cfg.doctorSkill : '';
}

/** Slug a GitLab host + project path into the `~/.mattstack/repos/<slug>` dir
    name: the host (scheme and credentials stripped, truncated at the first
    "/", lowercased) and the project path joined by "-", with every "/" in the
    project path also "-". E.g. "https://gitlab.example.com" + "acme/widgets"
    -> "gitlab.example.com-acme-widgets". Must stay identical to the slug rule
    `rt skills materialize` writes the per-pack files under. */
export function boardRepoSlug(gitlabHost: string, project: string): string {
  const host = gitlabHost
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .split('/')[0]!
    .toLowerCase();
  return `${host}-${project.replace(/\//g, '-')}`;
}

/** Same grammar the wrapper's resolve-args.sh enforces on MATTSTACK_PACK. */
const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The pack a launch resolves bindings with: the launching tab's pack, else
    the board's default pack, else none. A pack becomes a path segment, so
    one outside the pack-name grammar counts as none. */
export function packForLaunch(
  cfg: BoardConfig,
  tabId: string | undefined
): string | null {
  const tab = tabId ? cfg.tabs.find(t => t.id === tabId) : undefined;
  const pack = tab?.pack || cfg.defaultPack;
  if (!pack || !PACK_NAME_RE.test(pack)) return null;
  return pack;
}

/**
 * Resolve which skill a board launch should use for `project` under `pack`:
 * `bindings["board:<kind>"].<kind>` from the per-pack file
 * `repos/<slug>/packs/<pack>/skills.jsonc` that `rt skills materialize`
 * writes, else `cfg`'s own skill for `kind`. The inner key is the wrapper's
 * slot name so the wrapper's resolve-args.sh reads the same entry.
 *
 * Never throws: no pack, a missing or malformed file, an absent binding, or
 * an empty slot all fall back to config, so a repo without a pack's bindings
 * can never break a launch.
 */
export function resolveBoardSkill(
  kind: BoardSkillKind,
  project: string,
  cfg: BoardConfig,
  pack: string | null,
  mattstackHome?: string
): ResolvedBoardSkill {
  const fallback: ResolvedBoardSkill = {
    skill: configSkillFor(kind, cfg),
    source: 'config',
    pack,
  };
  if (!pack) return fallback;

  const home = mattstackHome ?? join(homedir(), '.mattstack');
  const manifestPath = join(
    home,
    'repos',
    boardRepoSlug(cfg.gitlabHost, project),
    'packs',
    pack,
    'skills.jsonc'
  );
  if (!existsSync(manifestPath)) return fallback;

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return fallback;

  const bindings = (parsed as Record<string, unknown>).bindings;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings))
    return fallback;

  const binding = (bindings as Record<string, unknown>)[`board:${kind}`];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding))
    return fallback;

  const skill = (binding as Record<string, unknown>)[kind];
  if (typeof skill !== 'string' || skill === '') return fallback;

  return { skill, source: 'manifest', pack };
}

/** Resolve and log the skill a launch uses for the MR at `mrUrl`. Every
    launch site (server.ts and bin/triage.ts) goes through here so the
    "<kind> skill: <skill> (<source>, <pack>)" log line has one shape. */
export function resolveLaunchSkill(
  kind: BoardSkillKind,
  mrUrl: string,
  cfg: BoardConfig,
  pack: string | null,
  mattstackHome?: string
): string {
  const project = projectPathFromWebUrl(mrUrl, cfg.gitlabHost);
  const resolved: ResolvedBoardSkill = project
    ? resolveBoardSkill(kind, project, cfg, pack, mattstackHome)
    : { skill: configSkillFor(kind, cfg), source: 'config', pack };
  console.log(
    `${kind} skill: ${resolved.skill} (${resolved.source}, ${resolved.pack ? `pack ${resolved.pack}` : 'no pack'})`
  );
  return resolved.skill;
}
