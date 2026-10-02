import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from 'wouter/use-browser-location';

import { designFixture, designSource } from './designFixtures';

const anatomyGet = vi.fn();
const sourceGet = vi.fn();
const compileGet = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        packs: {
          $get: () =>
            Promise.resolve(
              ok({
                packs: [
                  {
                    name: 'acme',
                    dir: '/fixture/packs/acme',
                    layout: 'grouped',
                  },
                ],
              })
            ),
        },
        composition: {
          $get: () => Promise.resolve(ok(designFixture('composition'))),
        },
        check: { $get: () => Promise.resolve(ok(designFixture('check'))) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        changes: {
          $get: () => Promise.resolve(ok(designFixture('changes.clean'))),
        },
        source: { $get: (...args: unknown[]) => sourceGet(...args) },
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
        surface: {
          $get: () =>
            Promise.resolve(
              ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
            ),
          apply: { $post: vi.fn() },
        },
        sync: { $post: vi.fn() },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve(ok({ editor: 'zed' })),
        },
      },
    },
  },
}));

const { WiringMap } = await import('../../WiringMap');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

const ROW_HEIGHT = 19;
const VIEWPORT_HEIGHT = 380;

let restoreLayout: () => void;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: ROW_HEIGHT,
    viewportHeight: VIEWPORT_HEIGHT,
    contentHeight: 1000 * ROW_HEIGHT,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  restoreLayout();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

function mockDesignPack(stagePlan = designFixture('anatomy.stage-plan')) {
  const anatomy: Record<string, unknown> = {
    work: designFixture('anatomy.work'),
    'stage-plan': stagePlan,
  };
  anatomyGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(ok(anatomy[query.skill]))
  );
  sourceGet.mockImplementation(({ query }: { query: { path: string } }) =>
    Promise.resolve(ok(designSource(query.path)))
  );
  compileGet.mockResolvedValue(
    ok({
      content: designSource('/fixture/packs/acme/skills/work/SKILL.md').content,
    })
  );
}

function renderAt(search: string) {
  window.history.pushState(null, '', `/wiring${search}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <WiringMap />
    </QueryClientProvider>
  );
}

const params = () => new URLSearchParams(window.location.search);

const drawer = () => screen.findByTestId('skill-drawer');

/** The drawer once its file has loaded. */
async function drawerText() {
  const text = await screen.findByTestId('drawer-text');
  await waitFor(() => expect(text.querySelector('[data-line]')).not.toBeNull());
  return text;
}

const lineRow = (text: HTMLElement, line: number) =>
  text.querySelector(`[data-line="${line}"]`) as HTMLElement | null;

describe('SkillDrawer', () => {
  it('opens a stale skill text row on its template, the range highlighted', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');

    const panel = await drawer();
    expect(within(panel).getByTestId('drawer-file')).toHaveTextContent(
      'work/SKILL.md'
    );
    expect(within(panel).getByTestId('drawer-chip')).toHaveTextContent('L1-28');
    expect(within(panel).getByTestId('drawer-sentence')).toHaveTextContent(
      '28 lines of orchestrator text, as written in the template.'
    );
    expect(within(panel).getByTestId('drawer-meta')).toHaveTextContent(
      'mattstack 0.30.4 · installed copy, read only'
    );
    expect(within(panel).queryByRole('tablist')).toBeNull();

    const text = await drawerText();
    expect(sourceGet).toHaveBeenCalledWith({
      query: {
        pack: 'acme',
        path: '/fixture/mattstack/attachments/pipeline/work/SKILL.md',
      },
    });
    expect(lineRow(text, 1)).toHaveAttribute('data-highlighted');
    expect(lineRow(text, 28)).toHaveAttribute('data-highlighted');
    expect(lineRow(text, 29)).not.toHaveAttribute('data-highlighted');
    expect(
      within(lineRow(text, 29)!).getByText(/verb\.path:stage-provision/)
    ).toHaveAttribute('data-tinted');
  });

  it('opens an include row on the rendered file, banded by the parts pasted in', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=row:140');

    const panel = await drawer();
    expect(within(panel).getByTestId('drawer-file')).toHaveTextContent(
      'stage-plan/SKILL.md'
    );
    expect(within(panel).getByText('rendered')).toBeInTheDocument();
    expect(within(panel).getByTestId('drawer-chip')).toHaveTextContent(
      'L140 → L303-752'
    );
    expect(within(panel).getByTestId('drawer-sentence')).toHaveTextContent(
      'gate-protocol is pasted here: 450 lines, 58% of what the agent reads in this step.'
    );
    expect(
      within(panel)
        .getAllByRole('tab')
        .map(tab => tab.textContent)
    ).toEqual(['Text', 'History']);

    const text = await drawerText();
    // Opened a little above the range, so the part before it shows too.
    expect(lineRow(text, 288)).not.toBeNull();
    expect(lineRow(text, 303)).toHaveAttribute('data-highlighted');
    expect(within(lineRow(text, 288)!).getByText('plan-policy')).toBeTruthy();
    expect(within(lineRow(text, 303)!).getByText('gate-protocol')).toBeTruthy();
    expect(lineRow(text, 303)!.querySelector('[data-gutter]')).toHaveAttribute(
      'data-tone',
      'accent'
    );
    expect(lineRow(text, 290)!.querySelector('[data-gutter]')).toHaveAttribute(
      'data-tone',
      'muted'
    );
  });

  it('draws no band where a slot fill stops short of the next part', async () => {
    mockDesignPack(designFixture('anatomy.stage-plan.unsynced'));
    renderAt('?tab=graph&focus=stage-plan&select=row:140');

    const text = await drawerText();
    expect(
      lineRow(text, 290)!.querySelector('[data-gutter]')
    ).not.toHaveAttribute('data-tone');
    expect(lineRow(text, 303)!.querySelector('[data-gutter]')).toHaveAttribute(
      'data-tone',
      'accent'
    );
  });

  it('switches the text between the template and the rendered file', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');

    const toggle = within(await drawer()).getByTestId('drawer-view');
    fireEvent.click(within(toggle).getByText('Rendered'));

    await waitFor(() => expect(params().get('view')).toBe('rendered'));
    await waitFor(() =>
      expect(sourceGet).toHaveBeenCalledWith({
        query: {
          pack: 'acme',
          path: '/fixture/packs/acme/skills/work/SKILL.md',
        },
      })
    );
  });

  it('steps through the template rows with the arrow keys', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=row:140');
    await drawer();

    fireEvent.keyDown(document.documentElement, { key: 'ArrowDown' });
    await waitFor(() => expect(params().get('select')).toBe('row:141'));

    fireEvent.keyDown(document.documentElement, { key: 'ArrowUp' });
    fireEvent.keyDown(document.documentElement, { key: 'ArrowUp' });
    await waitFor(() => expect(params().get('select')).toBe('row:137'));
  });

  it('closes on Escape', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=row:140');
    await drawer();

    fireEvent.keyDown(document.documentElement, { key: 'Escape' });

    await waitFor(() => expect(params().get('select')).toBeNull());
    expect(params().get('focus')).toBe('stage-plan');
  });

  it('keeps its keys for the menu while the menu is open', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=row:140');
    const user = userEvent.setup();

    await user.click(within(await drawer()).getByTestId('drawer-menu'));
    await screen.findByRole('menu');

    await user.keyboard('{ArrowDown}');
    expect(params().get('select')).toBe('row:140');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(params().get('select')).toBe('row:140');
    expect(screen.getByTestId('skill-drawer')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(params().get('select')).toBe('row:141'));
  });

  it('shuts its menu whenever it closes, so it reopens with its keys', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=row:140');
    const user = userEvent.setup();

    await user.click(within(await drawer()).getByTestId('drawer-menu'));
    await screen.findByRole('menu');

    act(() => navigate('/wiring?tab=graph&focus=stage-plan'));
    await waitFor(() =>
      expect(screen.queryByTestId('skill-drawer')).toBeNull()
    );
    act(() => navigate('/wiring?tab=graph&focus=stage-plan&select=row:140'));
    await drawer();

    expect(screen.queryByRole('menu')).toBeNull();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(params().get('select')).toBe('row:141'));
  });

  it('leaves Open in editor off an engine file, which is the installed copy', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');

    fireEvent.click(within(await drawer()).getByTestId('drawer-menu'));

    expect(await screen.findByText('Copy path')).toBeInTheDocument();
    expect(
      screen.getAllByRole('menuitem').map(item => item.textContent)
    ).toEqual(['Copy rendered text', 'Copy path']);
  });

  it('opens a file in the pack checkout in the editor', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=input:slot:domain');

    fireEvent.click(within(await drawer()).getByTestId('drawer-menu'));

    const open = await screen.findByText('Open in editor');
    expect(open.closest('a')).toHaveAttribute(
      'href',
      'zed://file/fixture/packs/acme/attachments/plan-policy/SKILL.md'
    );
  });

  it('copies the path', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');

    fireEvent.click(within(await drawer()).getByTestId('drawer-menu'));
    fireEvent.click(await screen.findByText('Copy path'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '/fixture/mattstack/attachments/pipeline/work/SKILL.md'
      )
    );
  });

  it('copies the rendered text as the agent context of a compile preview', async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=pipeline:feature&select=row:1');

    fireEvent.click(within(await drawer()).getByTestId('drawer-menu'));
    fireEvent.click(await screen.findByText('Copy rendered text'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(compileGet).toHaveBeenCalledWith({
      query: { pack: 'acme', verb: 'work' },
    });
    const blob = writeText.mock.calls.at(-1)![0] as string;
    expect(blob).toMatch(/^Verb: work\nEngine: mattstack:work/);
    expect(blob).toContain('Seams:');
  });

  it("ends an input card source line with the file's own line count", async () => {
    mockDesignPack();
    renderAt('?tab=graph&focus=stage-plan&select=input:include:gate-protocol');

    const meta = within(await drawer()).getByTestId('drawer-meta');
    await waitFor(() =>
      expect(meta).toHaveTextContent(
        'mattstack 0.30.4 · installed copy, read only · 452 lines'
      )
    );
  });
});
