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
  it('shows the phase as thumbnails, plain then annotated, each named under it', () => {
    const { container, getByText } = story({ phase: 'before' });
    expect(shownSrcs(container)).toEqual([
      `${BASE}/before`,
      `${BASE}/beforeAnnotated`,
    ]);
    expect(getByText('before.png')).toBeInTheDocument();
    expect(getByText('before-annotated.png')).toBeInTheDocument();
    expect(container.querySelector('[data-parity="Evidence card"]')).toBeNull();
  });

  it('shows the asked phase only', () => {
    const { container } = story({ phase: 'after' });
    expect(shownSrcs(container)).toEqual([
      `${BASE}/after`,
      `${BASE}/afterAnnotated`,
    ]);
  });

  it('renders nothing for a phase that has no image', () => {
    const only = evidenceOf({ before: '/x/before.png' });
    const { container } = story({ evidence: only, phase: 'after' });
    expect(drawn(container)).toHaveLength(0);
  });

  it.each(['before', 'after'] as const)(
    'links the url on the row that carries it (%s), without its scheme',
    phase => {
      const withUrl = evidenceOf({
        before: '/x/before.png',
        after: '/x/after.png',
        url: 'http://localhost:4001/orders/4821#parcels',
      });
      const carrying = story({ evidence: withUrl, phase, withUrl: true });
      const links = [...carrying.container.querySelectorAll('a')];
      expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
        [
          'localhost:4001/orders/4821#parcels',
          'http://localhost:4001/orders/4821#parcels',
        ],
      ]);
      carrying.unmount();
      const other = story({ evidence: withUrl, phase });
      expect(other.container.querySelectorAll('a')).toHaveLength(0);
    }
  );

  it('opens the compare modal full size from "Open full size"', async () => {
    const user = userEvent.setup();
    const { getByRole } = story({ phase: 'before' });
    await user.click(getByRole('button', { name: /open full size/i }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('img')
        .map(i => i.getAttribute('src'))
    ).toEqual([`${BASE}/beforeAnnotated`, `${BASE}/afterAnnotated`]);
  });

  it('opens the compare modal on the thumbnail clicked', async () => {
    const user = userEvent.setup();
    const { getByRole } = story({ phase: 'before' });
    await user.click(getByRole('button', { name: /open before\.png/i }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('img')
        .map(i => i.getAttribute('src'))
    ).toEqual([`${BASE}/before`]);
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
      const only = evidenceOf({ before: '/x/before.png' });
      const card = (
        <QueryClientProvider client={client}>
          <EvidenceCard
            repo={REPO}
            runId={RUN}
            evidence={only}
            variant="story"
            phase="before"
          />
        </QueryClientProvider>
      );
      const { container, getByText, rerender } = renderWithProviders(card);
      expect(requested).toEqual([`${BASE}/before`]);
      fireEvent.error(container.querySelector('img')!);
      expect(getByText('image unavailable')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
      rerender(card);
      expect(requested).toEqual([`${BASE}/before`]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('EvidenceCard legacy and empty evidence', () => {
  const DIR = '/Users/acme/.mattstack/evidence/web-377';
  const LEGACY = parseEvidence(
    `${DIR}/before.png ${DIR}/after.png http://localhost:4001/orders/4821#parcels 12/12 cards`
  );
  const fileSrc = (path: string) =>
    `/api/runs/${REPO}/${RUN}/evidence-file?path=${encodeURIComponent(path)}`;

  it.each(['story', 'record'] as const)(
    'shows legacy screenshots as images and the url as a link (%s)',
    variant => {
      const { container } = mount(
        <EvidenceCard
          repo={REPO}
          runId={RUN}
          evidence={LEGACY}
          variant={variant}
        />
      );
      expect(shownSrcs(container)).toEqual([
        fileSrc(`${DIR}/before.png`),
        fileSrc(`${DIR}/after.png`),
      ]);
      expect(container.textContent).toContain('before.png');
      const links = [...container.querySelectorAll('a')];
      expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
        [
          'localhost:4001/orders/4821#parcels',
          'http://localhost:4001/orders/4821#parcels',
        ],
      ]);
      expect(container.textContent).not.toContain('/12');
    }
  );

  it('fills a record tile with each thumbnail, legacy or v1, and keeps the modal whole', async () => {
    const fit = (img: Element) =>
      (img as HTMLElement).style.getPropertyValue('--image-object-fit');
    const legacy = mount(
      <EvidenceCard
        repo={REPO}
        runId={RUN}
        evidence={LEGACY}
        variant="record"
        ticket="WEB-377"
      />
    );
    const thumbs = [...legacy.container.querySelectorAll('img')];
    expect(thumbs.map(fit)).toEqual(['cover', 'cover']);
    await userEvent.setup().click(thumbs[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(fit(within(dialog).getByRole('img'))).not.toBe('cover');
    legacy.unmount();
    const v1 = record();
    expect([...v1.container.querySelectorAll('img')].map(fit)).toEqual([
      'cover',
      'cover',
    ]);
  });

  it('opens a legacy screenshot full size under the ticket and its name', async () => {
    const user = userEvent.setup();
    const { getByRole } = story({ evidence: LEGACY, ticket: 'WEB-377' });
    await user.click(getByRole('button', { name: /open after\.png/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      fileSrc(`${DIR}/after.png`)
    );
    expect(within(dialog).getByText('WEB-377 · after.png')).toBeInTheDocument();
  });

  it('shows a placeholder for a legacy screenshot the route will not serve', () => {
    const { container, getByText } = story({ evidence: LEGACY });
    fireEvent.error(container.querySelectorAll('img')[1]!);
    expect(getByText('image unavailable')).toBeInTheDocument();
    expect(shownSrcs(container)).toEqual([fileSrc(`${DIR}/before.png`)]);
  });

  it('opens a file path in the editor when it can, else shows it as text', () => {
    const legacy = parseEvidence('/Users/acme/notes.md /Users/acme/run.log');
    const { container, getByText } = story({
      evidence: legacy,
      pathHref: p => (p.endsWith('.md') ? `vscode://file${p}` : null),
    });
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(getByText('/Users/acme/notes.md').closest('a')).toHaveAttribute(
      'href',
      'vscode://file/Users/acme/notes.md'
    );
    expect(getByText('/Users/acme/run.log').closest('a')).toBeNull();
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

  it('opens the compare modal from the button, side by side', async () => {
    const user = userEvent.setup();
    const { getByRole } = record();
    await user.click(getByRole('button', { name: /compare full size/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('img')
          .map(i => i.getAttribute('src'))
      ).toEqual([`${BASE}/beforeAnnotated`, `${BASE}/afterAnnotated`])
    );
  });

  it('hands the compare request to the page when the page owns the modal', async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();
    const { getByRole } = record({ onCompare });
    await user.click(getByRole('button', { name: /compare full size/i }));
    await user.click(getByRole('button', { name: /open after\.png/i }));
    expect(onCompare.mock.calls).toEqual([
      [{}],
      [{ mode: 'after', variant: 'plain' }],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
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
