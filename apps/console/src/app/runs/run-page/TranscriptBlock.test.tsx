import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { TranscriptBlock } = await import('./TranscriptBlock');

const REPO = 'remote:acme%2Fweb';
const fetchMock = vi.fn();

function answer(body: string, type: string, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': type } })
  );
  vi.stubGlobal('fetch', fetchMock);
}

function block() {
  const client = new QueryClient();
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <TranscriptBlock repo={REPO} runId="r1" />
    </QueryClientProvider>
  );
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('TranscriptBlock', () => {
  it('asks for the transcript of this run', async () => {
    answer('ok', 'text/plain; charset=utf-8');
    const { findByText } = block();
    await findByText('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/runs/${REPO}/r1/evidence/transcript`
    );
  });

  it('renders a markdown transcript as markdown', async () => {
    answer('# Run log\n\n- one\n- two', 'text/markdown; charset=utf-8');
    const { findByRole, container } = block();
    expect(
      await findByRole('heading', { name: 'Run log' })
    ).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(
      container.querySelector('[data-transcript="markdown"]')
    ).not.toBeNull();
  });

  it('renders any other transcript as monospace text, as written', async () => {
    answer('# not a heading\nGET /api 200', 'text/plain; charset=utf-8');
    const { findByText, queryByRole, container } = block();
    await findByText(/GET \/api 200/);
    expect(queryByRole('heading')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(
      '# not a heading\nGET /api 200'
    );
  });

  it('keeps every line of a long transcript behind a "show all" fold', async () => {
    const text = Array.from({ length: 55 }, (_, i) => `line ${i + 1}`).join(
      '\n'
    );
    answer(text, 'text/plain; charset=utf-8');
    const { findByText, container } = block();
    await findByText(/line 55/);
    const fold = container.querySelector('[data-transcript="plain"]');
    expect(fold?.className).toMatch(/Spoiler/);
    expect(fold?.querySelector('pre')?.textContent).toBe(text);
  });

  it('offers no "show all" for a short transcript', async () => {
    answer('a\nb\n', 'text/plain; charset=utf-8');
    const { findByText, queryByRole } = block();
    await findByText(/a/);
    expect(queryByRole('button')).toBeNull();
  });

  it('draws nothing for a run with no transcript', async () => {
    answer('{"error":"no evidence"}', 'application/json', 404);
    const { container } = block();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('[class*="Skeleton"]')).toBeNull()
    );
    expect(container.querySelector('[data-parity], pre, p')).toBeNull();
  });

  it('says so, once, when the transcript fails to load', async () => {
    answer('boom', 'text/plain', 502);
    const { findByText } = block();
    expect(await findByText('transcript unavailable')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a hostile markdown transcript inert', async () => {
    answer(
      [
        '<script>window.pwned = 1</script>',
        '<img src="http://evil.test/x.png" onerror="window.pwned = 2">',
        '![tracker](http://evil.test/pixel.png)',
        '[click](javascript:window.pwned=3)',
        '[safe](https://acme.test/ok)',
      ].join('\n\n'),
      'text/markdown; charset=utf-8'
    );
    const { findByText, container } = block();
    await findByText('click');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    const hrefs = [...container.querySelectorAll('a')].map(a =>
      a.getAttribute('href')
    );
    expect(hrefs.some(h => h?.toLowerCase().startsWith('javascript:'))).toBe(
      false
    );
    expect(hrefs).toContain('https://acme.test/ok');
    expect((window as { pwned?: number }).pwned).toBeUndefined();
  });
});
