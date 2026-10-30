import { describe, expect, test } from 'bun:test';

import type { LatchPhase } from '../latch/latch-state.ts';
import {
  armedLatchBody,
  imageMarkdownFor,
  imageMarkdownOf,
  LATCH_MARKER,
  LATCH_MARKER_ERROR,
  LATCH_MARKER_QUEUED,
  LATCH_MARKER_RUNNING,
  LATCH_MARKER_SPENT,
  latchBody,
  latchKindOf,
  spentLatchBody,
} from '../latch/markers.ts';

const IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';

describe('bodies', () => {
  test('armed body leads with the marker and carries the image', () => {
    const body = armedLatchBody(IMG);
    expect(body.startsWith(LATCH_MARKER)).toBe(true);
    expect(body).toContain(IMG);
    expect(body).toContain('Resolve this thread');
  });

  test('spent body leads with the spent marker and keeps the image', () => {
    const body = spentLatchBody(IMG);
    expect(body.startsWith(LATCH_MARKER_SPENT)).toBe(true);
    expect(body).toContain(IMG);
  });

  test('spent body defaults to the approved wording', () => {
    expect(spentLatchBody(IMG)).toContain('Approved, so this latch is spent');
  });

  test('neither body uses an em dash or en dash', () => {
    expect(armedLatchBody(IMG)).not.toMatch(/[–—]/);
    expect(spentLatchBody(IMG)).not.toMatch(/[–—]/);
  });
});

describe('latchBody', () => {
  const GIF = '![Follow-up review queued](/uploads/a/b.gif)';
  const MARKERS: Record<LatchPhase, string> = {
    armed: LATCH_MARKER,
    queued: LATCH_MARKER_QUEUED,
    running: LATCH_MARKER_RUNNING,
    error: LATCH_MARKER_ERROR,
    spent: LATCH_MARKER_SPENT,
  };

  for (const phase of Object.keys(MARKERS) as LatchPhase[]) {
    test(`a ${phase} body leads with its marker and reads back as ${phase}`, () => {
      const body = latchBody(phase, GIF, 'A sentence.');
      expect(body.split('\n')[0]).toBe(MARKERS[phase]);
      expect(latchKindOf(body)).toBe(phase);
    });
  }

  test('marker, blank, image, blank, sentence', () => {
    expect(latchBody('running', GIF, 'In progress.')).toBe(
      `${LATCH_MARKER_RUNNING}\n\n${GIF}\n\nIn progress.\n`
    );
  });
});

describe('imageMarkdownFor', () => {
  test('titles the upload and leaves it unsized, so GitLab fills the column', () => {
    expect(
      imageMarkdownFor(
        'Follow-up review running',
        '![latch-7-running.gif](/uploads/c0ffee/latch-7-running.gif)'
      )
    ).toBe('![Follow-up review running](/uploads/c0ffee/latch-7-running.gif)');
  });

  test('drops the width from an older sized banner', () => {
    expect(
      imageMarkdownFor(
        'Follow-up review running',
        '![Follow-up review running](/uploads/c0ffee/latch-7-running.gif){width=520}'
      )
    ).toBe('![Follow-up review running](/uploads/c0ffee/latch-7-running.gif)');
  });
});

describe('imageMarkdownOf', () => {
  test('matches an unsized gif', () => {
    const img = '![x](/uploads/a/b.gif)';
    expect(imageMarkdownOf(latchBody('queued', img, 'Queued.'))).toBe(img);
  });

  test('still matches an older gif with a width suffix', () => {
    const img = '![x](/uploads/a/b.gif){width=520}';
    expect(imageMarkdownOf(latchBody('queued', img, 'Queued.'))).toBe(img);
  });

  test('still matches the old png banner', () => {
    const img = '![re-review latch](/uploads/a/b.png)';
    expect(imageMarkdownOf(armedLatchBody(img))).toBe(img);
  });

  test('round-trips the image out of an armed body', () => {
    expect(imageMarkdownOf(armedLatchBody(IMG))).toBe(IMG);
  });

  test('round-trips the image out of a spent body', () => {
    expect(imageMarkdownOf(spentLatchBody(IMG))).toBe(IMG);
  });

  test('returns null when there is no image', () => {
    expect(imageMarkdownOf(`${LATCH_MARKER}\n\nno picture here`)).toBeNull();
  });
});
