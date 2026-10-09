// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionLabel, stripRecommended } from '@mattstack/gate-kit';
import {
  parseEvidence,
  type GateOption,
  type GateRow,
  type RunDetail,
  type RunSummary,
} from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { countCommits, myGateSpans } from '../../../app/runs/derive/answers';
import {
  tookRecommendation,
  waitingOnYou,
} from '../../../app/runs/derive/gates';
import { isMine } from '../../../shared/gate-waiting';
import { runsFixture } from './runsFixture';

const REPO = 'remote:acme%2Fweb';
const EXPORTS = fileURLToPath(
  new URL('../../../../../../docs/apps/design/console/parity/', import.meta.url)
);

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Every text run a board draws, as the browser would read it. */
function boardTexts(slug: string): Set<string> {
  const html = readFileSync(join(EXPORTS, `${slug}.light.html`), 'utf8');
  const body = html.slice(html.indexOf('<body'));
  const texts = new Set<string>();
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const t = decode(m[1]!);
    if (t) texts.add(t);
  }
  return texts;
}

const at = (local: string) => Date.parse(`2026-10-${local}-05:00`);
const MIN = 60_000;

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});
const span = (ms: number) => {
  const h = Math.floor(ms / (60 * MIN));
  const m = Math.round((ms % (60 * MIN)) / MIN);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const label = (o: GateOption) => stripRecommended(optionLabel(o)).text;
const picked = (g: GateRow, q = g.questions[0]!) => {
  const raw = g.answer?.answers[q.id];
  const value =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw.value
      : raw;
  const option = q.options.find(
    o => (typeof o === 'string' ? o : o.value) === value
  );
  return option ? label(option) : null;
};

const runs = runsFixture('runs');

async function detail(id: string): Promise<RunDetail> {
  const d = await runs.getRun(REPO, id);
  if (!d) throw new Error(`no run ${id}`);
  return d;
}
const field = (d: RunDetail, key: string) =>
  d.fields.find(f => f.key === key)?.value;

describe('the runs boards draw the fixture', () => {
  it('run-live: WEB-412, its story fields and the answers in its story', async () => {
    const texts = boardTexts('run-live');
    const d = await detail('20261008-1338');
    const branch = field(d, 'branch')!;
    const enrichment = (await runs.enrich([branch]))[branch]!;
    expect(texts).toContain(enrichment.ticket!.identifier);
    expect(texts).toContain(enrichment.ticket!.title);
    expect(texts).toContain(branch);
    for (const key of [
      'approach',
      'evidence-plan',
      'extra-gates',
      'case',
      'strategy',
      'plan',
    ])
      expect(texts).toContain(field(d, key));
    for (const stage of field(d, 'pipeline-stages')!.split(' '))
      expect(texts).toContain(stage);
    const gates = await runs.gates({ run: '20261008-1338' });
    expect(gates).toHaveLength(5);
    for (const g of gates) {
      expect(texts).toContain(g.questions[0]!.label);
      expect(texts).toContain(picked(g));
      expect(texts).toContain(g.answer!.answers[g.questions[0]!.id]);
    }
    expect(texts).toContain(
      `${countCommits(field(d, 'commits')!)} commits @ 9f2c1a7`
    );
    expect(d.run.started_at).toBe(at('08T13:38'));
    expect(await runs.asOf('20261008-1338')).toBe(at('08T16:21'));
    expect(texts).toContain('· work pipeline · started 1:38 PM · 2h 43m');
  });

  it('run-gate: WEB-418 and its open plan gate', async () => {
    const texts = boardTexts('run-gate');
    const d = await detail('20261008-1340');
    expect(texts).toContain(field(d, 'branch'));
    const [gate, ...rest] = await runs.gates({ run: '20261008-1340' });
    expect(rest).toEqual([]);
    expect(gate!.status).toBe('open');
    expect(gate!.questions).toHaveLength(3);
    const first = gate!.questions[0]!;
    expect(texts).toContain(first.label);
    for (const o of first.options) {
      expect(texts).toContain(label(o));
      expect(texts).toContain(typeof o === 'string' ? o : o.description);
    }
    for (const line of gate!
      .context!.split('\n')
      .filter(l => l && !l.startsWith('```')))
      expect(texts).toContain(line.replace(/^- /, ''));
    expect((await runs.asOf('20261008-1340')) - gate!.openedAt).toBe(4 * MIN);
  });

  it('run-record: WEB-409 decisions, recommendation count, evidence and waiting', async () => {
    const texts = boardTexts('run-record');
    const d = await detail('20261008-1142');
    const gates = await runs.gates({ run: '20261008-1142' });
    const answered = gates.filter(g => g.status === 'answered');
    expect(answered).toHaveLength(8);
    const took = answered.filter(
      g => tookRecommendation(g.questions[0]!, g.answer) === true
    );
    expect(texts).toContain(`${took.length} of ${answered.length}`);
    const now = await runs.asOf('20261008-1142');
    expect(waitingOnYou(gates.filter(isMine), now)).toBe(25 * MIN);
    for (const g of answered.slice(0, 4)) {
      expect(texts).toContain(g.questions[0]!.label);
      for (const o of g.questions[0]!.options)
        expect(texts).toContain(label(o));
    }
    expect(texts).toContain(
      'Hourly matters for rush orders. Worth the new key.'
    );
    expect(texts).toContain(String(countCommits(field(d, 'commits')!)));
    expect(d.run.evidence_count).toBe(3);
    expect(texts).toContain(JSON.parse(field(d, 'evidence')!).case);
    expect(d.run.outcome?.mr).toMatchObject({ iid: 405, state: 'merged' });
    expect(d.run.outcome!.mr!.mergedAt! - d.run.started_at).toBe(152 * MIN);
  });

  it('run-review-live: the review run and its post gate waiting in the board', async () => {
    const texts = boardTexts('run-review-live');
    const d = await detail('20261008-1502');
    expect(d.run.work_type).toBe('review');
    for (const key of ['findings', 'tiers', 'branch'])
      expect(texts).toContain(field(d, key));
    const [gate] = await runs.gates({ run: '20261008-1502' });
    expect(gate!.subject).toBe('mr:acme/web!412');
    expect(texts).toContain(gate!.questions[0]!.label);
    for (const o of gate!.questions[0]!.options)
      expect(texts).toContain(label(o));
    const now = await runs.asOf('20261008-1502');
    expect(now).toBe(at('08T15:11'));
    expect(now - gate!.openedAt).toBe(2 * MIN);
    expect(now - d.run.started_at).toBe(9 * MIN);
  });

  it('run-two-gates: a herd-owned ship gate opened before a plan gate of mine', async () => {
    const texts = boardTexts('run-two-gates');
    const gates = await runs.gates({ run: '20261008-1600' });
    expect(gates.map(g => [g.questions[0]!.label, isMine(g)])).toEqual([
      ['Ship as draft or ready?', false],
      ['Which approach should the plan take?', true],
    ]);
    const now = await runs.asOf('20261008-1600');
    expect(gates.map(g => (now - g.openedAt) / MIN)).toEqual([9, 4]);
    expect(texts).toContain(gates[0]!.context);
    for (const o of gates[0]!.questions[0]!.options)
      expect(texts).toContain(label(o));
  });

  it('run-story-edges: a failed attempt, a redirect, a re-run and legacy evidence', async () => {
    const texts = boardTexts('run-story-edges');
    const d = await detail('20261008-0900');
    expect(d.stages.map(s => [s.name, s.attempt, s.status])).toEqual([
      ['evidence', 1, 'done'],
      ['implement', 1, 'failed'],
      ['implement', 2, 'done'],
      ['self-review', 1, 'redirected'],
      ['implement', 3, 'running'],
    ]);
    expect(texts).toContain(d.stages[1]!.reason);
    const log = await runs.artifact(REPO, d.run.id, d.stages[1]!.detail_path!);
    for (const line of log!.lines) expect(texts).toContain(line);
    for (const link of field(d, 'evidence')!.split(' '))
      expect(texts).toContain(link);
    const redirect = JSON.parse(d.decisions[0]!.selection);
    expect(texts).toContain(`back to ${redirect.to}: ${redirect.reason}`);
    expect(texts).toContain(field(d, 'strategy'));
    expect((await runs.asOf(d.run.id)) - d.stages[4]!.started_at!).toBe(MIN);
  });

  it('run-record-abandoned: the abandoned work run header', async () => {
    const texts = boardTexts('run-record-abandoned');
    const abandoned = await detail('20261007-1310');
    const { run } = abandoned;
    const ticket = (await runs.enrich([run.branch!]))[run.branch!]!.ticket!;
    expect(texts).toContain(ticket.identifier);
    expect(texts).toContain(ticket.title);
    expect(texts).toContain(run.outcome!.status);
    expect(texts).toContain(
      `· work pipeline · Oct 8, ${clock.format(run.started_at)} → ${clock.format(run.ended_at!)}`
    );
    expect(texts).toContain(span(run.ended_at! - run.started_at));
    const gates = await runs.gates({ run: run.id });
    expect(texts).toContain(
      String(gates.filter(g => g.status === 'answered').length)
    );
    const evidence = parseEvidence(field(abandoned, 'evidence'));
    expect(evidence.version).toBe(0);
    if (evidence.version === 0)
      expect(texts).toContain(`${evidence.links.length} links`);
    expect(texts).toContain(String(countCommits(field(abandoned, 'commits')!)));
    expect(texts).toContain(span(waitingOnYou(gates.filter(isMine), 0)));
  });

  it('run-record-review: the review record header', async () => {
    const texts = boardTexts('run-record-review');
    const { run } = await detail('20261008-0940');
    const { iid, posted } = run.outcome!.reviewed!;
    expect(texts).toContain(`!${iid}`);
    expect(texts).toContain(`reviewed !${iid} · ${posted}`);
    expect(texts).toContain(span(run.ended_at! - run.started_at));
    const posts = await runs.gates({ run: run.id });
    expect(texts).toContain(String(posts.length));
    expect(texts).toContain(span(waitingOnYou(posts, 0)));
  });

  it('runs-lanes: the waiting gate, the live cards and every earlier row', async () => {
    const texts = boardTexts('runs-lanes');
    const list = await runs.listRuns();
    const branches = list.map(r => r.branch!).filter(Boolean);
    const enrichment = await runs.enrich(branches);
    for (const r of list) {
      const t = enrichment[r.branch!]!.ticket!;
      expect(texts).toContain(t.identifier);
      expect(texts).toContain(t.title);
    }
    const today = list.filter(r => r.ended_at && r.ended_at >= at('08T00:00'));
    expect(texts).toContain(String(today.length));
    expect(texts).toContain(
      `${today.filter(r => r.outcome?.mr?.state === 'merged').length} merged · ${today.filter(r => r.outcome?.reviewed?.posted).length} review posted`
    );
    const linked = await runs.gates({ linked: true });
    const waiting = linked.filter(g => g.status === 'open');
    expect(waiting.map(g => g.id)).toEqual(['g-418-plan']);
    expect(texts).toContain(waiting[0]!.questions[0]!.label);
    const decisions = (id: string) =>
      linked.filter(
        g =>
          g.status === 'answered' &&
          (g.subject === `run:${id}` || g.origin?.runId === id)
      ).length;
    for (const r of list) {
      const n = decisions(r.id);
      if (n > 0) expect(texts).toContain(`${n} decision${n === 1 ? '' : 's'}`);
    }
    const now = await runs.asOf();
    expect(now).toBe(at('08T16:23'));
    const web397 = list.find(r => r.ticket === 'WEB-397')!;
    expect(now - web397.stages!.at(-1)!.started_at!).toBe(17 * MIN);
  });

  it('runs-timeline: fourteen answers of mine today', async () => {
    const texts = boardTexts('runs-timeline');
    const linked = await runs.gates({ linked: true });
    const dayStart = at('08T00:00');
    const mine = linked.filter(
      g =>
        g.answer &&
        g.answer.answeredAt >= dayStart &&
        ['console', 'pane', 'board'].includes(g.answer.by)
    );
    expect(texts).toContain(`DECISIONS YOU MADE TODAY · ${mine.length}`);
    expect(myGateSpans(linked, at('08T16:23')).length).toBeGreaterThan(0);
  });

  it('runs-empty: nothing live and nothing waiting, the same earlier rows', async () => {
    const texts = boardTexts('runs-empty');
    const empty = runsFixture('runs-empty');
    const list = await empty.listRuns();
    const enrichment = await empty.enrich(list.map(r => r.branch!));
    const subLine = (r: RunSummary) => {
      const { mr, reviewed } = r.outcome!;
      if (reviewed)
        return `review pipeline · reviewed !${reviewed.iid} · ${reviewed.posted}`;
      if (mr) return `work pipeline · !${mr.iid} ${mr.state}`;
      return 'work pipeline · stale · no pane';
    };
    for (const r of list) {
      const t = enrichment[r.branch!]!.ticket!;
      expect(texts).toContain(t.identifier);
      expect(texts).toContain(t.title);
      expect(texts).toContain(subLine(r));
    }
    const today = list.filter(r => r.ended_at && r.ended_at >= at('08T00:00'));
    const merged = today.filter(r => r.outcome?.mr?.state === 'merged').length;
    const posted = today.filter(r => r.outcome?.reviewed?.posted).length;
    expect(texts).toContain(String(today.length));
    expect(texts).toContain(`${merged} merged · ${posted} review posted`);
    expect(list.map(r => r.ticket)).toEqual([
      'WEB-409',
      'WEB-401',
      'WEB-388',
      'WEB-376',
      'WEB-366',
      'WEB-352',
    ]);
    expect(
      (await empty.gates({ linked: true })).filter(g => g.status === 'open')
    ).toEqual([]);
    expect(await empty.getRun(REPO, '20261008-1338')).toBeNull();
  });
});

describe('runsFixture', () => {
  it('lists the runs pages draw, newest first, with summaries the daemon would build', async () => {
    const list = await runs.listRuns();
    expect(list.map(r => r.ticket)).toEqual([
      'WEB-418',
      'WEB-412',
      'WEB-409',
      'WEB-401',
      'WEB-388',
      'WEB-376',
      'WEB-366',
      'WEB-352',
      'WEB-397',
    ]);
    const web412 = list.find(r => r.id === '20261008-1338')!;
    expect(web412).toMatchObject({
      repo: REPO,
      ticket: 'WEB-412',
      branch: 'web-412-linked-parcels',
      current_stage: 'implement',
      last_event_at: at('08T16:19'),
      evidence_count: 2,
      agent: { status: 'working' },
    });
    expect(web412.stages!.map(s => s.name)).toEqual([
      'provision',
      'plan',
      'gates',
      'evidence',
      'implement',
    ]);
    expect(list.some(r => r.id === '20261008-1502')).toBe(false);
  });

  it('reads a run by either form of its repo and refuses another repo', async () => {
    expect(
      (await runs.getRun('remote:acme/web', '20261008-1502'))?.run.id
    ).toBe('20261008-1502');
    expect(
      await runs.getRun('remote:acme%2Fother', '20261008-1502')
    ).toBeNull();
    expect(await runs.getRun(REPO, 'nope')).toBeNull();
  });

  it('serves run gates by subject prefix, by run and linked, never a hidden run on a list', async () => {
    const all = await runs.gates({});
    expect(all.every(g => g.subject.startsWith('run:'))).toBe(true);
    expect(all.some(g => g.subject === 'run:20261008-1600')).toBe(false);
    expect(
      (await runs.gates({ linked: true })).some(g => g.id === 'g-1502-post')
    ).toBe(false);
    expect((await runs.gates({ run: '20261008-1502' })).map(g => g.id)).toEqual(
      ['g-1502-post']
    );
    expect(
      (await runs.gates({ subject: 'run:20261008-1340' })).map(g => g.id)
    ).toEqual(['g-418-plan']);
    const [gate] = await runs.gates({ run: '20261008-1340' });
    expect(gate).toMatchObject({
      status: 'open',
      answer: null,
      closedAt: null,
      released: false,
      origin: { runId: '20261008-1340' },
    });
  });

  it('serves evidence images, the transcript, and nothing for a key the run lacks', async () => {
    const image = await runs.evidence(REPO, '20261008-1142', 'after');
    expect(image?.mime).toBe('image/png');
    expect([...image!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const transcript = await runs.evidence(REPO, '20261008-1142', 'transcript');
    expect(transcript?.mime).toBe('text/markdown');
    expect(new TextDecoder().decode(transcript!.bytes)).toContain(
      '0 warnings, 0 errors'
    );
    expect(await runs.evidence(REPO, '20261008-1338', 'after')).toBeNull();
    expect(await runs.evidence(REPO, '20261008-0900', 'before')).toBeNull();
  });

  it('serves the images a legacy run names, and nothing else', async () => {
    const dir = '/Users/acme/.mattstack/evidence/web-377';
    const before = await runs.legacyEvidenceFile(
      REPO,
      '20261007-1520',
      `${dir}/before.png`
    );
    expect(before?.mime).toBe('image/png');
    expect([...before!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(
      await runs.legacyEvidenceFile(REPO, '20261007-1520', `${dir}/after.png`)
    ).not.toBeNull();
    expect(
      await runs.legacyEvidenceFile(REPO, '20261007-1520', `${dir}/other.png`)
    ).toBeNull();
    expect(
      await runs.legacyEvidenceFile(REPO, '20261008-1142', `${dir}/before.png`)
    ).toBeNull();
    const d = await detail('20261007-1520');
    expect(parseEvidence(field(d, 'evidence')).version).toBe(0);
    expect((await runs.listRuns()).some(r => r.id === '20261007-1520')).toBe(
      false
    );
  });

  it('serves effective inputs and stage docs', async () => {
    const inputs = await runs.effectiveInputs(REPO, '20261008-0900');
    expect(inputs).toMatchObject({
      pipeline: 'work',
      workType: 'feature',
      stages: ['evidence', 'implement', 'self-review'],
      packDirty: false,
    });
    expect(inputs!.config).toHaveLength(3);
    expect(await runs.stageDoc(REPO, '20261008-1338', 'plan')).toContain(
      '# plan'
    );
    expect(await runs.stageDoc(REPO, '20261008-1338', 'nope')).toBeNull();
    expect(await runs.effectiveInputs(REPO, 'nope')).toBeNull();
  });

  it('enriches only the branches asked for', async () => {
    expect(
      Object.keys(await runs.enrich(['dedupe-contacts', 'other']))
    ).toEqual(['dedupe-contacts']);
  });

  it('serves no runs under a skills scenario', async () => {
    const clean = runsFixture('clean');
    expect(await clean.listRuns()).toEqual([]);
    expect(await clean.gates({ linked: true })).toEqual([]);
    expect(await clean.getRun(REPO, '20261008-1338')).toBeNull();
  });
});
