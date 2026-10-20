import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { readReviewGate } from '../review-gate.ts';

// turbo.json declares these script and fixture paths as board#test inputs.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const REVIEW = join(ROOT, 'plugins/mattstack/attachments/review/review');

/** The questions a real re-review opens: the engine's own scripts run over
    its own fixture. */
function fittedGate(
  fixture: string,
  extras = join(REVIEW, 'tests/fixtures/extras.json')
) {
  const source = Bun.spawnSync([
    'sh',
    join(REVIEW, 'scripts/review-source.sh'),
    join(REVIEW, 'tests/fixtures', fixture),
    extras,
  ]);
  expect(source.exitCode).toBe(0);
  const fit = Bun.spawnSync(
    ['sh', join(REVIEW, 'scripts/gate-ctx.sh'), 'fit'],
    { stdin: source.stdout }
  );
  expect(fit.exitCode).toBe(0);
  const open = JSON.parse(fit.stdout.toString()) as {
    context: string;
    questions: never[];
  };
  return {
    kind: 'review-post',
    context: open.context,
    meta: null,
    questions: open.questions,
  };
}

describe('the review scripts and the review sheet agree', () => {
  test('a v3 re-review opens as a sheet with one card per earlier thread', () => {
    const gate = readReviewGate(fittedGate('findings-v3.json') as never);
    expect(gate).not.toBeNull();
    expect(
      gate!.carryovers.map(c => [c.name, c.threadId, c.carry.call])
    ).toEqual([
      ['thread-1', 'a1b2', 'fixed'],
      ['thread-2', 'c3d4', 'pushback-accepted'],
      ['thread-3', 'e5f6', 'not-fixed'],
    ]);
    expect(gate!.carryovers[0]!.defaults).toEqual([
      'post:a1b2',
      'resolve:a1b2',
    ]);
    expect(gate!.carryovers[2]!.defaults).toEqual(['post:e5f6']);
    expect(gate!.carryovers[2]!.carry.authorReply).toBeUndefined();
    expect([...gate!.findings.keys()]).toEqual(['f1']);
    expect(gate!.rest.map(q => q.id)).toEqual([
      'findings-1',
      'skipped-1',
      'skipped-2',
      'outcome',
    ]);
    expect(gate!.skipped.size).toBe(5);
  });

  test('skipped findings join their restore options across chunks', () => {
    const gate = readReviewGate(fittedGate('findings-v3.json') as never);
    expect([...gate!.skipped.keys()]).toEqual([
      'restore:r1-f3',
      'restore:r1-f5',
      'restore:r2-f1',
      'restore:r2-f2',
      'restore:r2-f4',
    ]);
    expect(gate!.skipped.get('restore:r1-f3')).toEqual({
      id: 'r1-f3',
      round: 1,
      severity: 'minor',
      title: 'unused import in the retry module',
      file: 'queue/retry.ts:3',
      changed: true,
    });
  });

  test('a twelve-finding drafted review opens as a sheet with every draft whole', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-drafts-'));
    const extras = join(dir, 'extras.json');
    const base = JSON.parse(
      readFileSync(join(REVIEW, 'tests/fixtures/extras.json'), 'utf8')
    ) as Record<string, unknown>;
    writeFileSync(extras, JSON.stringify({ ...base, editable: true }));
    const report = JSON.parse(
      readFileSync(
        join(REVIEW, 'tests/fixtures/findings-v3-drafts.json'),
        'utf8'
      )
    ) as {
      summary: { comment: string };
      findings: Array<{ id: string; comment: string }>;
    };
    const gate = readReviewGate(
      fittedGate('findings-v3-drafts.json', extras) as never
    );
    rmSync(dir, { recursive: true, force: true });
    expect(gate).not.toBeNull();
    expect(gate!.review.editable).toBe(true);
    expect(gate!.review.summaryComment).toBe(report.summary.comment);
    expect(gate!.findings.size).toBe(12);
    for (const f of report.findings)
      expect(gate!.findings.get(f.id)?.comment).toBe(f.comment);
  });

  test('a v2 first review still opens with no earlier threads', () => {
    const gate = readReviewGate(fittedGate('findings-v2.json') as never);
    expect(gate).not.toBeNull();
    expect(gate!.carryovers).toEqual([]);
    expect(gate!.skipped.size).toBe(0);
  });
});
