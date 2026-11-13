import {
  activeTeamRoster,
  getSetting,
  mayOfferGitLabTokenToHost,
} from '@mattstack/rt-client';
import { type Forge, GITHUB_BASE_URL } from '../../shared/forge.js';
import type { RangePreset } from '../../shared/types.js';

/** Politeness cap on concurrent GitLab requests; a code constant since the fold. */
export const CONCURRENCY = 6;

/** Configuration missing or unusable; routes surface it as a 400, not a 500. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface RosterEntry {
  username: string;
  name?: string;
  teams?: string[];
}

/** The fetchers' connection envelope; assembled per run from settings + secrets. */
export interface Env {
  baseUrl: string;
  forge?: Forge;
  token: string;
  linearApiKey?: string;
}

export interface BoxscoreSettings {
  forge?: Forge;
  projects: string[];
  roster: RosterEntry[];
  /** Everyone in the org, whatever their team: who counts as a known person rather than a bot. */
  orgRoster: RosterEntry[];
  hiddenMembers: string[];
  /** Roster usernames minus hiddenMembers: the leaderboard's comparison set. */
  users: string[];
  doneStates: string[];
  sizeBand: { tooSmall: number; tooLarge: number };
  excludeFilePatterns: string[];
  ignoredMrs: string[];
  botPatterns: string[];
  defaultRange: RangePreset;
  /** The only host the GitLab token goes to; "" = no host the person may send it to. */
  baseUrl: string;
  /** The team-declared host, shown in the setup hint and never fetched with the token. "" = none declared. */
  declaredHost: string;
  /** Raw `boxscore.roles`; resolveViewer validates it. */
  roles: unknown;
}

export type SettingReader = <T>(key: string) => T | undefined;

const storeReader: SettingReader = <T>(key: string): T | undefined =>
  getSetting<T | undefined>(key).value;

let reader: SettingReader | null = null;

/** Test seam. Vitest must inject; the store-backed reader would read the developer's real stores. */
export function __setSettingReader(r: SettingReader | null): void {
  reader = r;
}

let rosterReader: (() => RosterEntry[]) | null = null;

/** Test seam, like __setSettingReader. */
export function __setRosterReader(r: (() => RosterEntry[]) | null): void {
  rosterReader = r;
}

function teamRoster(): RosterEntry[] {
  if (rosterReader) return rosterReader();
  if (process.env.VITEST)
    throw new Error('tests must inject a roster reader (__setRosterReader)');
  return activeTeamRoster() as RosterEntry[];
}

function rosterEntries(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is RosterEntry =>
      e !== null &&
      typeof e === 'object' &&
      typeof (e as { username?: unknown }).username === 'string'
  );
}

function read<T>(key: string): T | undefined {
  if (reader) return reader<T>(key);
  if (process.env.VITEST)
    throw new Error('tests must inject a setting reader (__setSettingReader)');
  return storeReader<T>(key);
}

interface Integrations {
  forge?: { host?: string; provider?: string };
}

const BARE_HOST = /^[a-z0-9.-]+(:\d+)?$/i;

function hostOf(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

/** The confirmed host when it may take a GitLab token, else a declared gitlab.com; never any other declared host. */
function trustedGitLabHost(declared: string, confirmed: unknown): string {
  if (typeof confirmed === 'string' && BARE_HOST.test(confirmed)) {
    const host = confirmed.toLowerCase();
    if (mayOfferGitLabTokenToHost(host, confirmed)) return host;
  }
  return mayOfferGitLabTokenToHost(declared, null) ? declared : '';
}

/** Every read resolves the stores fresh; nothing here caches across calls (spec 5.3). */
export function readSettings(): BoxscoreSettings {
  const roster = teamRoster();
  const hiddenMembers = read<string[]>('boxscore.hiddenMembers') ?? [];
  const hidden = new Set(hiddenMembers);
  const integrations = read<Integrations>('mattstack.integrations') ?? {};
  const declaredHost = hostOf(integrations.forge?.host);
  const confirmed = read<{ forgeHost?: unknown }>('rt.integrations')?.forgeHost;
  const forge: Forge =
    integrations.forge?.provider === 'github' ? 'github' : 'gitlab';
  const baseUrl =
    forge === 'github'
      ? declaredHost === '' || declaredHost === 'github.com'
        ? GITHUB_BASE_URL
        : ''
      : (() => {
          const trusted = trustedGitLabHost(declaredHost, confirmed);
          return trusted ? `https://${trusted}` : '';
        })();
  return {
    forge,
    projects: read<string[]>('boxscore.projects') ?? [],
    roster,
    orgRoster: rosterEntries(read<unknown>('mattstack.roster')),
    hiddenMembers,
    users: roster.filter(m => !hidden.has(m.username)).map(m => m.username),
    doneStates: read<string[]>('boxscore.linearDoneStates') ?? [],
    sizeBand: read<{ tooSmall: number; tooLarge: number }>(
      'boxscore.sizeBand'
    ) ?? { tooSmall: 10, tooLarge: 400 },
    excludeFilePatterns: read<string[]>('boxscore.excludeFilePatterns') ?? [],
    ignoredMrs: read<string[]>('boxscore.ignoredMrs') ?? [],
    botPatterns: read<string[]>('boxscore.botPatterns') ?? [],
    defaultRange: read<RangePreset>('boxscore.defaultRange') ?? '30d',
    baseUrl,
    declaredHost,
    roles: read<unknown>('boxscore.roles') ?? {},
  };
}
