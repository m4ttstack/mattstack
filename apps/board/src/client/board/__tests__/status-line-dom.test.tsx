import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  jest,
  test,
} from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let StatusLine: typeof import('../StatusLine.tsx').StatusLine;
let MERGE_ARM_MS: number;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;
type RowStatus = import('../row-status.ts').RowStatus;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ StatusLine, MERGE_ARM_MS } = await import('../StatusLine.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const MR = {
  iid: 1418,
  title: 'ACME-2214 Port the v2 quiet-mode flows',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
  gates: [],
} as unknown as BoardMRWithReview;

function ctx(over: Partial<RowContext> = {}): RowContext {
  const noop = () => {};
  return {
    local: true,
    self: 'me',
    slackTemplates: { single: '', multiHeader: '', multiItem: '' },
    slackEnabled: false,
    onContext: noop,
    onOpenReview: noop,
    onOpenRespond: noop,
    onOpenDraft: noop,
    draftResolved: new Map(),
    onResumeRespond: noop,
    onResumeReview: noop,
    onRedo: noop,
    onFocusPane: noop,
    onOpenGate: noop,
    selected: new Set(),
    onToggleSelect: noop,
    onClearOrphan: noop,
    onDismissLane: noop,
    onLaunch: noop,
    onReReview: noop,
    onRespond: noop,
    onDoctor: noop,
    ...over,
  } as RowContext;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(status: RowStatus, c: RowContext) {
  await React.act(async () => {
    root.render(<StatusLine mr={MR} status={status} ctx={c} />);
  });
}

test('a hot line renders its word, detail, and the primary verb at the end; the secondary verb sits to its left, marked hover-only; agent verbs carry their lane and the bot mark', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'review interrupted',
        detail: 'pane closed 12m ago',
        verbs: [
          { kind: 'resume', label: 'resume', domain: 'review' },
          { kind: 'redo', label: 'redo', domain: 'review' },
          { kind: 'clear', label: 'clear', agentId: 'ag-1' },
        ],
      },
      more: [],
      bar: 'warn',
    },
    ctx({
      onResumeReview: () => calls.push('resume:review'),
      onRedo: (_mr, lane) => calls.push(`redo:${lane}`),
      onClearOrphan: id => calls.push(`clear:${id}`),
    })
  );
  const line = container.querySelector('.tui-status')!;
  expect(line.getAttribute('data-tone')).toBe('warn');
  expect(line.querySelector('.tui-status-word')!.textContent).toBe(
    'review interrupted'
  );
  expect(line.querySelector('.tui-status-detail')!.textContent).toBe(
    'pane closed 12m ago'
  );
  const verbs = [
    ...line.querySelectorAll<HTMLButtonElement>('button[data-verb]'),
  ];
  expect(verbs.map(v => v.dataset.verb)).toEqual(['redo', 'clear', 'resume']);
  const [redo, clear, resume] = verbs as [
    HTMLButtonElement,
    HTMLButtonElement,
    HTMLButtonElement,
  ];
  expect(clear.dataset.secondary).toBe('true');
  expect(clear.dataset.lane).toBeUndefined();
  expect(clear.querySelector('svg')).toBeNull();
  expect(redo.dataset.secondary).toBe('true');
  expect(redo.dataset.lane).toBe('review');
  expect(resume.dataset.secondary).toBeUndefined();
  expect(resume.dataset.lane).toBe('review');
  expect(resume.querySelector('svg')).not.toBeNull();
  await React.act(async () => resume.click());
  await React.act(async () => redo.click());
  await React.act(async () => clear.click());
  expect(calls).toEqual(['resume:review', 'redo:review', 'clear:ag-1']);
});

test('every agent verb wears its lane; answer is a decide verb; navigation carries neither', async () => {
  const lanes: Array<
    [import('../row-status.ts').VerbKind, string | undefined]
  > = [
    ['launch-review', 'review'],
    ['re-review', 'review'],
    ['launch-respond', 'respond'],
    ['restart-respond', 'respond'],
    ['resume-respond', 'respond'],
    ['call-doctor', 'doctor'],
    ['open-mr', undefined],
    ['read-review', undefined],
  ];
  for (const [kind, lane] of lanes) {
    await render(
      {
        line: { tone: 'quiet', word: 'x', verbs: [{ kind, label: kind }] },
        more: [],
        bar: null,
      },
      ctx()
    );
    const b = container.querySelector<HTMLButtonElement>('button[data-verb]')!;
    expect([kind, b.dataset.lane]).toEqual([kind, lane]);
    expect([kind, b.querySelector('svg') !== null]).toEqual([
      kind,
      lane !== undefined,
    ]);
    expect(b.dataset.decide).toBeUndefined();
  }
  await render(
    {
      line: {
        tone: 'warn',
        word: 'x',
        verbs: [{ kind: 'answer', label: 'answer', gateId: 'g' }],
      },
      more: [],
      bar: 'warn',
    },
    ctx()
  );
  const answer =
    container.querySelector<HTMLButtonElement>('button[data-verb]')!;
  expect(answer.dataset.decide).toBe('true');
  expect(answer.dataset.lane).toBeUndefined();
});

test('a focus verb carries its lane to onFocusPane', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'work',
        word: 'fixing…',
        spin: true,
        verbs: [{ kind: 'focus', label: 'focus', domain: 'doctor' }],
      },
      more: [],
      bar: null,
    },
    ctx({ onFocusPane: (m, domain) => calls.push(`${m.iid}:${domain}`) })
  );
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[data-verb="focus"]')!
      .click()
  );
  expect(calls).toEqual(['1418:doctor']);
});

test('a working line renders the spinner ring, not a dot', async () => {
  await render(
    {
      line: { tone: 'work', word: 'review running…', spin: true, verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  expect(container.querySelector('.tui-status-ring')).not.toBeNull();
});

test('an answer verb opens the queue on its gate', async () => {
  const opened: string[] = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'post which findings?',
        verbs: [{ kind: 'answer', label: 'answer', gateId: 'g1' }],
      },
      more: [],
      bar: 'warn',
    },
    ctx({ onOpenGate: id => opened.push(id) })
  );
  await React.act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[data-verb="answer"]')!
      .click()
  );
  expect(opened).toEqual(['g1']);
});

test('the all-clear line puts the word first, then the sun, then the open verb', async () => {
  await render(
    {
      line: {
        tone: 'clear',
        word: 'all clear',
        verbs: [{ kind: 'open-mr', label: 'open ↗' }],
      },
      more: [],
      bar: null,
    },
    ctx()
  );
  const line = container.querySelector('.tui-status[data-tone="clear"]')!;
  const word = line.querySelector('.tui-status-word')!;
  expect(word.textContent).toBe('all clear');
  expect(word.querySelector('svg')).toBeNull();
  expect(word.nextElementSibling!.className).toBe('tui-status-sun');
  expect(word.nextElementSibling!.querySelector('svg')).not.toBeNull();
  expect(line.querySelector('.tui-status-detail')).toBeNull();
  expect(
    container.querySelector('button[data-verb="open-mr"]')!.textContent
  ).toBe('open ↗');
});

test('suppressed candidates sit behind +N more, which opens them with their details', async () => {
  await render(
    {
      line: { tone: 'warn', word: 'post which findings?', verbs: [] },
      more: [
        {
          tone: 'quiet',
          word: 'responded',
          detail: '3 threads: 2 fixed and resolved, 1 overview skipped',
          verbs: [],
        },
        { tone: 'work', word: 'watching CI…', verbs: [] },
      ],
      bar: 'warn',
    },
    ctx()
  );
  const more = container.querySelector<HTMLButtonElement>('.tui-status-more')!;
  expect(more.textContent).toBe('+2 more');
  await React.act(async () => more.click());
  const lines = [...document.querySelectorAll('.tui-status-more-line')];
  expect(lines.map(l => l.getAttribute('data-tone'))).toEqual([
    'quiet',
    'work',
  ]);
  expect(lines[0]?.textContent).toBe(
    'responded3 threads: 2 fixed and resolved, 1 overview skipped'
  );
  expect(lines[1]?.textContent).toBe('watching CI…');
});

test('the +N more list on a GitHub row names the PR #<n>', async () => {
  const gh = {
    ...MR,
    webUrl: 'https://github.com/acme/webapp/pull/1418',
    provider: 'github',
  } as unknown as BoardMRWithReview;
  await React.act(async () => {
    root.render(
      <StatusLine
        mr={gh}
        status={{
          line: { tone: 'warn', word: 'post which findings?', verbs: [] },
          more: [{ tone: 'work', word: 'watching CI…', verbs: [] }],
          bar: 'warn',
        }}
        ctx={ctx()}
      />
    );
  });
  const more = container.querySelector<HTMLButtonElement>('.tui-status-more')!;
  await React.act(async () => more.click());
  expect(
    document.querySelector('[aria-label="other statuses for #1418"]')
  ).not.toBeNull();
  expect(
    document.querySelector('[aria-label="other statuses for !1418"]')
  ).toBeNull();
});

test('a long detail renders its first clause and keeps the whole message as the tooltip', async () => {
  const full =
    'rebased acme-2214 onto origin/main (pat); resolved Overview.test.tsx conflict (kept both sides)';
  await render(
    {
      line: { tone: 'go', word: 'diagnosed', detail: full, verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  const detail = container.querySelector('.tui-status-detail')!;
  expect(detail.textContent).toBe('rebased acme-2214 onto origin/main');
  expect(detail.getAttribute('title')).toBe(full);
  await render(
    {
      line: { tone: 'go', word: 'diagnosed', detail: 'short', verbs: [] },
      more: [],
      bar: null,
    },
    ctx()
  );
  expect(
    container.querySelector('.tui-status-detail')!.getAttribute('title')
  ).toBeNull();
});

const MERGE_LINE: RowStatus = {
  line: {
    tone: 'go',
    word: 'review ready',
    verbs: [
      { kind: 'merge', label: 'merge' },
      { kind: 'read-review', label: 'read ↗' },
    ],
  },
  more: [],
  bar: null,
};

test('merge takes two clicks: the first arms it as "really merge?", the second merges', async () => {
  const merged: number[] = [];
  await render(MERGE_LINE, ctx({ onMerge: m => merged.push(m.iid) }));
  const merge = () =>
    container.querySelector<HTMLButtonElement>('button[data-verb="merge"]')!;
  expect(merge().textContent).toBe('merge');
  expect(merge().dataset.armed).toBeUndefined();
  expect(merge().dataset.lane).toBeUndefined();
  await React.act(async () => merge().click());
  expect(merged).toEqual([]);
  expect(merge().textContent).toBe('really merge?');
  expect(merge().dataset.armed).toBe('true');
  await React.act(async () => merge().click());
  expect(merged).toEqual([1418]);
  expect(merge().textContent).toBe('merge');
});

test('an armed merge outlives the pointer leaving and disarms on a timer', async () => {
  jest.useFakeTimers();
  try {
    const merged: number[] = [];
    await render(MERGE_LINE, ctx({ onMerge: m => merged.push(m.iid) }));
    const merge = () =>
      container.querySelector<HTMLButtonElement>('button[data-verb="merge"]')!;
    await React.act(async () => merge().click());
    await React.act(async () => {
      container
        .querySelector('.tui-status')!
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(merge().textContent).toBe('really merge?');
    await React.act(async () => jest.advanceTimersByTime(MERGE_ARM_MS));
    expect(merge().textContent).toBe('merge');
    await React.act(async () => merge().click());
    expect(merged).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});

test('a board that is not local hides merge, as the row menu does; the next verb leads', async () => {
  await render(MERGE_LINE, ctx({ local: false }));
  const verbs = [
    ...container.querySelectorAll<HTMLButtonElement>('button[data-verb]'),
  ];
  expect(verbs.map(v => v.dataset.verb)).toEqual(['read-review']);
  expect(verbs[0]!.dataset.secondary).toBeUndefined();
});

test('the dismiss secondary sits left of the primary and carries the lane it drops', async () => {
  const calls: string[] = [];
  await render(
    {
      line: {
        tone: 'bad',
        word: 'doctor stuck',
        detail: 'registry push flake',
        verbs: [
          { kind: 'call-doctor', label: 'call again' },
          { kind: 'dismiss', label: 'dismiss', domain: 'doctor' },
        ],
      },
      more: [],
      bar: 'bad',
    },
    ctx({ onDismissLane: (_mr, lane) => calls.push(`dismiss:${lane}`) })
  );
  const line = container.querySelector('.tui-status')!;
  const verbs = [
    ...line.querySelectorAll<HTMLButtonElement>('button[data-verb]'),
  ];
  expect(verbs.map(v => v.dataset.verb)).toEqual(['dismiss', 'call-doctor']);
  const [dismiss] = verbs as [HTMLButtonElement];
  expect(dismiss.dataset.secondary).toBe('true');
  expect(dismiss.dataset.lane).toBeUndefined();
  await React.act(async () => {
    dismiss.click();
  });
  expect(calls).toEqual(['dismiss:doctor']);
});

test('a line from a launch with no pack shows the quiet no-pack badge with its tip; a line with a pack does not', async () => {
  const status = (noPack?: boolean): RowStatus => ({
    line: {
      tone: 'work',
      word: 'review running…',
      spin: true,
      ...(noPack ? { noPack } : {}),
      verbs: [],
    },
    more: [],
    bar: null,
  });
  await render(status(true), ctx());
  const badge = container.querySelector('[data-part="badge"]')!;
  expect(badge.textContent).toBe('no pack');
  expect(badge.getAttribute('data-intent')).toBe('muted');
  expect(badge.getAttribute('aria-label')).toBe(
    'No pack selected. Launched the generic skill. Set a pack on the tab, or join a team that has one.'
  );
  await render(status(), ctx());
  expect(container.querySelector('[data-part="badge"]')).toBeNull();
});

test('a cloud-spin line leads with the cloud spinner and no ring', async () => {
  await render(
    {
      line: {
        tone: 'quiet',
        word: 'mira is reviewing',
        spin: 'cloud',
        verbs: [{ kind: 'view-peer', label: 'view ↗' }],
      },
      more: [],
      bar: null,
    },
    ctx()
  );
  const status = container.querySelector('.tui-status')!;
  expect(status.querySelector('.tui-status-ring')).toBeNull();
  const spinner = status.querySelector('.tui-cloud-spin');
  expect(spinner).not.toBeNull();
  expect(status.firstElementChild).toBe(spinner);
  expect(spinner!.querySelector('.tui-cloud-fill')).not.toBeNull();
  expect(spinner!.querySelector('.tui-cloud-dash')).not.toBeNull();
});

test('a respond verb hands its person to onRespond', async () => {
  const calls: Array<string | undefined> = [];
  await render(
    {
      line: {
        tone: 'warn',
        word: 'replies posted',
        verbs: [
          {
            kind: 'restart-respond',
            label: 'respond to Darryl (round 2)',
            person: 'darryl',
          },
        ],
      },
      more: [],
      bar: 'warn',
    },
    ctx({ onRespond: (_mr, _note, _intent, person) => calls.push(person) })
  );
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('button[data-verb]')!.click();
  });
  expect(calls).toEqual(['darryl']);
});

test('a launch-respond verb for one person hands that person to onRespond', async () => {
  const calls: Array<string | undefined> = [];
  await render(
    {
      line: {
        tone: 'quiet',
        word: 'changes requested',
        verbs: [
          { kind: 'launch-respond', label: 'respond to John', person: 'john' },
        ],
      },
      more: [],
      bar: null,
    },
    ctx({ onRespond: (_mr, _note, _intent, person) => calls.push(person) })
  );
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('button[data-verb]')!.click();
  });
  expect(calls).toEqual(['john']);
});

test('a sync opens its drawer for whoever started it, the word and pips follow the steps, and clicks inside never reach the row', async () => {
  const { startSyncLines, pushSyncLine } = await import('../sync-lines.ts');
  const mr = {
    ...MR,
    sourceBranch: 'feat',
    doctor: { status: 'syncing' },
  } as unknown as BoardMRWithReview;
  const rowClicks: string[] = [];
  const onRow = () => rowClicks.push('row');
  startSyncLines(mr.webUrl!);
  await React.act(async () => {
    root.render(
      <div onClick={onRow}>
        <StatusLine
          mr={mr}
          status={{
            line: {
              tone: 'work',
              word: 'syncing…',
              spin: true,
              syncLog: [],
              verbs: [],
            },
            more: [],
            bar: null,
          }}
          ctx={ctx()}
        />
      </div>
    );
  });
  await React.act(async () => {
    pushSyncLine(mr.webUrl!, '[ok] Fetched from origin');
    pushSyncLine(
      mr.webUrl!,
      '[running] Rebasing feat onto origin/main  3 commits behind'
    );
  });
  const word = container.querySelector('.tui-status-word-log')!;
  expect(word.textContent).toBe('rebasing');
  expect(
    [...word.querySelectorAll('.tui-sync-pip')].map(p =>
      p.getAttribute('data-state')
    )
  ).toEqual(['done', 'pending', 'running', 'pending']);
  expect(container.querySelector('.tui-status-detail')?.textContent).toBe(
    '3 commits onto main'
  );

  const drawer = document.querySelector('[data-part="sidedrawer"]')!;
  expect(drawer).not.toBeNull();
  const steps = [...drawer.querySelectorAll('.tui-syncsteps-step')];
  expect(steps.map(s => s.getAttribute('data-state'))).toEqual([
    'done',
    'pending',
    'running',
    'pending',
  ]);
  expect(steps[2]?.querySelector('.tui-syncsteps-detail')?.textContent).toBe(
    '3 commits'
  );
  const raw = [...drawer.querySelectorAll('.tui-synclog-line')];
  expect(
    raw.map(l => l.querySelector('.tui-synclog-glyph')?.textContent)
  ).toEqual(['✓', '●']);

  rowClicks.length = 0;
  await React.act(async () => {
    (steps[0] as HTMLElement).click();
  });
  // The drawer sits in a portal on body, so only React's bubbling could
  // carry a click from it to the row.
  expect(rowClicks).toEqual([]);
});

async function renderForgeRow(
  doctor: Record<string, unknown>,
  webUrl = MR.webUrl
) {
  const mr = {
    ...MR,
    webUrl,
    sourceBranch: 'feat',
    doctor,
  } as unknown as BoardMRWithReview;
  await React.act(async () => {
    root.render(
      <StatusLine
        mr={mr}
        status={{
          line: {
            tone: 'work',
            word: 'rebasing…',
            spin: true,
            syncLog: [],
            verbs: [],
          },
          more: [],
          bar: null,
        }}
        ctx={ctx()}
      />
    );
  });
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-status-word-log')!.click();
  });
  return document.querySelector('[data-part="sidedrawer"]')!;
}

test('cancel shows while the forge step runs and calls cancelRebase', async () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body) });
    return new Response(JSON.stringify({ ok: true, cancelled: true }));
  }) as unknown as typeof fetch;
  try {
    const drawer = await renderForgeRow({
      status: 'forge-rebasing',
      forge: { forge: 'gitlab', state: 'running' },
    });
    expect(container.querySelector('.tui-status-word-log')?.textContent).toBe(
      'rebasing'
    );
    const cancel = drawer.querySelector<HTMLButtonElement>(
      '.tui-syncsteps-cancel'
    )!;
    expect(cancel.textContent).toBe('cancel');
    await React.act(async () => cancel.click());
    expect(calls).toEqual([
      { url: '/rebase/cancel', body: JSON.stringify({ mrUrl: MR.webUrl }) },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('no cancel once the forge step has settled', async () => {
  const drawer = await renderForgeRow({
    status: 'synced',
    message: 'rebased',
    forge: { forge: 'gitlab', state: 'done', detail: 'rebased' },
  });
  expect(drawer.querySelector('.tui-syncsteps-title')?.textContent).toBe(
    'Rebased on GitLab'
  );
  expect(drawer.querySelector('.tui-syncsteps-cancel')).toBeNull();
});

test('a cancelled rebase says so once and shows no raw output', async () => {
  const drawer = await renderForgeRow({
    status: 'sync-stopped',
    message: 'cancelled; the forge may still be rebasing',
    forge: { forge: 'gitlab', state: 'failed', detail: 'cancelled' },
  });
  expect(drawer.querySelector('.tui-syncsteps-title')?.textContent).toBe(
    'Rebase cancelled'
  );
  expect(drawer.querySelector('.tui-syncsteps-note')).toBeNull();
  expect(drawer.querySelector('.tui-syncsteps-raw')).toBeNull();
  expect(drawer.querySelector('.tui-syncsteps-rawlog')).toBeNull();
});

test('raw output is hidden while the forge step runs with no sync lines', async () => {
  // A running row streams the page's live lines, which are keyed by URL.
  const drawer = await renderForgeRow(
    {
      status: 'forge-rebasing',
      forge: { forge: 'gitlab', state: 'running' },
    },
    'https://gitlab.example.com/acme/webapp/-/merge_requests/1430'
  );
  expect(drawer.querySelector('.tui-syncsteps-raw')).toBeNull();
  expect(drawer.querySelector('.tui-syncsteps-rawlog')).toBeNull();
  expect(drawer.textContent).not.toContain('Starting rt sync');
});

test('raw output is hidden when the forge alone settled it', async () => {
  const drawer = await renderForgeRow({
    status: 'synced',
    forge: { forge: 'gitlab', state: 'done', detail: 'rebased' },
  });
  expect(drawer.querySelector('.tui-syncsteps-raw')).toBeNull();
  expect(drawer.textContent).not.toContain('No output was saved');
});

test('GitHub note shows on a GitHub forge step', async () => {
  const drawer = await renderForgeRow({
    status: 'forge-rebasing',
    forge: { forge: 'github', state: 'running' },
  });
  expect(drawer.querySelector('.tui-syncsteps-note')?.textContent).toBe(
    'Re-runs checks; can drop the PR from a merge queue'
  );
  const gitlab = await renderForgeRow(
    { status: 'forge-rebasing', forge: { forge: 'gitlab', state: 'running' } },
    'https://gitlab.example.com/acme/webapp/-/merge_requests/1419'
  );
  expect(gitlab.querySelector('.tui-syncsteps-note')).toBeNull();
});

test('no-doctor stop names the tree', async () => {
  const url = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1420';
  const saved = [
    '[ok] Syncing in worktree george',
    '[needs you] 3 files have conflicts rt cannot resolve  the rebase is paused',
  ];
  const message = 'paused in george; no doctor on this tab';
  const mr = {
    ...MR,
    webUrl: url,
    sourceBranch: 'feat',
    doctor: { status: 'sync-stopped', message, pausedTree: 'george' },
  } as unknown as BoardMRWithReview;
  await React.act(async () => {
    root.render(
      <StatusLine
        mr={mr}
        status={{
          line: {
            tone: 'bad',
            word: 'sync stopped',
            detail: message,
            syncLog: saved,
            verbs: [],
          },
          more: [],
          bar: null,
        }}
        ctx={ctx()}
      />
    );
  });
  expect(container.querySelector('.tui-status-detail')?.textContent).toBe(
    message
  );
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-status-word-log')!.click();
  });
  const drawer = document.querySelector('[data-part="sidedrawer"]')!;
  expect(drawer.querySelector('.tui-syncsteps-tree')?.textContent).toBe(
    'george'
  );
  expect(drawer.querySelector('.tui-syncsteps-title')?.textContent).toBe(
    'Rebase paused on conflicts'
  );
});
