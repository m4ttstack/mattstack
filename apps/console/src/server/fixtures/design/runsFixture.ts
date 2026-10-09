/**
 * `CONSOLE_FIXTURE=design` for the runs pages: the runs, gates, enrichment,
 * effective-inputs, stage-doc, evidence and artifact routes answer from the
 * invented `acme/web` runs the runs boards were drawn with
 * (docs/apps/design/console/README.md, "Runs redesign"). The `runs` scenario
 * serves every board's run; `runs-empty` keeps only the finished ones. Any
 * other scenario serves no runs, so a fixture server never reaches the daemon.
 *
 * The JSON under `runs/` writes times as local ISO strings; they become epoch
 * ms on read. Runs a runs page does not draw are `hidden`: their own page and
 * `?run=` gates answer, but no list does. `asOf` is the fixture's clock, the
 * "as of" time each board was drawn at.
 *
 * Everything is read at call time, so nothing here is bundled into the app.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEvidence,
  type BranchEnrichment,
  type EvidenceImageKey,
  type EvidenceTextKey,
  type GateRow,
  type RunDecisionRow,
  type RunDetail,
  type RunFieldRow,
  type RunStageRow,
  type RunSummary,
} from '@mattstack/rt-client';
import { legacyItems } from '@mattstack/rt-client/evidence';

import { runIdOfGate } from '../../../shared/gate-run';
import { readExcerpt, type Excerpt } from '../../artifact';
import type { EffectiveInputsPayload } from '../../effectiveInputs';
import { LEGACY_IMAGE_MIME } from '../../legacyEvidence';
import { onDisk } from './fixtureRt';
import type { FixtureScenario } from './scenarios';

/** What a route answers a write with under a design fixture. */
export const FIXTURE_READ_ONLY = 'the design fixture is read-only';

export interface GateFilter {
  subject?: string;
  run?: string;
  linked?: boolean;
}

export interface FixtureEvidence {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface RunsFixture {
  /** The board's "as of" time: a run page's for `runId`, else the runs pages'. */
  asOf(runId?: string): Promise<number>;
  listRuns(repo?: string): Promise<RunSummary[]>;
  getRun(repo: string, runId: string): Promise<RunDetail | null>;
  gates(filter: GateFilter): Promise<GateRow[]>;
  enrich(branches: string[]): Promise<Record<string, BranchEnrichment>>;
  effectiveInputs(
    repo: string,
    runId: string
  ): Promise<EffectiveInputsPayload | null>;
  stageDoc(repo: string, runId: string, stage: string): Promise<string | null>;
  evidence(
    repo: string,
    runId: string,
    key: EvidenceImageKey | EvidenceTextKey
  ): Promise<FixtureEvidence | null>;
  artifact(repo: string, runId: string, path: string): Promise<Excerpt | null>;
  /** An image a legacy run's evidence names under the fixture's evidence root. */
  legacyEvidenceFile(
    repo: string,
    runId: string,
    path: string
  ): Promise<FixtureEvidence | null>;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const RUNS = join(HERE, 'runs');
const FILES = join(HERE, 'files');
const PACK_COMMITS = 'acme=4c1d9e2b7a';
const STAGE_NAME = /^[A-Za-z0-9_-]+$/;
const LEGACY_EVIDENCE_ROOT = '/Users/acme/.mattstack/evidence/';

const TIME_KEYS = new Set([
  'started_at',
  'ended_at',
  'at',
  'decided_at',
  'openedAt',
  'parkedAt',
  'closedAt',
  'answeredAt',
  'mergedAt',
  'escalatedAt',
  'consumedAt',
  'fetchedAt',
  'pages',
  'run',
]);

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
};

interface Index {
  repo: string;
  clock: { pages: number; run: number; runs: Record<string, number> };
  scenarios: Partial<
    Record<FixtureScenario, { listed: string[]; hidden: string[] }>
  >;
}

type RawStage = Omit<RunStageRow, 'attempt' | 'reason' | 'detail_path'> &
  Partial<Pick<RunStageRow, 'attempt' | 'reason' | 'detail_path'>>;

interface RawRun {
  run: Pick<
    RunSummary,
    'id' | 'work_type' | 'pipeline' | 'status' | 'started_at' | 'ended_at'
  > &
    Partial<RunSummary>;
  stages: RawStage[];
  fields: RunFieldRow[];
  decisions: (Omit<RunDecisionRow, 'selection'> & { selection: unknown })[];
}

type RawGate = Pick<
  GateRow,
  'id' | 'subject' | 'kind' | 'openedAt' | 'questions'
> &
  Partial<GateRow>;

interface SharedInputs {
  packVersions: EffectiveInputsPayload['packVersions'];
  packDirty: boolean;
  config: EffectiveInputsPayload['config'];
}

/** ISO strings under the time keys become epoch ms; everything else is kept. */
function withTimes(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && TIME_KEYS.has(key)) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`bad fixture time ${key}: ${value}`);
    return ms;
  }
  if (Array.isArray(value)) return value.map(v => withTimes(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        // A run's clock map keys on run ids, which are not time keys.
        key === 'runs' ? withTimes(v, 'run') : withTimes(v, k),
      ])
    );
  }
  return value;
}

async function readRuns<T>(name: string): Promise<T> {
  return withTimes(JSON.parse(await readFile(join(RUNS, name), 'utf8'))) as T;
}

function decodeRepo(repo: string): string {
  try {
    return decodeURIComponent(repo);
  } catch {
    return repo;
  }
}

function buildDetail(raw: RawRun, repo: string): RunDetail {
  const stages: RunStageRow[] = raw.stages.map(s => ({
    attempt: 1,
    reason: null,
    detail_path: null,
    ...s,
  }));
  const fields = [...raw.fields].sort((a, b) => a.at - b.at);
  const decisions: RunDecisionRow[] = raw.decisions.map(d => ({
    ...d,
    selection:
      typeof d.selection === 'string'
        ? d.selection
        : JSON.stringify(d.selection),
  }));
  const value = (key: string) => fields.find(f => f.key === key)?.value ?? null;
  const evidence = parseEvidence(value('evidence'));
  const times = [
    raw.run.started_at,
    ...stages.flatMap(s => [s.started_at, s.ended_at]),
    ...fields.map(f => f.at),
    ...decisions.map(d => d.decided_at),
  ].filter((t): t is number => t != null);
  const current =
    stages.findLast(s => s.status === 'running') ?? stages.at(-1) ?? null;
  const run: RunSummary = {
    repo,
    spawned_by: null,
    pack_commits: PACK_COMMITS,
    pack_dirty: 0,
    attention: { needs: false, reason: null, evidence: '' },
    agent: null,
    ...raw.run,
    current_stage: current?.name ?? null,
    last_event_at: Math.max(...times),
    ticket: value('ticket'),
    branch: value('branch'),
    stages: stages.map(s => ({
      name: s.name,
      status: s.status,
      started_at: s.started_at,
      ended_at: s.ended_at,
      attempt: s.attempt,
    })),
    decision_count: decisions.length,
    evidence_count: evidence.version === 1 ? evidence.images.length : 0,
    evidence_links: evidence.version === 0 ? evidence.links.length : 0,
  };
  return { run, stages, fields, decisions, schemaAhead: false };
}

function buildGate(raw: RawGate): GateRow {
  const runId = runIdOfGate({ origin: null, ...raw } as GateRow);
  return {
    meta: null,
    context: null,
    status: raw.answer ? 'answered' : 'open',
    answer: null,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    consumedAt: null,
    owner: 'human',
    escalatedAt: null,
    ...raw,
    origin: raw.origin ?? { runId: runId ?? undefined, presentation: 'form' },
    questions: raw.questions.map(q => ({ ...q, multi: q.multi ?? false })),
  };
}

export function runsFixture(scenario: FixtureScenario): RunsFixture {
  const index = () => readRuns<Index>('runs.json');

  async function scope() {
    const ix = await index();
    const set = ix.scenarios[scenario] ?? { listed: [], hidden: [] };
    return {
      ix,
      listed: new Set(set.listed),
      known: new Set([...set.listed, ...set.hidden]),
    };
  }

  async function load(runId: string): Promise<RunDetail> {
    const ix = await index();
    return buildDetail(await readRuns<RawRun>(`run-${runId}.json`), ix.repo);
  }

  async function getRun(repo: string, runId: string) {
    const { ix, known } = await scope();
    if (decodeRepo(repo) !== decodeRepo(ix.repo) || !known.has(runId))
      return null;
    return load(runId);
  }

  async function allGates(): Promise<GateRow[]> {
    const { gates } = await readRuns<{ gates: RawGate[] }>('gates.json');
    return gates.map(buildGate).sort((a, b) => a.openedAt - b.openedAt);
  }

  async function evidenceValue(repo: string, runId: string) {
    const detail = await getRun(repo, runId);
    const field = detail?.fields.find(f => f.key === 'evidence');
    return parseEvidence(field?.value);
  }

  return {
    async asOf(runId) {
      const { clock } = await index();
      return runId ? (clock.runs[runId] ?? clock.run) : clock.pages;
    },

    async listRuns(repo) {
      const { ix, listed } = await scope();
      if (repo !== undefined && decodeRepo(repo) !== decodeRepo(ix.repo))
        return [];
      const details = await Promise.all([...listed].map(load));
      return details
        .map(d => d.run)
        .sort(
          (a, b) => b.started_at - a.started_at || b.id.localeCompare(a.id)
        );
    },

    getRun,

    async gates(filter) {
      const { listed, known } = await scope();
      const gates = await allGates();
      const onList = (g: GateRow) => {
        const id = runIdOfGate(g);
        return id !== null && listed.has(id);
      };
      if (filter.run) {
        const run = filter.run;
        return known.has(run) ? gates.filter(g => runIdOfGate(g) === run) : [];
      }
      if (filter.linked) return gates.filter(onList);
      if (filter.subject)
        return gates.filter(g => g.subject === filter.subject && onList(g));
      return gates.filter(g => g.subject.startsWith('run:') && onList(g));
    },

    async enrich(branches) {
      const { listed } = await scope();
      if (listed.size === 0) return {};
      const data = await readRuns<{
        fetchedAt: number;
        branches: Record<string, Omit<BranchEnrichment, 'fetchedAt'>>;
      }>('enrich.json');
      return Object.fromEntries(
        branches
          .filter(b => Object.hasOwn(data.branches, b))
          .map(b => [b, { ...data.branches[b]!, fetchedAt: data.fetchedAt }])
      );
    },

    async effectiveInputs(repo, runId) {
      const detail = await getRun(repo, runId);
      if (!detail) return null;
      const shared = await readRuns<SharedInputs>('effective-inputs.json');
      const { run, stages } = detail;
      return {
        pipeline: run.pipeline,
        workType: run.work_type,
        packVersions: run.pack_commits === null ? null : shared.packVersions,
        packDirty: shared.packDirty,
        stages: [...new Set(stages.map(s => s.name))],
        config: shared.config,
      };
    },

    async stageDoc(repo, runId, stage) {
      if (!STAGE_NAME.test(stage) || !(await getRun(repo, runId))) return null;
      try {
        return await readFile(join(RUNS, 'stage-docs', `${stage}.md`), 'utf8');
      } catch {
        return null;
      }
    },

    async evidence(repo, runId, key) {
      const parsed = await evidenceValue(repo, runId);
      if (parsed.version !== 1) return null;
      const path =
        key === 'transcript'
          ? parsed.evidence.transcript
          : parsed.images.find(i => i.key === key)?.path;
      if (!path) return null;
      const mime = MIME[extname(path).toLowerCase()];
      if (!mime) return null;
      return { mime, bytes: new Uint8Array(await readFile(onDisk(path))) };
    },

    async legacyEvidenceFile(repo, runId, path) {
      const parsed = await evidenceValue(repo, runId);
      if (parsed.version !== 0) return null;
      const named = legacyItems(parsed.links).some(
        i => i.kind === 'image' && i.value === path
      );
      const mime = LEGACY_IMAGE_MIME[extname(path).toLowerCase()];
      if (!named || !mime || !path.startsWith(LEGACY_EVIDENCE_ROOT))
        return null;
      const rest = posix.normalize(path.slice(LEGACY_EVIDENCE_ROOT.length));
      if (rest.startsWith('..')) return null;
      try {
        const bytes = await readFile(join(FILES, 'evidence', rest));
        return { mime, bytes: new Uint8Array(bytes) };
      } catch {
        return null;
      }
    },

    async artifact(repo, runId, path) {
      if (!(await getRun(repo, runId))) return null;
      return readExcerpt(onDisk(path), [FILES]);
    },
  };
}
