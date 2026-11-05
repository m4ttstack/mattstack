import { expect, test } from 'vitest';

import { previewAnswers } from './preview-states';

test('a URL with no state changes nothing', () => {
  expect(previewAnswers('')).toEqual([]);
  expect(previewAnswers('?theme=dark')).toEqual([]);
});

test('empty clears rooms and agents, no-messages keeps them', () => {
  const paths = (search: string) => previewAnswers(search).map(a => a[0]);
  expect(paths('?state=empty')).toContain('/api/chat/rooms');
  expect(paths('?state=no-messages')).not.toContain('/api/chat/rooms');
  expect(paths('?state=no-messages')).toContain('/api/chat/direct');
});
