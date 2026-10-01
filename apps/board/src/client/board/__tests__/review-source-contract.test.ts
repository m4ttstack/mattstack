import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { readReviewGate } from '../review-gate.ts';

// turbo.json declares these script and fixture paths as board#test inputs.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const REVIEW = join(ROOT, 'plugins/mattstack/attachments/review/review');

/** The questions a real re-review opens: the engine's own scripts run over
    its own fixture. */
function fittedGate(fixture: string) {
  const source = Bun.spawnSync([
    'sh',
    join(REVIEW, 'scripts/review-source.sh'),
    join(REVIEW, 'tests/fixtures', fixture),
    join(REVIEW, 'tests/fixtures/extras.json'),
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
  });

  test('a v2 first review still opens with no earlier threads', () => {
    const gate = readReviewGate(fittedGate('findings-v2.json') as never);
    expect(gate).not.toBeNull();
    expect(gate!.carryovers).toEqual([]);
  });
});
