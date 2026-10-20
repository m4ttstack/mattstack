import {
  activeTeam,
  activeTeamPack,
  channelsOfKind,
  directoryEntry,
  getDef,
  getSetting,
  identityFromRemote,
  mergeTeamRoster,
  normalizeChannel,
  orgStoreRefusal,
  serializeIdentity,
  setSetting,
  switchboardUrl,
  teamChannels,
  type RepoIdentity,
  type RosterEntry,
  type TeamDirectory,
} from '@mattstack/rt-client';
import {
  readBoardSecrets,
  type BoardSecretsData,
  type BoardSecretsDeps,
} from './board-secrets.ts';
import { shellSingleQuote } from './shell-quote.ts';
import {
  DEFAULT_SLACK_EMOJI,
  type SlackEmojiAliases,
  type SlackEmojiConfig,
} from './slack-emoji.ts';

/** A bare "host/path" config value (not a full remote URL) never matches
    identityFromRemote's URL/scp-like parsing — it has no scheme and no
    colon. Treat it as an already-normalized remote identity directly,
    lowercasing only the host segment (parity with normalizeRemote). */
function hostPathToIdentity(value: string): RepoIdentity | null {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return null;
  const host = value.slice(0, slash).toLowerCase();
  const path = value.slice(slash + 1);
  return { kind: 'remote', id: `${host}/${path}` };
}

/** Encode one rtRepos value for the daemon boundary: identityFromRemote
    first (covers a pasted full remote URL, and any fork/multi-remote
    override keyed on that exact string), else the bare host/path adapter.
    Null propagates — an unmapped or malformed value must surface as a
    fetchError, never reach the identity-only daemon as a bare string. */
export function repoIdentityField(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const identity = identityFromRemote(value) ?? hostPathToIdentity(value);
  return identity ? serializeIdentity(identity) : null;
}

/**
 * A GitLab project's rt identity is its host plus its path, so the map the
 * daemon calls need is derived from the two team keys rather than kept as
 * a third.
 */
export function deriveRtRepos(
  gitlabHost: string,
  projects: string[]
): Record<string, string> {
  const host = gitlabHost
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return Object.fromEntries(
    projects.map(project => [project, `${host}/${project}`])
  );
}

/** Same, keyed by GitLab project path through config.rtRepos — the shape
    every server.ts call site actually has in hand. */
export function daemonRepoField(
  config: Pick<BoardConfig, 'rtRepos'>,
  projectPath: string
): string | null {
  return repoIdentityField(config.rtRepos[projectPath]);
}

/** Whether a project's Code Owner section names carry Slack channels
    (`board.codeowners`, read from the project's own repo section). The
    section is keyed by the project's host and path, never by an rtRepos
    override, which names where a checkout tracks rather than the project. */
export function codeownerSlackOn(
  config: Pick<BoardConfig, 'gitlabHost'>,
  projectPath: string,
  resolve: typeof getSetting = getSetting
): boolean {
  const repoIdentity = deriveRtRepos(config.gitlabHost, [projectPath])[
    projectPath
  ];
  try {
    const value = resolve<{ slack?: { fromSectionName?: boolean } }>(
      'board.codeowners',
      { repoIdentity }
    ).value;
    return value?.slack?.fromSectionName === true;
  } catch (err) {
    console.warn('board: board.codeowners unavailable', err);
    return false;
  }
}

/** Resolve the rt agent daemon's `repo` identity for a launch (startAgentPane's
    `repo`, matched by `rt agent list --repo <identity>`'s exact-string
    filter). Prefers the project's configured rtRepos value -- the same
    resolution readDiscussions already relies on at server.ts's
    enrichReviewerComments/readLatchDetail -- and falls back to deriving one
    from gitlabHost plus the MR's own GitLab project path. Never blocks a
    launch: when both attempts fail (malformed config), logs a warning and
    returns the bare project path as a best-effort value instead of null. */
export function resolveLaunchRepo(
  rtRepoOverride: string | null | undefined,
  gitlabHost: string,
  projectPath: string,
  mrUrl: string
): string {
  const repo =
    repoIdentityField(rtRepoOverride) ??
    repoIdentityField(`${gitlabHost}/${projectPath}`);
  if (repo) return repo;
  console.warn(
    `launch: could not resolve an rt repo identity for ${mrUrl} (gitlabHost=${gitlabHost}, projectPath=${projectPath || '<empty>'}); launching with the bare project path`
  );
  return projectPath;
}

export interface TabConfig {
  id: string;
  label: string;
  /** `needs-me` is the built-in tab the client appends (view.ts's
      NEEDS_ME_TAB), never a configured one: parseTabs rejects it from config. */
  source:
    | { kind: 'authors' }
    | { kind: 'codeowners'; section: string; excludeMembers?: boolean }
    | { kind: 'needs-me' };
  /** Overrides the team's review channel for this tab's index, reactions, and posts. */
  slackChannel?: string;
  /** Overrides review-launch skill resolution for this tab. Empty/absent = normal resolution. */
  reviewSkill?: string;
  /** Which team pack's bindings a launch from this tab uses; empty/absent = the active team's pack. */
  pack?: string;
  /** Fade roster members with nothing on this tab. Absent = fade on every
      tab but an authors one (tabDimsEmpty). */
  dimEmpty?: boolean;
}

/** The tabs a board with no `board.tabs` shows; the registry default is the same list (registry-defaults.test.ts). */
export const IMPLICIT_TABS: TabConfig[] = [
  { id: 'team', label: 'Team', source: { kind: 'authors' } },
];

export interface Member {
  username: string;
  /** Optional display name; overrides the GitLab profile lookup when set, else falls back to it, then username. */
  name?: string;
  /** Checked out: kept in config but hidden from the sidebar, the "All" view, and its counts. */
  hidden?: boolean;
}

/** A member's display name. The stored name is an override, not a fallback:
    it is the only way to name an account GitLab cannot resolve, and a name
    typed into the roster editor must survive the hourly profile refresh. */
export function displayName(
  member: Member,
  profileName: string | null | undefined
): string | null {
  return member.name?.trim() || profileName?.trim() || null;
}

export interface BoardConfig {
  gitlabHost: string;
  /** GitLab project paths whose MRs are eligible, e.g. "group/project". */
  projects: string[];
  /** Team members whose authored MRs the board shows, in sidebar order. */
  members: Member[];
  /** Username of the member the board defaults to (or "all"), absent URL/localStorage overrides. */
  defaultMember: string;
  /** Hide MRs with no activity (last update) in more than this many days.
      null follows rt's project MR sync window instead. */
  staleAfterDays: number | null;
  /** How long an `open` review gate waits for an answer before the sweep
      parks it. Minutes. */
  gateGraceMinutes: number;
  /**
   * If non-empty, only show MRs whose Linear ticket key starts with one of
   * these prefixes (e.g. ["ACME"] to show only ACME-#### tickets). Case-insensitive.
   * MRs with no detectable ticket key are hidden when this is set. Empty = show all.
   */
  ticketPrefixes: string[];
  /** My team's channels from mattstack.directory, normalized; a code owners section naming one is my team's. */
  ownChannels?: string[];
  /** mattstack.directory as stored: which team answers in which channel. */
  directory?: TeamDirectory;
  /** This Mac's active team; null on no team. */
  ownTeam?: string | null;
  /** Every team in the org roster with its members, by team name. The roster above is one team's slice of it. */
  orgTeams?: OrgTeam[];
  /** Every roster member's canonical username, teamless ones included. */
  orgMembers?: string[];
  title: string;
  /** Absolute path the review agent's herdr pane starts in (a repo checkout). Empty disables review launch. */
  reviewCwd: string;
  /** herdr workspace label reviews are grouped under. */
  reviewsWorkspace: string;
  /** Absolute path the respond agent's herdr pane starts in. Falls back to reviewCwd when empty. */
  respondCwd: string;
  /** herdr workspace label responses are grouped under. */
  respondsWorkspace: string;
  /** Absolute path the doctor agent's herdr pane starts in. Falls back to reviewCwd when empty. */
  doctorCwd: string;
  /** herdr workspace label doctor sessions are grouped under. */
  doctorsWorkspace: string;
  /** Command that starts claude in every pane the board launches, composed from the board.agent.* settings by composeAgentCommand. Empty = plain "claude". */
  claudeCommand: string;
  /** Domain skill the doctor wrapper delegates to. Empty = generic. */
  doctorSkill: string;
  /** The active team's pack; a launch from a tab that names no pack uses it. "" when this Mac has no team pack. */
  teamPack: string;
  /** Extra bot accounts whose general MR comments to hide (username or display
      name, case-insensitive). Additive to the built-in heuristic — for named
      integration bots that don't match a bot-username pattern. */
  botUsernames: string[];
  /** rt repo identities keyed by GitLab project path, derived from gitlabHost and projects. */
  rtRepos: Record<string, string>;
  slack: SlackConfig;
  /** Peer-boards relay: always the built-in switchboard. The token comes from
      SWITCHBOARD_TOKEN or the rt daemon, never config. */
  switchboard: SwitchboardBoardConfig;
  /** Board tabs, in display order. */
  tabs: TabConfig[];
}

export interface SwitchboardBoardConfig {
  url: string;
}

export { DEFAULT_SLACK_EMOJI, type SlackEmojiConfig };

export interface SlackConfig {
  /** The team's review channel from mattstack.directory; '' when it names none. */
  channel: string;
  /** Template for a single MR — used for both clipboard copy and "post to slack". */
  singleTemplate: string;
  /** Header line for the multi-MR summary (top of a "N MR's ready for review" message). */
  multiHeader: string;
  /** Per-MR line under the multi header. */
  multiItem: string;
  /** How often the server sweeps the board and resolves missing Slack refs, in minutes.
      Set to 0 to disable the sweeper (client can still resolve on-demand). */
  autoResolveIntervalMinutes: number;
  emoji: SlackEmojiConfig;
  emojiAliases: SlackEmojiAliases;
}

const DEFAULT_SLACK: SlackConfig = {
  channel: '',
  singleTemplate: '{title}: {url}',
  multiHeader: "{count} MR's ready for review :pray:",
  multiItem: '- {title}: {url}',
  autoResolveIntervalMinutes: 15,
  emoji: DEFAULT_SLACK_EMOJI,
  emojiAliases: {},
};

/** Parse and validate a board config's JSON. `source` names where a malformed value came from in every thrown message: the store reader passes a settings-store label, the fixture server its file. */
export function parseConfig(raw: string, source = 'config.json'): BoardConfig {
  const cfg = JSON.parse(raw) as Partial<BoardConfig>;
  for (const key of ['gitlabHost', 'projects', 'members'] as const) {
    const value = cfg[key];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`${source} is missing required field "${key}"`);
    }
  }
  for (const member of cfg.members!) {
    if (!member || !member.username) {
      throw new Error(`${source} has a member with no "username"`);
    }
    if (member.hidden !== undefined && typeof member.hidden !== 'boolean') {
      throw new Error(
        `${source} member "${member.username}" has a non-boolean "hidden"`
      );
    }
  }
  if (
    cfg.defaultMember &&
    cfg.defaultMember !== 'all' &&
    !cfg.members!.some(m => m.username === cfg.defaultMember)
  ) {
    throw new Error(
      `${source} "defaultMember" (${cfg.defaultMember}) is not "all" or a known member username`
    );
  }
  if (
    cfg.staleAfterDays != null &&
    (typeof cfg.staleAfterDays !== 'number' || cfg.staleAfterDays <= 0)
  ) {
    throw new Error(`${source} "staleAfterDays" must be a positive number`);
  }
  if (
    cfg.gateGraceMinutes !== undefined &&
    (typeof cfg.gateGraceMinutes !== 'number' || cfg.gateGraceMinutes <= 0)
  ) {
    throw new Error(`${source} "gateGraceMinutes" must be a positive number`);
  }
  if (cfg.ticketPrefixes !== undefined) {
    if (
      !Array.isArray(cfg.ticketPrefixes) ||
      cfg.ticketPrefixes.some(p => typeof p !== 'string' || !p.trim())
    ) {
      throw new Error(
        `${source} "ticketPrefixes" must be an array of non-empty strings`
      );
    }
  }
  if (cfg.reviewCwd !== undefined && typeof cfg.reviewCwd !== 'string') {
    throw new Error(`${source} "reviewCwd" must be a string (absolute path)`);
  }
  if (
    cfg.reviewsWorkspace !== undefined &&
    typeof cfg.reviewsWorkspace !== 'string'
  ) {
    throw new Error(`${source} "reviewsWorkspace" must be a string`);
  }
  if (cfg.respondCwd !== undefined && typeof cfg.respondCwd !== 'string') {
    throw new Error(`${source} "respondCwd" must be a string (absolute path)`);
  }
  if (
    cfg.respondsWorkspace !== undefined &&
    typeof cfg.respondsWorkspace !== 'string'
  ) {
    throw new Error(`${source} "respondsWorkspace" must be a string`);
  }
  if (cfg.doctorCwd !== undefined && typeof cfg.doctorCwd !== 'string') {
    throw new Error(`${source} "doctorCwd" must be a string (absolute path)`);
  }
  if (
    cfg.doctorsWorkspace !== undefined &&
    typeof cfg.doctorsWorkspace !== 'string'
  ) {
    throw new Error(`${source} "doctorsWorkspace" must be a string`);
  }
  if (
    cfg.claudeCommand !== undefined &&
    typeof cfg.claudeCommand !== 'string'
  ) {
    throw new Error(
      `${source} "claudeCommand" must be a string (a shell command that starts claude)`
    );
  }
  if (cfg.doctorSkill !== undefined && typeof cfg.doctorSkill !== 'string') {
    throw new Error(`${source} "doctorSkill" must be a string (a skill name)`);
  }
  if (cfg.botUsernames !== undefined) {
    if (
      !Array.isArray(cfg.botUsernames) ||
      cfg.botUsernames.some(b => typeof b !== 'string' || !b.trim())
    ) {
      throw new Error(
        `${source} "botUsernames" must be an array of non-empty strings`
      );
    }
  }
  const slack = parseSlack(cfg.slack, source);
  const switchboard: SwitchboardBoardConfig = { url: switchboardUrl() };
  const tabs = parseTabs(cfg.tabs, source);
  return {
    gitlabHost: cfg.gitlabHost!,
    projects: cfg.projects!,
    members: cfg.members!,
    defaultMember: cfg.defaultMember ?? 'all',
    staleAfterDays: cfg.staleAfterDays ?? null,
    gateGraceMinutes: cfg.gateGraceMinutes ?? 90,
    // Normalize to uppercase so matching is case-insensitive (ticket keys are uppercased).
    ticketPrefixes: (cfg.ticketPrefixes ?? []).map(p => p.trim().toUpperCase()),
    title: cfg.title ?? 'MRs ready for review',
    reviewCwd: cfg.reviewCwd ?? '',
    reviewsWorkspace: cfg.reviewsWorkspace ?? 'reviews',
    respondCwd: cfg.respondCwd ?? '',
    respondsWorkspace: cfg.respondsWorkspace ?? 'responses',
    doctorCwd: cfg.doctorCwd ?? '',
    doctorsWorkspace: cfg.doctorsWorkspace ?? 'doctors',
    claudeCommand: cfg.claudeCommand ?? '',
    doctorSkill: cfg.doctorSkill ?? '',
    teamPack: '',
    botUsernames: (cfg.botUsernames ?? []).map(b => b.trim()),
    rtRepos: deriveRtRepos(cfg.gitlabHost!, cfg.projects!),
    slack,
    switchboard,
    tabs,
  };
}

/** Absent = IMPLICIT_TABS (the classic single authors-roster board), never zero tabs. */
export function parseTabs(raw: unknown, source: string): TabConfig[] {
  if (raw === undefined) return IMPLICIT_TABS;
  if (!Array.isArray(raw)) throw new Error(`${source} "tabs" must be an array`);
  if (raw.length === 0)
    throw new Error(
      `${source} "tabs" must not be empty (omit "tabs" for the implicit default)`
    );
  const seenIds = new Set<string>();
  return raw.map((entry, i) => {
    const label = `tabs[${i}]`;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${source} "${label}" must be an object`);
    }
    const t = entry as Partial<TabConfig>;
    if (!t.id || typeof t.id !== 'string') {
      throw new Error(`${source} "${label}" is missing a non-empty "id"`);
    }
    if (seenIds.has(t.id)) {
      throw new Error(`${source} has a duplicate tab id "${t.id}" in ${label}`);
    }
    seenIds.add(t.id);
    if (!t.label || typeof t.label !== 'string') {
      throw new Error(`${source} "${label}" is missing a non-empty "label"`);
    }
    if (!t.source || typeof t.source !== 'object') {
      throw new Error(`${source} "${label}.source" must be an object`);
    }
    const src = t.source as {
      kind?: string;
      section?: string;
      excludeMembers?: unknown;
    };
    if (src.kind !== 'authors' && src.kind !== 'codeowners') {
      throw new Error(
        `${source} "${label}.source.kind" must be "authors" or "codeowners"`
      );
    }
    let source_: TabConfig['source'];
    if (src.kind === 'authors') {
      source_ = { kind: 'authors' };
    } else {
      if (!src.section || typeof src.section !== 'string') {
        throw new Error(
          `${source} "${label}.source.section" is required for a codeowners tab`
        );
      }
      if (
        src.excludeMembers !== undefined &&
        typeof src.excludeMembers !== 'boolean'
      ) {
        throw new Error(
          `${source} "${label}.source.excludeMembers" must be a boolean`
        );
      }
      source_ = {
        kind: 'codeowners',
        section: src.section,
        ...(src.excludeMembers !== undefined
          ? { excludeMembers: src.excludeMembers }
          : {}),
      };
    }
    if (t.slackChannel !== undefined && typeof t.slackChannel !== 'string') {
      throw new Error(`${source} "${label}.slackChannel" must be a string`);
    }
    if (t.reviewSkill !== undefined && typeof t.reviewSkill !== 'string') {
      throw new Error(`${source} "${label}.reviewSkill" must be a string`);
    }
    if (t.pack !== undefined && typeof t.pack !== 'string') {
      throw new Error(`${source} "${label}.pack" must be a string`);
    }
    if (t.dimEmpty !== undefined && typeof t.dimEmpty !== 'boolean') {
      throw new Error(`${source} "${label}.dimEmpty" must be a boolean`);
    }
    return {
      id: t.id,
      label: t.label,
      source: source_,
      ...(t.slackChannel !== undefined ? { slackChannel: t.slackChannel } : {}),
      ...(t.reviewSkill !== undefined ? { reviewSkill: t.reviewSkill } : {}),
      ...(t.pack !== undefined ? { pack: t.pack } : {}),
      ...(t.dimEmpty !== undefined ? { dimEmpty: t.dimEmpty } : {}),
    };
  });
}

function parseSlack(raw: unknown, source: string): SlackConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source} "slack" must be an object`);
  }
  const s = raw as Partial<SlackConfig>;
  for (const key of ['singleTemplate', 'multiHeader', 'multiItem'] as const) {
    if (s[key] !== undefined && (typeof s[key] !== 'string' || !s[key])) {
      throw new Error(`${source} "slack.${key}" must be a non-empty string`);
    }
  }
  if (
    s.autoResolveIntervalMinutes !== undefined &&
    (typeof s.autoResolveIntervalMinutes !== 'number' ||
      s.autoResolveIntervalMinutes < 0)
  ) {
    throw new Error(
      `${source} "slack.autoResolveIntervalMinutes" must be a non-negative number`
    );
  }
  return {
    channel: DEFAULT_SLACK.channel,
    singleTemplate: s.singleTemplate ?? DEFAULT_SLACK.singleTemplate,
    multiHeader: s.multiHeader ?? DEFAULT_SLACK.multiHeader,
    multiItem: s.multiItem ?? DEFAULT_SLACK.multiItem,
    autoResolveIntervalMinutes:
      s.autoResolveIntervalMinutes ?? DEFAULT_SLACK.autoResolveIntervalMinutes,
    emoji: parseSlackEmoji(s.emoji, source),
    emojiAliases: parseEmojiAliases(s.emojiAliases, source),
  };
}

/** Partial override: any role left out keeps its standard-emoji default.
    Names are accepted with or without colons (`:comment:` → `comment`). */
function parseSlackEmoji(raw: unknown, source: string): SlackEmojiConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLACK_EMOJI };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source} "slack.emoji" must be an object`);
  }
  const e = raw as Partial<SlackEmojiConfig>;
  const out = { ...DEFAULT_SLACK_EMOJI };
  for (const role of ['looking', 'commented', 'approved'] as const) {
    if (e[role] === undefined) continue;
    if (typeof e[role] !== 'string') {
      throw new Error(
        `${source} "slack.emoji.${role}" must be a string (a Slack emoji name)`
      );
    }
    const name = e[role].trim().replace(/^:|:$/g, '');
    if (!name)
      throw new Error(
        `${source} "slack.emoji.${role}" must be a non-empty emoji name`
      );
    out[role] = name;
  }
  return out;
}

/** Names are accepted with or without colons, like `slack.emoji`. */
function parseEmojiAliases(raw: unknown, source: string): SlackEmojiAliases {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source} "slack.emojiAliases" must be an object`);
  }
  const out: SlackEmojiAliases = {};
  for (const role of ['looking', 'commented', 'approved'] as const) {
    const names = (raw as SlackEmojiAliases)[role];
    if (names === undefined) continue;
    if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) {
      throw new Error(
        `${source} "slack.emojiAliases.${role}" must be a list of Slack emoji names`
      );
    }
    out[role] = names.map(n => n.trim().replace(/^:|:$/g, '')).filter(Boolean);
  }
  return out;
}

type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** A setting's value, the registry default filling what no store sets. A
    resolver throw (an unreadable or malformed store file; getSetting never
    touches the daemon) degrades to that default after one warning, so a bad
    store never takes the board down. */
export function boardSetting<T>(
  key: string,
  resolve: GetSettingFn = getSetting
): T {
  try {
    return resolve<T>(key).value as T;
  } catch (err) {
    if (!warnedSettingKeys.has(key)) {
      warnedSettingKeys.add(key);
      console.warn(`board: ${key} unavailable, using its default`, err);
    }
    return structuredClone(getDef(key)?.default) as T;
  }
}

/** Every pane launch reads these settings, so a broken store warns once per key, not once per launch. */
const warnedSettingKeys = new Set<string>();

export function resetBoardSettingWarnings(): void {
  warnedSettingKeys.clear();
}

/** The three `board.agent.*` settings, as read off the store. */
export type AgentSettings = {
  account?: string;
  model?: string;
  effort?: string;
};

/** Build the pane's launch command from the agent settings.
 *
 * `cswap run <acct> --` launches Claude itself, so everything after the `--`
 * is read as Claude's own arguments and the word `claude` must NOT appear
 * there (docs/configuration.md). `--share-history` is not cosmetic: without
 * it a resumed pane cannot find the transcript the review session wrote.
 * Every interpolated value is quoted, since all three are operator strings
 * that reach a shell. */
export function composeAgentCommand({
  account,
  model,
  effort,
}: AgentSettings): string {
  const acct = account?.trim();
  const mdl = model?.trim();
  const eff = effort?.trim();
  if (!acct && !mdl && !eff) return '';
  const head = acct
    ? `cswap run ${shellSingleQuote(acct)} --share-history --`
    : 'claude';
  const flags: string[] = [];
  if (mdl) flags.push('--model', shellSingleQuote(mdl));
  if (eff) flags.push('--effort', shellSingleQuote(eff));
  return [head, ...flags].join(' ');
}

/** The three board.agent.* settings, typed for the rt agent daemon's launch
    payload, which has no field for a whole command. */
export function loadAgentSettings(
  resolve: GetSettingFn = getSetting
): AgentSettings {
  return {
    account: boardSetting<string | undefined>('board.agent.account', resolve),
    model: boardSetting<string | undefined>('board.agent.model', resolve),
    effort: boardSetting<string | undefined>('board.agent.effort', resolve),
  };
}

/** What this Mac's active team contributes to the board's config. Tests replace the fields; production reads rt-client. */
export const teamView: {
  pack: () => string | null;
  team: () => string | null;
  rosterRefusal: () => string | null;
} = {
  pack: activeTeamPack,
  team: () => activeTeam().team,
  rosterRefusal: () => {
    const { org } = activeTeam();
    return org === null ? null : orgStoreRefusal(org);
  },
};

type StoredMember = Member & { teams?: string[] };

export interface OrgTeam {
  name: string;
  members: Array<{ username: string; name?: string }>;
}

function orgMembersFromStore(resolve: GetSettingFn): string[] {
  return boardSetting<StoredMember[]>('mattstack.roster', resolve).flatMap(m =>
    typeof m?.username === 'string' ? [m.username.trim().toLowerCase()] : []
  );
}

function orgTeamsFromStore(resolve: GetSettingFn): OrgTeam[] {
  const byTeam = new Map<string, OrgTeam['members']>();
  for (const m of boardSetting<StoredMember[]>('mattstack.roster', resolve)) {
    for (const team of m.teams ?? []) {
      const members = byTeam.get(team) ?? [];
      members.push(
        m.name
          ? { username: m.username, name: m.name }
          : { username: m.username }
      );
      byTeam.set(team, members);
    }
  }
  return [...byTeam]
    .map(([name, members]) => ({ name, members }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The org roster narrowed to the active team. A Mac on no team, and a team
    nobody is listed on, see everyone. */
function rosterFromStore(resolve: GetSettingFn): {
  members: Member[];
  team: string | null;
} {
  const all = boardSetting<StoredMember[]>('mattstack.roster', resolve);
  const team = teamView.team();
  const onTeam =
    team === null ? [] : all.filter(m => (m.teams ?? []).includes(team));
  // `team` is null for the everyone view: a save from it must never put the
  // whole org on one team.
  return onTeam.length > 0
    ? { members: onTeam, team }
    : { members: all, team: null };
}

/** Why this Mac may not change the roster (it lives in the org store, which
    only an org admin writes); null when it may. */
export function rosterWriteRefusal(): string | null {
  return teamView.rosterRefusal();
}

/**
 * The board's config, from the settings stores alone. Store values never
 * went through parseConfig's normalization (ticketPrefixes' trim and
 * uppercase, the Slack template fill, the member checks), so the assembled
 * object makes the same round trip through it that a file once did.
 */
export function loadConfig(resolve: GetSettingFn = getSetting): BoardConfig {
  const read = <T>(key: string) => boardSetting<T>(key, resolve);
  const workspaces = read<{
    reviews?: string;
    responds?: string;
    doctors?: string;
  }>('board.workspaces');
  const cwds = read<{ review?: string; respond?: string; doctor?: string }>(
    'board.cwds'
  );
  const hidden = new Set(read<string[]>('board.hiddenMembers'));
  const members = rosterFromStore(resolve).members.map(
    ({ hidden: _inline, ...m }) =>
      hidden.has(m.username) ? { ...m, hidden: true } : m
  );
  const directory = read<TeamDirectory>('mattstack.directory');
  const mine = directoryEntry(directory, teamView.team());
  const {
    reviewKind,
    channel: _retired,
    ...slackFields
  } = read<Partial<SlackConfig> & { reviewKind: string }>('board.slack');
  const reviewChannel = mine ? (channelsOfKind(mine, reviewKind)[0] ?? '') : '';
  const ownersChannel = mine?.slack?.codeOwnersChannel;
  const codeOwnersChannel = ownersChannel && normalizeChannel(ownersChannel);
  const tabs = read<TabConfig[]>('board.tabs').map(t =>
    t.source.kind === 'codeowners' && !t.slackChannel && codeOwnersChannel
      ? { ...t, slackChannel: codeOwnersChannel }
      : t
  );
  const merged = {
    gitlabHost: read<string | undefined>('board.gitlabHost'),
    projects: read<string[] | undefined>('board.projects'),
    members,
    title: read<string>('board.title'),
    botUsernames: read<string[]>('board.botUsernames'),
    ticketPrefixes:
      read<string[] | undefined>('board.ticketPrefixes') ??
      (mine?.linear?.team ? [mine.linear.team] : []),
    slack: slackFields,
    doctorSkill: read<string>('board.doctorSkill'),
    staleAfterDays: read<number | undefined>('board.staleAfterDays') ?? null,
    gateGraceMinutes: read<number>('board.gateGraceMinutes'),
    reviewsWorkspace: workspaces.reviews,
    respondsWorkspace: workspaces.responds,
    doctorsWorkspace: workspaces.doctors,
    defaultMember: read<string>('board.defaultMember'),
    claudeCommand: composeAgentCommand(loadAgentSettings(resolve)),
    reviewCwd: cwds.review,
    respondCwd: cwds.respond,
    doctorCwd: cwds.doctor,
    tabs,
  };
  const parsed = parseConfig(
    JSON.stringify(merged),
    'a board.* settings-store value'
  );
  return {
    ...parsed,
    slack: { ...parsed.slack, channel: reviewChannel },
    teamPack: teamView.pack() ?? '',
    ownChannels: mine ? teamChannels(mine) : [],
    directory,
    ownTeam: teamView.team(),
    orgTeams: orgTeamsFromStore(resolve),
    orgMembers: orgMembersFromStore(resolve),
  };
}

/** Whether the stores hold enough for the board to boot; the setup page
    answers until they do. An empty roster or project list counts as not yet. */
export function boardConfigured(resolve: GetSettingFn = getSetting): boolean {
  try {
    loadConfig(resolve);
    return true;
  } catch {
    return false;
  }
}

export type RosterAction = 'add' | 'remove' | 'rename';

export type RosterEdit = {
  action: RosterAction;
  username: string;
  name?: string;
};

export type RosterEditResult =
  { ok: true; members: Member[] } | { ok: false; error: string };

/** Apply one roster edit, returning the next list or the message to hand the
    caller. Pure (list in, list out) so every rule below is testable without a
    server. `self` is the board's defaultMember: the
    board runs as them, so dropping them would strand every affordance keyed
    on that identity, and an empty roster is one parseConfig refuses to load
    on the next boot. A blank name clears the field rather than storing an
    empty string, which is what lets a rename hand a member back to the
    GitLab profile lookup. */
export function applyRosterEdit(
  members: Member[],
  edit: RosterEdit,
  self: string | null
): RosterEditResult {
  const username = edit.username.trim();
  if (!username) return { ok: false, error: 'username is required' };
  const name = edit.name?.trim() ?? '';
  const present = members.some(m => m.username === username);

  if (edit.action === 'add') {
    if (present)
      return { ok: false, error: `"${username}" is already on the roster` };
    return {
      ok: true,
      members: [...members, name ? { username, name } : { username }],
    };
  }

  if (!present) return { ok: false, error: `unknown member "${username}"` };

  if (edit.action === 'rename') {
    return {
      ok: true,
      members: members.map(m => {
        if (m.username !== username) return m;
        const { name: _name, ...rest } = m;
        return name ? { ...rest, name } : rest;
      }),
    };
  }

  if (members.length === 1)
    return { ok: false, error: 'the roster cannot be emptied' };
  if (username === self)
    return {
      ok: false,
      error: 'you cannot drop yourself: this board runs as you',
    };
  return { ok: true, members: members.filter(m => m.username !== username) };
}

/**
 * Replace the roster wholesale by merging it into `mattstack.roster` at org.
 * `next` changes only membership and display names (mergeTeamRoster), and
 * `viewed` names the members the list started from, so an entry written
 * after it was read is kept; it defaults to the roster as resolved now.
 * `mattstack.roster` carries no hidden field.
 */
export function saveRosterMembers(
  next: Member[],
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting,
  viewed?: string[]
): BoardConfig {
  const owner = rosterFromStore(resolve);
  const edited = next.map(({ hidden: _hidden, ...rest }) => rest);
  const full = boardSetting<RosterEntry[]>('mattstack.roster', resolve);
  const shown = viewed ?? owner.members.map(m => m.username);
  write(
    'mattstack.roster',
    mergeTeamRoster(full, owner.team, edited, shown),
    'org'
  );
  return loadConfig(resolve);
}

/** Replace the tab list wholesale in the team store. The list is validated
    first, so a bad write never leaves a config the next boot refuses. */
export function saveTabs(
  next: unknown,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): BoardConfig {
  write('board.tabs', parseTabs(next, 'tabs'), 'team');
  return loadConfig(resolve);
}

/** Persist `username`'s hidden flag in board.hiddenMembers (user scope) and
    return the reload. An unknown member throws before any write. */
export function saveMemberHidden(
  username: string,
  hidden: boolean,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): BoardConfig {
  const current = loadConfig(resolve);
  if (!current.members.some(m => m.username === username)) {
    throw new Error(`unknown member "${username}"`);
  }
  const stored = boardSetting<string[]>('board.hiddenMembers', resolve);
  const next = hidden
    ? [...new Set([...stored, username])]
    : stored.filter(u => u !== username);
  write('board.hiddenMembers', next, 'user');
  return loadConfig(resolve);
}

/** Every board secrets loader below shares this one call: env-first, then
    the rt daemon's token-gated `secrets:read` (scope "board"). `deps` exists
    only for tests -- production callers take the default (real api-token
    file + real daemon socket, resolved at call time by board-secrets.ts).
    Any daemon-side failure (down, gate-refused, old daemon) degrades to
    `{}` after a console.warn -- these are all optional secrets, so a daemon
    problem must disable the dependent feature, never crash the board. */
async function boardSecrets(
  deps?: BoardSecretsDeps
): Promise<BoardSecretsData> {
  const res = await readBoardSecrets(deps);
  if (res.ok) return res;
  console.warn(`board: secrets unavailable (${res.message})`);
  return {};
}

/** Optional after the rt rewire: only the display-name lookup uses it; the
    board runs fully without one. Returns null when no token is configured. */
export async function loadGitLabToken(
  deps?: BoardSecretsDeps
): Promise<string | null> {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  return (await boardSecrets(deps)).gitlabToken ?? null;
}

/** Slack user token (xoxp) for the review-thread integration. Optional: the
    board runs fine without it; the Slack menu actions just stay disabled.
    Returns null when no token is configured. */
export async function loadSlackToken(
  deps?: BoardSecretsDeps
): Promise<string | null> {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  return (await boardSecrets(deps)).slackToken ?? null;
}

/** Switchboard board token. Optional: without it the board runs exactly as
    before, with all peer features disabled. */
export async function loadSwitchboardToken(
  deps?: BoardSecretsDeps
): Promise<string | null> {
  return (await readSwitchboardToken(deps)).token;
}

/** A switchboard token read: `missing` only when the daemon answered and
    holds no token, never when the daemon could not be reached. */
export interface SwitchboardTokenRead {
  token: string | null;
  missing: boolean;
}

/** loadSwitchboardToken, telling "the daemon holds no token" (missing)
    apart from "the daemon could not be read", which only a restart window
    explains and which clears on its own. */
export async function readSwitchboardToken(
  deps?: BoardSecretsDeps
): Promise<SwitchboardTokenRead> {
  if (process.env.SWITCHBOARD_TOKEN)
    return { token: process.env.SWITCHBOARD_TOKEN, missing: false };
  const res = await readBoardSecrets(deps);
  if (!res.ok) {
    console.warn(`board: secrets unavailable (${res.message})`);
    return { token: null, missing: false };
  }
  return res.switchboardToken
    ? { token: res.switchboardToken, missing: false }
    : { token: null, missing: true };
}

/** Switchboard ADMIN token (operator only). Presence of this secret is what
    turns on the board's invite affordances; absence changes nothing. */
export async function loadSwitchboardAdminToken(
  deps?: BoardSecretsDeps
): Promise<string | null> {
  if (process.env.SWITCHBOARD_ADMIN_TOKEN)
    return process.env.SWITCHBOARD_ADMIN_TOKEN;
  return (await boardSecrets(deps)).switchboardAdminToken ?? null;
}
