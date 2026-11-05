import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { UsageActivityData } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

const { ActivityBody } = await import('./StepActivity');

const data = (over: Partial<UsageActivityData> = {}): UsageActivityData => ({
  transcriptFound: true,
  sessionsMissing: 0,
  prompts: [],
  promptCount: 0,
  agents: [],
  agentCount: 0,
  tools: [],
  ...over,
});

function body(d: UsageActivityData) {
  const { queryByTestId, container } = renderWithProviders(
    <ActivityBody data={d} />
  );
  return {
    gone: queryByTestId('transcript-gone')?.textContent ?? null,
    empty: queryByTestId('activity-empty') !== null,
    text: container.textContent ?? '',
  };
}

describe('ActivityBody', () => {
  it('says the transcript is gone when no session has one', () => {
    const b = body(data({ transcriptFound: false, sessionsMissing: 2 }));
    expect(b.gone).toContain('no longer on this Mac');
    expect(b.empty).toBe(false);
  });

  it('reads a transcript with nothing in it as empty, not gone', () => {
    const b = body(data());
    expect(b.gone).toBeNull();
    expect(b.empty).toBe(true);
  });

  it('warns the list may be short when one session is missing', () => {
    const b = body(
      data({
        sessionsMissing: 1,
        prompts: [{ ts: 0, text: 'ship it' }],
        promptCount: 1,
      })
    );
    expect(b.gone).toBe(
      '1 session in this step has no transcript left, so this list may be short.'
    );
    expect(b.text).toContain('ship it');
  });
});
