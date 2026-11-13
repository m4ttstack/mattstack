import type { Forge } from '../../shared/forge.js';
import type {
  LeaderboardWarning,
  RefreshProgress,
} from '../../shared/types.js';
import { getStore, mrKey } from '../store/index.js';
import type { LinkedMr, NormLinearIssue, NormMr } from '../store/model.js';
import { mapLimit } from '../util/concurrency.js';
import { linearRequest } from './client.js';
import {
  closedAtOf,
  creditedUserOf,
  qualifyingMrs,
  type LinkCandidate,
} from './credit.js';
import { mapIssue } from './map.js';
import type { RawIssue } from './raw-types.js';
import { mrTicketHaystack, textRefGrade } from './ticket.js';

/** Extract Linear identifiers from a string, e.g. "ACME-123", "ENG-456", "HUB:299". */
const LINEAR_ID_RE = /\b([A-Z]+[-:]\d+)\b/gi;

/**
 * Reject single-character "team keys" like "Z-10" that the regex picks up from MR text
 * (e.g. "Phase Z-10"). Real Linear team keys are at least 2 uppercase letters.
 * Other false-positives (LOCALHOST-4000, PHASE-2) are handled by batching: if one
 * chunk errors, only that chunk is lost rather than the entire result.
 */
const VALID_LINEAR_ID_RE = /^[A-Z]{2,}-\d+$/;

/**
 * Build a dynamic GraphQL query that looks up each identifier with an alias:
 *   query VerifyIssues {
 *     _0: issue(id: "HUB-123") { id identifier title url }
 *     _1: issue(id: "HUB-456") { id identifier title url }
 *   }
 * Each alias is `_N` so we can match results back to identifiers.
 */
function buildVerifyQuery(identifiers: readonly string[]): string {
  const fields =
    'id identifier title url state { type name } attachments(first: 50) { nodes { url sourceType } }';
  const aliases = identifiers
    .map((id, i) => `_${i}: issue(id: ${JSON.stringify(id)}) { ${fields} }`)
    .join('\n');
  return `query VerifyIssues {\n${aliases}\n}`;
}

type VerifyResult = Record<string, RawIssue | null>;

/** A verify pass: resolved lookups plus the identifiers whose lookup errored (unknown, not invalid). */
interface VerifyOutcome {
  result: VerifyResult;
  failed: string[];
}

const CHUNK_SIZE = 25;

const LINEAR_CONCURRENCY = 6;

/**
 * Extract a GitLab merge request's project path and iid from its URL, e.g.
 * "https://gitlab.example.com/org/app/-/merge_requests/12345" -> { projectPath: "org/app", iid: 12345 }.
 * Returns null for anything else (issues, snippets).
 */
export function parseMrUrl(
  url: string
): { projectPath: string; iid: number } | null {
  const m = url.match(
    /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/
  );
  return m ? { projectPath: m[1]!, iid: Number(m[2]) } : null;
}

/**
 * The change's project path and number from a forge URL: a GitLab MR URL on a GitLab
 * team, a github.com pull request URL on a GitHub team. Anything else is null.
 */
export function parseChangeUrl(
  url: string,
  forge: Forge
): { projectPath: string; iid: number } | null {
  if (forge === 'gitlab') return parseMrUrl(url);
  const m = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#]|$)/
  );
  return m ? { projectPath: m[1]!, iid: Number(m[2]) } : null;
}

/**
 * Verify a chunk of identifiers against Linear. On a batch error (one bad identifier
 * poisoning the query, or a transient failure like a rate limit), falls back to
 * concurrent individual lookups so the rest of the chunk is still recovered.
 */
async function verifyChunk(
  apiKey: string,
  chunk: readonly string[],
  signal?: AbortSignal
): Promise<VerifyOutcome> {
  const query = buildVerifyQuery(chunk);
  try {
    return {
      result: await linearRequest<VerifyResult>(apiKey, query, {}, signal),
      failed: [],
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return verifyIndividually(apiKey, chunk, signal);
  }
}

/**
 * Look up each identifier concurrently. Lookups that error are reported in `failed`
 * rather than silently dropped: an errored lookup says nothing about validity.
 * Keyed identically to the batch result (_0, _1, ...) so callers don't care.
 */
async function verifyIndividually(
  apiKey: string,
  ids: readonly string[],
  signal?: AbortSignal
): Promise<VerifyOutcome> {
  const result: VerifyResult = {};
  const failed: string[] = [];
  await mapLimit([...ids.entries()], LINEAR_CONCURRENCY, async ([i, id]) => {
    signal?.throwIfAborted();
    const query = buildVerifyQuery([id]);
    try {
      const data = await linearRequest<VerifyResult>(apiKey, query, {}, signal);
      const raw = data['_0'];
      if (raw) result[`_${i}`] = raw;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      // "Entity not found" IS a definitive answer (Linear errors on nonexistent ids
      // rather than returning null): leave the alias unset so it's cached as invalid.
      // Anything else (rate limit, transport) says nothing about validity.
      if (!/entity not found/i.test((err as Error).message)) failed.push(id);
    }
  });
  return { result, failed };
}

/**
 * Which MRs feed Linear ticket discovery: shipped (merged) plus in-flight (opened,
 * or locked while mid-merge), but NOT abandoned (closed). Open MRs matter because a
 * ticket sits in states like "In Review" precisely while its MR is still open — scan
 * only merged MRs and those tickets never enter the dataset, so `doneStates` can never
 * count them.
 */
export function eligibleForLinearDiscovery(m: NormMr): boolean {
  return m.state !== 'closed';
}

/**
 * Scan the given MRs for Linear ticket identifiers, batch-verify them against the Linear
 * API via `issue(id:)` lookups, and return verified tickets attributed to each MR's author.
 *
 * Resilient: batched in chunks of 25, with automatic per-identifier fallback when a
 * chunk fails (one bad identifier can't zero out the result).
 */
export async function resolveLinearTickets(
  apiKey: string | undefined,
  sourceMrs: readonly NormMr[],
  warnings: LeaderboardWarning[],
  roster: readonly string[] | ReadonlySet<string>,
  signal?: AbortSignal,
  onProgress?: (p: Omit<RefreshProgress, 'window'>) => void,
  forge?: { kind: Forge; projects: readonly string[] },
  /** Maps a stored PR author to the roster's spelling; absent (GitLab) compares exactly. */
  canon?: (login: string) => string
): Promise<NormLinearIssue[]> {
  if (!apiKey || sourceMrs.length === 0) return [];

  const projectByLower = new Map(
    (forge?.projects ?? []).map(p => [p.toLowerCase(), p])
  );
  const configuredProject = (path: string): string | undefined =>
    projectByLower.get(path.toLowerCase());

  const rosterSet = roster instanceof Set ? roster : new Set(roster);

  const sourceMrByKey = new Map<string, NormMr>();
  for (const m of sourceMrs) {
    sourceMrByKey.set(mrKey(m.projectPath, m.iid), m);
  }

  /** Text-scanned links for one identifier, keyed by mrKey so an attachment can collapse onto them. */
  interface TicketRef {
    mrs: Map<string, LinkCandidate>;
  }
  const ticketMap = new Map<string, TicketRef>();
  for (const mr of sourceMrs) {
    const ids = extractLinearIds(mrTicketHaystack(mr));
    for (const id of ids) {
      const normalized = id.toUpperCase().replace(':', '-');
      if (!mr.authorUsername) continue;
      const via = textRefGrade(mr, normalized);
      if (!via) continue;
      const ref = ticketMap.get(normalized) ?? { mrs: new Map() };
      const key = mrKey(mr.projectPath, mr.iid);
      if (!ref.mrs.has(key)) {
        ref.mrs.set(key, {
          iid: mr.iid,
          projectPath: mr.projectPath,
          authorUsername: mr.authorUsername,
          state: mr.state,
          mergedAt: mr.mergedAt,
          title: mr.title,
          via,
        });
      }
      ticketMap.set(normalized, ref);
    }
  }

  if (ticketMap.size === 0) return [];

  const candidates = [...ticketMap.keys()].filter(id =>
    VALID_LINEAR_ID_RE.test(id)
  );
  if (candidates.length === 0) return [];

  // Partition by cached validity: known-valid go straight to batch query,
  // known-invalid are skipped, unknown go through the full verify flow.
  const store = getStore();
  const knownValid: string[] = [];
  const unknown: string[] = [];
  for (const id of candidates) {
    const cached = store.isValidLinearId(id);
    if (cached === true) knownValid.push(id);
    else if (cached === null) unknown.push(id);
    // cached === false: skip entirely
  }

  const issues: NormLinearIssue[] = [];

  /**
   * Resolve one issue's attached MR or PR links: source MRs first, then the store's
   * index for MRs outside this refresh's scan. A URL that resolves to neither is
   * dropped -- it names an MR this refresh has no evidence of. `hadMrAttachment`
   * still reports it, so the grade decision can tell "no MR attachments" from
   * "MR attachments that resolved to nothing".
   */
  const resolveAttachments = (
    raw: RawIssue
  ): { candidates: LinkCandidate[]; hadMrAttachment: boolean } => {
    const nodes = raw.attachments?.nodes ?? [];
    // Linear's sourceType for a GitHub PR is not guaranteed, so GitHub teams trust the URL alone.
    // A PR in an unconfigured project still counts as an attachment but is never looked up:
    // mr_index can keep rows from a project since removed from boxscore.projects.
    let parsed: { projectPath: string; iid: number }[];
    if (forge?.kind === 'github') {
      const prs = nodes.flatMap(n => {
        const p = parseChangeUrl(n.url, 'github');
        return p ? [p] : [];
      });
      if (prs.length === 0) return { candidates: [], hadMrAttachment: false };
      parsed = prs.flatMap(p => {
        const projectPath = configuredProject(p.projectPath);
        return projectPath ? [{ projectPath, iid: p.iid }] : [];
      });
    } else {
      parsed = nodes
        .filter(n => n.sourceType === 'gitlab')
        .map(n => parseMrUrl(n.url))
        .filter((p): p is { projectPath: string; iid: number } => p !== null);
      if (parsed.length === 0)
        return { candidates: [], hadMrAttachment: false };
    }

    const result: LinkCandidate[] = [];
    const indexKeys: string[] = [];
    for (const p of parsed) {
      const key = mrKey(p.projectPath, p.iid);
      const src = sourceMrByKey.get(key);
      if (src) {
        result.push({
          iid: src.iid,
          projectPath: src.projectPath,
          authorUsername: src.authorUsername,
          state: src.state,
          mergedAt: src.mergedAt,
          title: src.title,
          via: 'attachment',
        });
      } else {
        indexKeys.push(key);
      }
    }
    if (indexKeys.length > 0) {
      for (const row of store.indexRowsByKeys(indexKeys)) {
        result.push({
          iid: row.iid,
          projectPath: row.projectPath,
          authorUsername: row.authorUsername,
          state: row.state,
          mergedAt: row.mergedAt,
          title: row.title,
          via: 'attachment',
        });
      }
    }
    return { candidates: result, hadMrAttachment: true };
  };

  const collectResults = (data: VerifyResult, chunk: readonly string[]) => {
    for (const [alias, raw] of Object.entries(data)) {
      if (!raw) continue;
      const idx = parseInt(alias.slice(1), 10);
      const identifier = chunk[idx];
      if (!identifier) continue;
      const ref = ticketMap.get(identifier);

      // An attachment entry overwrites its text-linked counterpart, so the grade
      // collapses to 'attachment'.
      const byKey = new Map(ref?.mrs ?? []);
      const { candidates: attached, hadMrAttachment } = resolveAttachments(raw);
      for (const a of attached) {
        byKey.set(mrKey(a.projectPath, a.iid), a);
      }
      const linkCandidates = [...byKey.values()];

      const qualifying = qualifyingMrs(linkCandidates, hadMrAttachment);
      const creditedUser = creditedUserOf(qualifying, rosterSet, canon);
      const closedAt = closedAtOf(qualifying);
      const linkedMrs: LinkedMr[] = linkCandidates.map(
        ({ iid, projectPath, via }) => ({ iid, projectPath, via })
      );
      issues.push(mapIssue(raw, creditedUser, linkedMrs, closedAt));
    }
  };

  const allFailed: string[] = [];

  // Phase 1: batch-query known-valid identifiers. A chunk can still fail transiently
  // (rate limits during a big refresh); silently dropping it removes a whole chunk's
  // tickets from the envelope, so fall back to individual lookups exactly like the
  // unknown path.
  const validChunks = Math.ceil(knownValid.length / CHUNK_SIZE);
  for (let ci = 0; ci < validChunks; ci++) {
    signal?.throwIfAborted();
    const chunk = knownValid.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
    onProgress?.({
      phase: 'linear',
      label: `Fetching ${knownValid.length} cached tickets`,
      done: ci,
      total: validChunks,
    });
    const { result, failed } = await verifyChunk(apiKey, chunk, signal);
    collectResults(result, chunk);
    allFailed.push(...failed);
  }

  // Phase 2: verify unknown identifiers (with fallback for bad ones).
  if (unknown.length > 0) {
    const unknownChunks = Math.ceil(unknown.length / CHUNK_SIZE);
    for (let ci = 0; ci < unknownChunks; ci++) {
      signal?.throwIfAborted();
      const chunk = unknown.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
      onProgress?.({
        phase: 'linear',
        label: `Verifying ${unknown.length} new identifiers (${ci + 1}/${unknownChunks})`,
        done: ci,
        total: unknownChunks,
      });
      const { result, failed } = await verifyChunk(apiKey, chunk, signal);
      collectResults(result, chunk);
      allFailed.push(...failed);

      // Record validity for next time -- but only definitive answers. An errored lookup
      // says nothing; caching valid:false for it would permanently hide a real ticket.
      const failedSet = new Set(failed);
      const entries = chunk
        .filter(id => !failedSet.has(id))
        .map(id => ({ id, valid: !!result[`_${chunk.indexOf(id)}`] }));
      store.putLinearIds(entries);
    }
  }

  if (allFailed.length > 0) {
    warnings.push({
      code: 'linear_partial',
      message: `Linear lookup failed for ${allFailed.length} tickets (e.g. ${allFailed[0]}); they are missing from this refresh.`,
    });
  }

  onProgress?.({
    phase: 'linear',
    label: 'Verifying Linear tickets',
    done: 1,
    total: 1,
  });
  return issues;
}

function extractLinearIds(text: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  LINEAR_ID_RE.lastIndex = 0;
  while ((m = LINEAR_ID_RE.exec(text)) !== null) {
    ids.add(m[1]!);
  }
  return [...ids];
}
