import '../../../icons';

import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillsCheck, SkillsComposition } from '../../outline';
import type { SkillsAnatomy } from '../../useWiring';
import { designFixture, designSource } from './designFixtures';

const compositionGet = vi.fn();
const checkGet = vi.fn();
const anatomyGet = vi.fn();
const changesGet = vi.fn();
const sourceGet = vi.fn();

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
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
        anatomy: { $get: (...args: unknown[]) => anatomyGet(...args) },
        changes: { $get: (...args: unknown[]) => changesGet(...args) },
        source: { $get: (...args: unknown[]) => sourceGet(...args) },
        compile: { $get: vi.fn() },
        surface: {
          $get: () =>
            Promise.resolve(
              ok({ pack: 'acme', packDir: '/fixture/packs/acme', rows: [] })
            ),
          apply: { $post: vi.fn() },
        },
        sync: { $post: vi.fn() },
        bind: { $post: vi.fn() },
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

function failed(error: string) {
  return { ok: false, status: 502, json: async () => ({ error }) };
}

type Part = SkillsAnatomy['parts'][number];

const PLAN_RENDERED = '/fixture/packs/acme/attachments/stage-plan/SKILL.md';
const DOMAIN_BODY = [223, 302] as const;
const REFERENCE_LINE =
  'Slot domain is bound to `acme:plan-policy` (acme:plan-policy@0.8.14) -- invoke that skill when this flow needs it.';
const CHANGELOG_ERROR = [
  'loadAttachment: slot "changelog": binding "acme:changelog-style" not found; searched:',
  '/fixture/packs/acme/skills/changelog-style/SKILL.md',
  '/fixture/packs/acme/attachments/changelog-style/SKILL.md',
].join('\n');

/** Plan with its domain slot rendered into `lines` lines in place of the
    body the clean build pastes in. */
function planWithDomain(lines: 0 | 1, patch: Partial<Part>): SkillsAnatomy {
  const plan = designFixture('anatomy.stage-plan');
  const by = lines - (DOMAIN_BODY[1] - DOMAIN_BODY[0] + 1);
  return {
    ...plan,
    rendered: { ...plan.rendered, lines: plan.rendered.lines + by },
    parts: plan.parts.map(part => {
      if (part.name === 'domain') return { ...part, ...patch };
      const at = part.renderedLines;
      return at && at[0] > DOMAIN_BODY[1]
        ? { ...part, renderedLines: [at[0] + by, at[1] + by] }
        : part;
    }),
  };
}

const unboundPlan = () =>
  planWithDomain(0, { source: null, renderedLines: null, mode: null });

function bindDomain(boundTo: string | null): SkillsComposition {
  const composition = designFixture('composition');
  for (const binder of composition.binders)
    if (binder.ref === 'mattstack:stage-plan')
      binder.slots = boundTo
        ? [{ name: 'domain', boundTo, layer: 'pack' }]
        : [];
  return composition;
}

function serve({
  composition = designFixture('composition'),
  check = designFixture('check'),
  anatomy = {},
  files = {},
}: {
  composition?: SkillsComposition;
  check?: SkillsCheck | Error;
  anatomy?: Record<string, SkillsAnatomy>;
  files?: Record<string, (text: string) => string>;
} = {}) {
  const anatomies: Record<string, SkillsAnatomy> = {
    work: designFixture('anatomy.work'),
    'stage-plan': designFixture('anatomy.stage-plan'),
    ...anatomy,
  };
  compositionGet.mockResolvedValue(ok(composition));
  checkGet.mockResolvedValue(
    check instanceof Error ? failed(check.message) : ok(check)
  );
  changesGet.mockResolvedValue(ok(designFixture('changes.clean')));
  anatomyGet.mockImplementation(({ query }: { query: { skill: string } }) =>
    Promise.resolve(
      anatomies[query.skill]
        ? ok(anatomies[query.skill])
        : failed(`no anatomy for ${query.skill}`)
    )
  );
  sourceGet.mockImplementation(({ query }: { query: { path: string } }) => {
    const source = designSource(query.path);
    const edit = files[query.path];
    if (!edit) return Promise.resolve(ok(source));
    const content = edit(source.content);
    return Promise.resolve(
      ok({
        ...source,
        content,
        lines: content.replace(/\n$/, '').split('\n').length,
      })
    );
  });
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

async function rowAt(gutter: string) {
  await screen.findByTestId('template-node');
  const row = screen
    .getAllByTestId('template-row')
    .find(
      candidate =>
        within(candidate).getByTestId('row-gutter').textContent === gutter
    );
  if (!row) throw new Error(`no row ${gutter}`);
  return row;
}

async function cardTitled(title: string) {
  await screen.findByTestId('template-node');
  const card = screen
    .getAllByTestId('input-card')
    .find(
      candidate =>
        within(candidate).getByTestId('card-title').textContent === title
    );
  if (!card) throw new Error(`no card ${title}`);
  return card;
}

const cardTitles = () =>
  screen
    .getAllByTestId('input-card')
    .map(card => within(card).getByTestId('card-title').textContent);

/** The badge a row's or card's tag is drawn in. */
const tagIn = (element: HTMLElement, label: string) =>
  within(element).getByText(label).closest('[data-variant]') as HTMLElement;

const paperOf = (card: HTMLElement) =>
  card.querySelector('[data-attention], .mantine-Paper-root') as HTMLElement;

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: 19,
    viewportHeight: 380,
    contentHeight: 1000 * 19,
  });
});

afterEach(() => {
  restoreLayout();
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('slot states', () => {
  it('optional, unbound: the row says so and no card is drawn', async () => {
    const composition = bindDomain(null);
    for (const target of composition.targets ?? [])
      if (target.name === 'stage-plan')
        for (const slot of target.slots ?? []) slot.required = false;
    serve({ composition, anatomy: { 'stage-plan': unboundPlan() } });
    renderAt('?tab=graph&focus=stage-plan');

    const row = await rowAt('L136');
    expect(row).toHaveTextContent('{{slot:domain}}');
    expect(tagIn(row, 'optional, nothing bound')).toHaveAttribute(
      'data-variant',
      'quiet'
    );
    expect(cardTitles()).toEqual([
      'run fields',
      'execution-strategy/SKILL.md',
      'gate-protocol/SKILL.md',
      'wrap-up-form/SKILL.md',
    ]);
  });

  it('required, unbound: a warn row and a warn card whose Bind opens the rebind panel', async () => {
    serve({
      composition: bindDomain(null),
      anatomy: { 'stage-plan': unboundPlan() },
    });
    renderAt('?tab=graph&focus=stage-plan');

    const tag = tagIn(await rowAt('L136'), 'required, nothing bound');
    expect(tag).toHaveAttribute('data-variant', 'tint');
    expect(tag.getAttribute('style')).toContain('var(--tk-text-warn)');

    const card = await cardTitled('domain slot');
    expect(within(card).getByText('required, nothing bound')).toHaveStyle({
      color: 'var(--tk-text-warn-small)',
    });
    expect(paperOf(card)).toHaveAttribute('data-attention', 'warn');

    // React Flow hides a node until it has measured it, which jsdom never
    // does, so a role query cannot name its buttons.
    const bind = within(card.parentElement!)
      .getByText('Bind')
      .closest('button')!;
    expect(bind).toHaveAttribute('data-variant', 'card-outline');
    fireEvent.click(bind);
    await waitFor(() => {
      expect(params().get('select')).toBe('row:136');
      expect(params().get('rebind')).toBe('1');
    });
    const panel = await screen.findByTestId('rebind-panel');
    expect(within(panel).getByTestId('rebind-current')).toHaveTextContent(
      'nothing bound'
    );
  });

  it('no matching fill: a warn card naming the missing fill, and a warn row', async () => {
    serve({
      composition: bindDomain('acme:plan-policy-v1'),
      anatomy: { 'stage-plan': unboundPlan() },
    });
    renderAt('?tab=graph&focus=stage-plan');

    const tag = tagIn(await rowAt('L136'), 'no matching fill');
    expect(tag).toHaveAttribute('data-variant', 'tint');
    expect(tag.getAttribute('style')).toContain('var(--tk-text-warn)');

    const card = await cardTitled('plan-policy-v1/SKILL.md');
    expect(
      within(card).getByText('no fill named acme:plan-policy-v1 in this pack')
    ).toHaveStyle({ color: 'var(--tk-text-warn-small)' });
    expect(paperOf(card)).toHaveAttribute('data-attention', 'warn');
    expect(within(card.parentElement!).queryByText('Bind')).toBeNull();
  });

  it("resolve error: an error card and row carrying rt's message, read in full in the drawer", async () => {
    const composition = designFixture('composition');
    for (const verb of composition.verbs)
      if (verb.name === 'release-notes')
        verb.slots = verb.slots.map(slot => ({
          ...slot,
          boundTo: 'acme:changelog-style',
          layer: 'pack',
          resolveError: CHANGELOG_ERROR,
        }));
    serve({
      composition,
      anatomy: { 'release-notes': designFixture('anatomy.release-notes') },
    });
    renderAt('?tab=graph&focus=release-notes');

    const tag = tagIn(await rowAt('L22'), 'resolve error');
    expect(tag).toHaveAttribute('data-variant', 'tint');
    expect(tag.getAttribute('style')).toContain('var(--tk-text-bad)');

    const card = await cardTitled('changelog slot');
    const subtitle = within(card).getByText(
      /^loadAttachment: slot "changelog"/
    );
    expect(subtitle).toHaveStyle({ color: 'var(--tk-text-bad-small)' });
    expect(paperOf(card)).toHaveAttribute('data-attention', 'bad');

    fireEvent.click(card);
    const drawer = await screen.findByTestId('skill-drawer');
    expect(within(drawer).getByTestId('drawer-sentence')).toHaveTextContent(
      'The changelog slot. rt could not resolve it.'
    );
    expect(within(drawer).getByTestId('drawer-error').textContent).toBe(
      CHANGELOG_ERROR
    );
  });

  it('referenced: the card says so, the row links to its fill, and the drawer opens on the rendered line', async () => {
    serve({
      anatomy: {
        'stage-plan': planWithDomain(1, {
          mode: 'reference',
          renderedLines: [223, 223],
        }),
      },
      files: {
        [PLAN_RENDERED]: text => {
          const lines = text.split('\n');
          lines.splice(222, 80, REFERENCE_LINE);
          return lines.join('\n');
        },
      },
    });
    renderAt('?tab=graph&focus=stage-plan');

    const card = await cardTitled('plan-policy/SKILL.md');
    expect(card).toHaveTextContent('referenced: the rendered text links to it');
    const row = await rowAt('L136');
    expect(tagIn(row, 'links to plan-policy')).toHaveAttribute(
      'data-variant',
      'quiet'
    );

    fireEvent.click(row);
    const drawer = await screen.findByTestId('skill-drawer');
    expect(within(drawer).getByTestId('drawer-chip')).toHaveTextContent(
      'L136 → L223'
    );
    expect(within(drawer).getByTestId('drawer-sentence')).toHaveTextContent(
      'The domain slot. This pack links it to plan-policy rather than pasting it in.'
    );
    const text = await screen.findByTestId('drawer-text');
    await waitFor(() =>
      expect(text.querySelector('[data-line="223"]')).not.toBeNull()
    );
    const line = text.querySelector('[data-line="223"]')!;
    expect(line).toHaveAttribute('data-highlighted');
    expect(line).toHaveTextContent(REFERENCE_LINE);
  });
});

describe('engines and builds', () => {
  it('a legacy engine: rows guttered by rendered lines open on the rendered file', async () => {
    const plan = designFixture('anatomy.stage-plan');
    const source = (name: string) =>
      plan.parts.find(part => part.name === name)!.source;
    const part = (
      kind: Part['kind'],
      name: string | null,
      renderedLines: [number, number]
    ): Part => ({
      kind,
      name,
      templateLines: null,
      renderedLines,
      mode: null,
      source: name ? source(name) : null,
      target: null,
      changed: false,
    });
    serve({
      anatomy: {
        'stage-plan': {
          ...plan,
          parts: [
            part('text', null, [12, 48]),
            part('include', 'execution-strategy', [49, 197]),
            part('include', 'gate-protocol', [303, 749]),
            part('include', 'wrap-up-form', [753, 780]),
          ],
        },
      },
    });
    renderAt('?tab=graph&focus=stage-plan');

    await screen.findByTestId('template-node');
    expect(
      screen.getAllByTestId('row-gutter').map(gutter => gutter.textContent)
    ).toEqual([
      'rendered L12-48',
      'rendered L49-197',
      'rendered L303-749',
      'rendered L753-780',
    ]);

    fireEvent.click(await rowAt('rendered L303-749'));
    const drawer = await screen.findByTestId('skill-drawer');
    expect(within(drawer).getByText('rendered')).toBeInTheDocument();
    expect(within(drawer).getByTestId('drawer-chip')).toHaveTextContent(
      'rendered L303-749'
    );
  });

  it('never compiled: the output card says so, and its drawer cannot switch to Rendered', async () => {
    const plan = designFixture('anatomy.stage-plan');
    const check = designFixture('check');
    for (const row of check.verbs)
      if (row.name === 'stage-plan') row.status = 'never-compiled';
    serve({
      check,
      anatomy: {
        'stage-plan': {
          ...plan,
          status: 'never-compiled',
          template: { ...plan.template, builtVersion: null },
          rendered: { ...plan.rendered, exists: false, lines: 0 },
          parts: plan.parts.map(part => ({ ...part, renderedLines: null })),
          links: [],
        },
      },
    });
    renderAt('?tab=graph&focus=stage-plan&select=output');

    const output = await screen.findByTestId('output-node');
    expect(within(output).getByTestId('output-lines')).toHaveTextContent(
      'never compiled'
    );
    expect(output).not.toHaveTextContent('0 lines');
    expect(await screen.findByTestId('focus-status')).toHaveTextContent(
      'never compiled'
    );

    const drawer = await screen.findByTestId('skill-drawer');
    const toggle = within(drawer).getByTestId('drawer-view');
    expect(
      within(toggle).getByRole('radio', { name: 'Template' })
    ).toBeChecked();
    expect(
      within(toggle).getByRole('radio', { name: 'Rendered' })
    ).toBeDisabled();
  });
});

describe('canvas errors', () => {
  it('a skill that fails to load gets a centred error with Retry', async () => {
    serve();
    anatomyGet.mockResolvedValueOnce(
      failed('rt skills anatomy: the template for stage-plan could not be read')
    );
    renderAt('?tab=graph&focus=stage-plan');

    const error = await screen.findByTestId('canvas-error');
    expect(error).toHaveTextContent(
      'rt skills anatomy: the template for stage-plan could not be read'
    );
    expect(error.getAttribute('style')).toContain('bad');
    expect(screen.queryByTestId('template-node')).toBeNull();

    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('template-node')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-error')).toBeNull();
  });

  it('a check that fails keeps the canvas and says the status is unavailable in the header', async () => {
    serve({
      check: new Error(
        'rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
      ),
    });
    renderAt('?tab=graph&focus=stage-plan');

    const header = await screen.findByTestId('focus-header');
    const alert = await within(header).findByTestId('status-unavailable');
    expect(alert).toHaveTextContent(
      'Status unavailable: rt skills check: pack/skills.jsonc is not valid JSONC (line 14: unexpected "}")'
    );
    expect(alert.getAttribute('style')).toContain('warn');
    expect(within(header).queryByTestId('focus-status')).toBeNull();
    expect(await screen.findByTestId('template-node')).toBeInTheDocument();
  });

  it('a failed changes poll shows nothing', async () => {
    serve();
    changesGet.mockResolvedValue(
      failed('rt skills changes: /fixture/packs/acme is not a git checkout')
    );
    renderAt('?tab=graph&focus=stage-plan');

    await screen.findByTestId('template-node');
    await waitFor(() => expect(changesGet).toHaveBeenCalled());
    expect(screen.queryByText(/unsynced change/)).toBeNull();
    expect(screen.queryByText(/not a git checkout/)).toBeNull();
  });
});
