import { describe, expect, test } from 'bun:test';

import {
  armedLatchBody,
  imageMarkdownOf,
  LATCH_MARKER,
  LATCH_MARKER_SPENT,
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

  // A duplicate consumed by a dispatch or a cooldown refusal must never read
  // as an approval that did not happen, however the MR's real outcome lands.
  test('a duplicate reason gets the superseded wording, not approved', () => {
    const body = spentLatchBody(IMG, 'duplicate');
    expect(body).toContain('Superseded by a newer latch on this MR');
    expect(body).not.toContain('Approved');
  });

  test('neither body uses an em dash or en dash', () => {
    expect(armedLatchBody(IMG)).not.toMatch(/[–—]/);
    expect(spentLatchBody(IMG)).not.toMatch(/[–—]/);
  });
});

describe('imageMarkdownOf', () => {
  // The spend reuses the already-uploaded banner rather than uploading again,
  // so it has to read the path back out of the armed body.
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
