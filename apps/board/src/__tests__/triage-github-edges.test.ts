import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from 'bun:test';

import type { BoardMR } from '../data.ts';
import { ownMrFacts } from '../run-owner-io.ts';
import { detectEdges, markHandled, observe } from '../triage/edge.ts';
import { unparsedRedLines } from '../triage/forge-plan.ts';
import type { DispatchMemory } from '../triage/memory.ts';
import { composeFixClasses } from '../triage/run.ts';
import { triageOwns } from '../triage/seat.ts';

type Row = BoardMR & { webUrl: string };

const DAY = '2026-11-12';
const rows = (): Row[] =>
  (
    JSON.parse(
      readFileSync(
        join(
          import.meta.dir,
          '..',
          '..',
          'tests',
          'fixture-github',
          'data.json'
        ),
        'utf8'
      )
    ) as { mrs: Row[] }
  ).mrs;
const rowOf = (iid: number): Row => rows().find(r => r.iid === iid)!;
const owned = () => rows().filter(r => triageOwns(r, 'mkeller', 'mkeller'));
const fresh = (): DispatchMemory => ({ identity: null, mrs: {} });

test('the seat owns only its own PRs as the recorded username', () => {
  expect(owned().map(r => r.iid)).toEqual([4102, 4103, 4105, 4106, 4107, 4108]);
});

test('a red PR fires pipeline-red with its workflow run id', () => {
  const facts = owned().map(ownMrFacts);
  const mem = fresh();
  observe(mem, facts, DAY);
  const edges = detectEdges(mem, facts);
  expect(edges).toHaveLength(2);
  expect(edges[0]).toMatchObject({
    iid: 4107,
    kind: 'pipeline-red',
    pipelineId: 7004107,
  });
  expect(edges[1]).toMatchObject({
    iid: 4108,
    kind: 'needs-rebase',
    pipelineId: 7004108,
  });
});

test('a handled run stays quiet and a new push fires again', () => {
  const facts = owned().map(ownMrFacts);
  const mem = fresh();
  observe(mem, facts, DAY);
  const red = detectEdges(mem, facts).find(e => e.iid === 4107)!;
  markHandled(mem, red);
  expect(detectEdges(mem, facts).some(e => e.iid === 4107)).toBe(false);

  const pushed = rowOf(4107);
  pushed.pipeline!.id = 'github:run:7004199';
  const again = detectEdges(mem, [ownMrFacts(pushed)]);
  expect(again).toHaveLength(1);
  expect(again[0]).toMatchObject({
    iid: 4107,
    kind: 'pipeline-red',
    pipelineId: 7004199,
  });
});

test('a second workflow failing on the same commit keeps the handled id quiet', () => {
  const facts = owned().map(ownMrFacts);
  const mem = fresh();
  observe(mem, facts, DAY);
  const red = detectEdges(mem, facts).find(e => e.iid === 4107)!;
  markHandled(mem, red);

  // glance 0.33 keeps the lowest run id on the head commit, so a later run
  // of another workflow adds to runIds and leaves pipeline.id where it was.
  const later = rowOf(4107);
  const pipeline = later.pipeline as NonNullable<Row['pipeline']> & {
    runIds: string[];
  };
  pipeline.jobs.push({
    ...pipeline.jobs[0]!,
    id: 'github:check:41079',
    name: 'typecheck',
    status: 'failed',
    runId: '7004150',
  });
  pipeline.runIds = [...pipeline.runIds, '7004150'];
  expect(pipeline.id).toBe('github:run:7004107');
  const facts2 = ownMrFacts(later);
  observe(mem, [facts2], DAY);
  expect(detectEdges(mem, [facts2])).toEqual([]);
});

test('a behind PR fires needs-rebase once until it is clean', () => {
  const facts = ownMrFacts(rowOf(4108));
  const mem = fresh();
  observe(mem, [facts], DAY);
  const edge = detectEdges(mem, [facts]).find(e => e.kind === 'needs-rebase')!;
  markHandled(mem, edge);
  expect(detectEdges(mem, [facts])).toEqual([]);

  observe(mem, [{ ...facts, needsRebase: false }], DAY);
  observe(mem, [facts], DAY);
  expect(detectEdges(mem, [facts]).map(e => e.kind)).toEqual(['needs-rebase']);
});

test('statuses-only CI gives no edge and is named', () => {
  const facts = ownMrFacts(rowOf(4104));
  expect(facts.pipelineId).toBeNull();
  expect(facts.pipelineState).toBe('failed');
  const mem = fresh();
  observe(mem, [facts], DAY);
  expect(detectEdges(mem, [facts]).some(e => e.kind === 'pipeline-red')).toBe(
    false
  );
  expect(
    unparsedRedLines([facts]).some(line =>
      line.includes('https://github.com/acme/webapp/pull/4104')
    )
  ).toBe(true);
});

test('a recorded username in another case owns the PR but licenses no branch writes', () => {
  expect(triageOwns(rowOf(4107), 'mkeller', 'MKeller')).toBe(true);
  const fc = {
    retryFlake: true,
    inheritedNoteDraft: false,
    cleanApiRebase: false,
    mechanicalLint: true,
    codeFix: true,
  };
  const exact = composeFixClasses(fc, 'mkeller', 'mkeller');
  expect(exact).toContain('code-fix');
  expect(exact).toContain('mechanical-lint');
  const cased = composeFixClasses(fc, 'mkeller', 'MKeller');
  expect(cased).not.toContain('code-fix');
  expect(cased).not.toContain('mechanical-lint');
  expect(cased).toContain('retry-flake');
});
