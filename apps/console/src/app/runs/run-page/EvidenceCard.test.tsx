import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { ParsedEvidence } from '@mattstack/rt-client';
import { parseEvidence } from '@mattstack/rt-client/evidence';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { EvidenceCard } = await import('./EvidenceCard');

const REPO = 'remote:acme%2Fweb';
const RUN = '20261008-1142';
const BASE = `/api/runs/${REPO}/${RUN}/evidence`;

function evidenceOf(fields: Record<string, string>) {
  return parseEvidence(JSON.stringify({ v: 1, ...fields }));
}

const BOTH = evidenceOf({
  before: '/fixture/evidence/web-409/before.png',
  beforeAnnotated: '/fixture/evidence/web-409/before-annotated.png',
  after: '/fixture/evidence/web-409/after.png',
  afterAnnotated: '/fixture/evidence/web-409/after-annotated.png',
  case: 'Rush order, Sep 14 delay, Denver',
  attach: 'ship',
});

const fetchMock = vi.fn();

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

function story(props: Partial<React.ComponentProps<typeof EvidenceCard>> = {}) {
  return mount(
    <EvidenceCard
      repo={REPO}
      runId={RUN}
      evidence={BOTH}
      variant="story"
      {...props}
    />
  );
}

function record(
  props: Partial<React.ComponentProps<typeof EvidenceCard>> = {}
) {
  return mount(
    <EvidenceCard
      repo={REPO}
      runId={RUN}
      evidence={BOTH}
      variant="record"
      {...props}
    />
  );
}

/** The provider tree leaves its own wrappers in the container; evidence
    content is any image, link or marked layer. */
function drawn(container: HTMLElement) {
  return [...container.querySelectorAll('img, a, [data-parity]')];
}

function shownSrcs(container: HTMLElement) {
  return [...container.querySelectorAll('img')].map(i => i.getAttribute('src'));
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('EvidenceCard story variant', () => {
  it('shows the annotated image first, with its file name as the caption', () => {
    const { container, getByText } = story();
    expect(shownSrcs(container)).toEqual([`${BASE}/beforeAnnotated`]);
    expect(getByText('before-annotated.png')).toBeInTheDocument();
    expect(getByText('EVIDENCE')).toBeInTheDocument();
  });

  it('switches between Plain and Annotated', async () => {
    const user = userEvent.setup();
    const { container, getByText } = story();
    await user.click(getByText('Plain'));
    expect(shownSrcs(container)).toEqual([`${BASE}/before`]);
    expect(getByText('before.png')).toBeInTheDocument();
    await user.click(getByText('Annotated'));
    expect(shownSrcs(container)).toEqual([`${BASE}/beforeAnnotated`]);
  });

  it('switches between Before and After when both exist', async () => {
    const user = userEvent.setup();
    const { container, getByText } = story();
    await user.click(getByText('After'));
    expect(shownSrcs(container)).toEqual([`${BASE}/afterAnnotated`]);
    expect(getByText('after-annotated.png')).toBeInTheDocument();
  });

  it('offers only the variants that exist', () => {
    const only = evidenceOf({ before: '/x/before.png' });
    const { queryByText, container } = story({ evidence: only });
    expect(queryByText('Plain')).toBeNull();
    expect(queryByText('Annotated')).toBeNull();
    expect(queryByText('Before')).toBeNull();
    expect(shownSrcs(container)).toEqual([`${BASE}/before`]);
  });

  it('shows one phase when asked, with no Before/After control', () => {
    const { container, queryByText } = story({ phase: 'after' });
    expect(queryByText('Before')).toBeNull();
    expect(shownSrcs(container)).toEqual([`${BASE}/afterAnnotated`]);
  });

  it('renders nothing for a phase that has no image', () => {
    const only = evidenceOf({ before: '/x/before.png' });
    const { container } = story({ evidence: only, phase: 'after' });
    expect(drawn(container)).toHaveLength(0);
  });

  it('replaces a broken image with a placeholder and does not request it again', () => {
    const requested: string[] = [];
    const setAttribute = Element.prototype.setAttribute;
    const spy = vi
      .spyOn(Element.prototype, 'setAttribute')
      .mockImplementation(function (this: Element, name, value) {
        if (this.tagName === 'IMG' && name === 'src') requested.push(value);
        return setAttribute.call(this, name, value);
      });
    try {
      const client = new QueryClient();
      const card = (
        <QueryClientProvider client={client}>
          <EvidenceCard
            repo={REPO}
            runId={RUN}
            evidence={BOTH}
            variant="story"
          />
        </QueryClientProvider>
      );
      const { container, getByText, rerender } = renderWithProviders(card);
      expect(requested).toEqual([`${BASE}/beforeAnnotated`]);
      fireEvent.error(container.querySelector('img')!);
      expect(getByText('image unavailable')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
      rerender(card);
      expect(requested).toEqual([`${BASE}/beforeAnnotated`]);
    } finally {
      spy.mockRestore();
    }
  });

  it('gives the next image a fresh try after a failure', async () => {
    const user = userEvent.setup();
    const { container, getByText } = story();
    fireEvent.error(container.querySelector('img')!);
    await user.click(getByText('Plain'));
    expect(shownSrcs(container)).toEqual([`${BASE}/before`]);
  });

  it('opens the image full size in a modal', async () => {
    const user = userEvent.setup();
    const { getByRole } = story();
    await user.click(
      getByRole('button', { name: /open before-annotated.png/i })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      `${BASE}/beforeAnnotated`
    );
  });
});

describe('EvidenceCard legacy and empty evidence', () => {
  it('lists the links of legacy evidence and requests no image', () => {
    vi.stubGlobal('fetch', fetchMock);
    const legacy = parseEvidence(
      '/Users/acme/.mattstack/evidence/web-412/before.png http://localhost:4001/orders/4821'
    );
    const { container } = story({ evidence: legacy });
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '/Users/acme/.mattstack/evidence/web-412/before.png'
    );
    expect(
      [...container.querySelectorAll('a')].map(a => a.textContent)
    ).toEqual(['http://localhost:4001/orders/4821']);
  });

  it('links web addresses and shows a file path as plain text', () => {
    const legacy = parseEvidence(
      '/Users/acme/before.png http://localhost:4001/orders/4821'
    );
    const { container, getByText } = story({ evidence: legacy });
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map(a => a.getAttribute('href'))).toEqual([
      'http://localhost:4001/orders/4821',
    ]);
    expect(getByText('/Users/acme/before.png').closest('a')).toBeNull();
  });

  it('renders nothing when there is no evidence', () => {
    const { container } = story({ evidence: parseEvidence('') });
    expect(drawn(container)).toHaveLength(0);
  });
});

describe('EvidenceCard record variant', () => {
  it('draws Before and After thumbnails with their captions and the count', () => {
    const { container, getByText } = record({ mrIid: '405' });
    expect(shownSrcs(container)).toEqual([`${BASE}/before`, `${BASE}/after`]);
    expect(getByText('EVIDENCE · 4')).toBeInTheDocument();
    expect(getByText('Before')).toBeInTheDocument();
    expect(getByText('after.png')).toBeInTheDocument();
  });

  it('says where the evidence is attached when it went to the ship MR', () => {
    const { getByText } = record({ mrIid: '405' });
    expect(getByText('attached to !405')).toBeInTheDocument();
  });

  it.each([
    ['no own MR', BOTH, null],
    [
      'attach is not ship',
      evidenceOf({ before: '/x/before.png', attach: 'none' }),
      '405',
    ],
  ])('does not claim an attachment with %s', (_, evidence, mrIid) => {
    const { queryByText } = record({ evidence, mrIid });
    expect(queryByText(/attached to/)).toBeNull();
  });

  it('shows the case used', () => {
    const { getByText } = record();
    expect(getByText('CASE USED')).toBeInTheDocument();
    expect(getByText('Rush order, Sep 14 delay, Denver')).toBeInTheDocument();
  });

  it('omits the case card and the transcript when the run recorded neither', () => {
    vi.stubGlobal('fetch', fetchMock);
    const { queryByText } = record({
      evidence: evidenceOf({ before: '/x/before.png' }),
    });
    expect(queryByText('CASE USED')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the transcript when the evidence names one', async () => {
    fetchMock.mockResolvedValue(
      new Response('GET /api 200', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { findByText } = record({
      evidence: evidenceOf({
        before: '/x/before.png',
        transcript: '/x/transcript-after.log',
      }),
    });
    expect(await findByText('GET /api 200')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/transcript`);
  });

  it('opens the compare modal from the button, on Before first', async () => {
    const user = userEvent.setup();
    const { getByRole } = record();
    await user.click(getByRole('button', { name: /compare full size/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute(
        'src',
        `${BASE}/beforeAnnotated`
      )
    );
  });

  it('opens the compare modal on the phase and variant of the thumbnail clicked', async () => {
    const user = userEvent.setup();
    const { getByRole } = record();
    await user.click(getByRole('button', { name: /open after\.png/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      `${BASE}/after`
    );
  });

  it('draws no thumbnails, count or compare button when there are no images', () => {
    const noImages: ParsedEvidence = {
      version: 1,
      evidence: { v: 1, before: '', case: 'Only a case' },
      images: [],
    };
    const { getByText, queryByText, queryByRole } = record({
      evidence: noImages,
    });
    expect(getByText('Only a case')).toBeInTheDocument();
    expect(queryByText(/EVIDENCE/)).toBeNull();
    expect(queryByRole('button', { name: /compare full size/i })).toBeNull();
  });
});
