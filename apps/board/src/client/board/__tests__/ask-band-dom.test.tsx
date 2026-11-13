import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let AskBand: typeof import('../AskBand.tsx').AskBand;
let remindToastName: typeof import('../ask-band.ts').remindToastName;
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;
type SentNudgeInfo = import('../../types.ts').SentNudgeInfo;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ AskBand } = await import('../AskBand.tsx'));
  ({ remindToastName } = await import('../ask-band.ts'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const NOW = 10_000_000_000;

const mrWith = (sent?: Partial<SentNudgeInfo>): BoardMRWithReview =>
  ({
    iid: 1418,
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    author: { username: 'me', name: 'Me' },
    gates: [],
    ...(sent
      ? {
          sentNudge: {
            display: 'requested',
            reviewer: 'grace',
            reviewerName: 'Grace Hopper',
            sentAt: NOW - 60_000,
            ...sent,
          },
        }
      : {}),
  }) as unknown as BoardMRWithReview;

function ctx(over: Partial<RowContext> = {}): RowContext {
  return { local: true, self: 'me', ...over } as RowContext;
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

async function render(mr: BoardMRWithReview, c: RowContext) {
  await React.act(async () => {
    root.render(<AskBand mr={mr} ctx={c} />);
  });
}

const buttons = () =>
  [...container.querySelectorAll('.tui-ask-btn')].map(b => b.textContent);

test('no sent ask renders nothing', async () => {
  await render(mrWith(), ctx());
  expect(container.querySelector('.tui-ask')).toBeNull();
});

test('names the teammate agent and the state', async () => {
  await render(mrWith({ kind: 're-review' }), ctx());
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-ask-tone')).toBe('neutral');
  expect(band.textContent).toContain("Grace's agent");
  expect(band.textContent).toContain('re-review requested');
  expect(buttons()).toEqual([]);
});

test('hovering the band opens nothing; clicking its trigger opens the trail, clicking again closes it', async () => {
  await render(mrWith({ kind: 're-review' }), ctx());
  const band = container.querySelector('.tui-ask')!;
  const trigger =
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!;
  await React.act(async () => {
    band.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  expect(document.querySelector('.tui-ask-trail')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await React.act(async () => trigger.click());
  const card = document.querySelector('.tui-ask-trail')!;
  expect(card.textContent).toContain('Follow-up review from Grace');
  expect(card.textContent).toContain('Requested');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await React.act(async () => trigger.click());
  expect(document.querySelector('.tui-ask-trail')).toBeNull();
});

test('the trail is a popover anchored to its trigger, not a menu, and clicks inside it stay off the row', async () => {
  const rowClicks: string[] = [];
  container.addEventListener('click', () => rowClicks.push('row'));
  await render(mrWith({ kind: 're-review' }), ctx());
  const trigger =
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!;
  await React.act(async () => trigger.click());
  const trail = document.querySelector<HTMLElement>('.tui-ask-trail')!;
  expect(trail.getAttribute('role')).toBe('dialog');
  expect(trail.getAttribute('aria-label')).toBe('Follow-up review from Grace');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  rowClicks.length = 0;
  await React.act(async () => {
    trail.querySelector<HTMLElement>('.tui-ask-trail-step')!.click();
  });
  expect(rowClicks).toEqual([]);
});

test('the open trail closes on an outside click (Escape is the kit popover own)', async () => {
  await render(mrWith({}), ctx());
  const trigger =
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!;
  await React.act(async () => trigger.click());
  expect(document.querySelector('.tui-ask-trail')).not.toBeNull();
  await React.act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
      document.body.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0 })
      );
    document.body.click();
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('a running ask swaps the cloud glyph for the cloud spinner and offers dismiss', async () => {
  await render(mrWith({ display: 'launched', resolvedAt: NOW }), ctx());
  const where = container.querySelector('.tui-ask-where')!;
  expect(where.querySelectorAll('svg')).toHaveLength(1);
  expect(where.querySelector('.tui-cloud-spin')).not.toBeNull();
  expect(container.querySelector('.tui-ask-state svg')).toBeNull();
  expect(buttons()).toEqual(['Dismiss']);
});

test('done offers dismiss only, and it calls the dismiss handler', async () => {
  const calls: string[] = [];
  const mr = mrWith({
    display: 'done',
    outcome: 'comment',
    finishedAt: NOW - 60_000,
  });
  await render(mr, ctx({ onAskDismiss: m => calls.push(`dismiss ${m.iid}`) }));
  expect(buttons()).toEqual(['Dismiss']);
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-ask-btn')!.click();
  });
  expect(calls).toEqual(['dismiss 1418']);
});

test('failed and no answer offer retry then dismiss; retry calls the retry handler', async () => {
  for (const display of ['failed', 'no-response'] as const) {
    const calls: string[] = [];
    await render(
      mrWith({ display, finishedAt: NOW }),
      ctx({
        onAskRetry: m => calls.push(`retry ${m.iid}`),
        onAskDismiss: m => calls.push(`dismiss ${m.iid}`),
      })
    );
    expect(buttons()).toEqual(['Retry', 'Dismiss']);
    const [retry, dismiss] = [
      ...container.querySelectorAll<HTMLButtonElement>('.tui-ask-btn'),
    ];
    await React.act(async () => retry!.click());
    await React.act(async () => dismiss!.click());
    expect(calls).toEqual(['retry 1418', 'dismiss 1418']);
  }
});

test('a stopped ask renders its reason and offers retry and dismiss', async () => {
  const calls: string[] = [];
  await render(
    mrWith({ display: 'failed', reason: 'pane closed', finishedAt: NOW }),
    ctx({
      onAskRetry: m => calls.push(`retry ${m.iid}`),
      onAskDismiss: m => calls.push(`dismiss ${m.iid}`),
    })
  );
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'stopped: pane closed'
  );
  expect(
    container.querySelector('.tui-ask')?.getAttribute('data-ask-tone')
  ).toBe('bad');
  expect(container.querySelector('[data-part="spinner"]')).toBeNull();
  expect(buttons()).toEqual(['Retry', 'Dismiss']);
  const [retry, dismiss] = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-ask-btn'),
  ];
  await React.act(async () => retry!.click());
  await React.act(async () => dismiss!.click());
  expect(calls).toEqual(['retry 1418', 'dismiss 1418']);
  await render(mrWith({ display: 'failed' }), ctx());
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'failed to run'
  );
});

test('a review a peer board lost renders as a band with retry and dismiss, and its trail names their board', async () => {
  const calls: string[] = [];
  const mr = {
    ...mrWith(),
    peerReviews: [
      {
        mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
        iid: 1418,
        reviewer: 'grace',
        status: 'error',
        reason: 'pane closed',
        updatedAt: NOW - 60_000,
      },
    ],
  } as unknown as BoardMRWithReview;
  await render(
    mr,
    ctx({
      onAskRetry: m => calls.push(`retry ${m.iid}`),
      onAskDismiss: m => calls.push(`dismiss ${m.iid}`),
    })
  );
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-ask-tone')).toBe('bad');
  expect(band.getAttribute('data-ask')).toBe('peer-failed');
  expect(band.textContent).toContain("grace's agent");
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'stopped: pane closed'
  );
  expect(buttons()).toEqual(['Retry', 'Dismiss']);
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!.click();
  });
  const trail = document.querySelector('.tui-ask-trail')!;
  expect(trail.textContent).toContain('Review from grace');
  expect(trail.textContent).toContain("grace's board");
  expect(trail.textContent).not.toContain('Requested');
  expect(trail.textContent).toContain(
    "Retry asks grace's agent to review again."
  );
  const [retry, dismiss] = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-ask-btn'),
  ];
  await React.act(async () => retry!.click());
  await React.act(async () => dismiss!.click());
  expect(calls).toEqual(['retry 1418', 'dismiss 1418']);
});

test('a parked ask offers remind then dismiss, and remind calls the remind handler', async () => {
  const calls: string[] = [];
  await render(
    {
      ...mrWith({ display: 'parked', resolvedAt: NOW - 60_000 }),
      peerReviews: [
        {
          mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
          iid: 1418,
          reviewer: 'grace',
          status: 'parked',
          updatedAt: Date.now() - 60_000,
          receivedAt: Date.now() - 60_000,
        },
      ],
    } as unknown as BoardMRWithReview,
    ctx({
      slackNames: { grace: 'Grace Hopper' },
      onAskRemind: async m => {
        calls.push(`remind ${m.iid}`);
      },
      onAskDismiss: m => calls.push(`dismiss ${m.iid}`),
    })
  );
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-ask-tone')).toBe('warn');
  expect(band.getAttribute('data-ask')).toBe('parked');
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'waiting on Grace'
  );
  expect(buttons()).toEqual(['Remind', 'Dismiss']);
  expect(
    container.querySelector('.tui-ask-trigger')?.textContent
  ).not.toContain('·');
  const [remind, dismiss] = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-ask-btn'),
  ];
  await React.act(async () => remind!.click());
  await React.act(async () => dismiss!.click());
  expect(calls).toEqual(['remind 1418', 'dismiss 1418']);
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!.click();
  });
  const trail = document.querySelector('.tui-ask-trail')!;
  expect(trail.textContent).toContain("at Grace's approval gate");
  expect(trail.textContent).not.toContain('Retry');
  expect(trail.textContent).not.toContain('·');
  expect(
    trail.querySelector('.tui-ask-trail-detail > span + .tui-ask-trail-time')
  ).not.toBeNull();
});

test('a parked review their board started renders as a peer-parked band', async () => {
  const mr = {
    ...mrWith(),
    peerReviews: [
      {
        mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
        iid: 1418,
        reviewer: 'grace',
        status: 'parked',
        parkedAt: Date.now() - 60_000,
        updatedAt: Date.now() - 60_000,
        receivedAt: Date.now() - 60_000,
      },
    ],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx());
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-ask')).toBe('peer-parked');
  expect(band.getAttribute('data-ask-tone')).toBe('warn');
  expect(buttons()).toEqual(['Remind', 'Dismiss']);
});

const MR_URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';
const parkedPeer = (over: Record<string, unknown> = {}) => ({
  mrUrl: MR_URL,
  iid: 1418,
  reviewer: 'grace',
  status: 'parked',
  parkedAt: Date.now() - 60 * 60_000,
  updatedAt: Date.now() - 60 * 60_000,
  receivedAt: Date.now() - 60 * 60_000,
  ...over,
});
const FACES = { grace: 'Grace Hopper' };
const remindButton = () =>
  container.querySelector<HTMLButtonElement>('[data-action="remind"]')!;

test('a matched reviewer gets an enabled Remind that shows busy while the DM sends', async () => {
  let finish!: () => void;
  const mr = {
    ...mrWith(),
    peerReviews: [parkedPeer()],
  } as unknown as BoardMRWithReview;
  await render(
    mr,
    ctx({
      slackNames: FACES,
      onAskRemind: () => new Promise<void>(r => (finish = r)),
    })
  );
  expect(remindButton().disabled).toBe(false);
  await React.act(async () => remindButton().click());
  expect(remindButton().getAttribute('aria-busy')).toBe('true');
  await React.act(async () => finish());
  expect(remindButton().getAttribute('aria-busy')).not.toBe('true');
});

test("Remind names the matched Slack person, not the board's name for the reviewer", async () => {
  const mr = {
    ...mrWith(),
    peerReviews: [parkedPeer()],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx({ slackNames: { grace: 'Grace B. Hopper' } }));
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'waiting on grace'
  );
  expect(remindButton().title).toBe('Send Grace B. Hopper a Slack DM');
  await React.act(async () =>
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!.click()
  );
  expect(document.querySelector('.tui-ask-trail-foot')?.textContent).toBe(
    'Dismiss clears it now. Remind sends Grace B. Hopper a Slack DM.'
  );
});

test("a Remind toast names the Slack person, falling back to the board's name", () => {
  expect(remindToastName({ slackName: 'Grace B. Hopper' }, 'grace')).toBe(
    'Grace B. Hopper'
  );
  expect(remindToastName({}, 'grace')).toBe('grace');
});

test('a reviewer with no Slack match gets Remind disabled with the reason', async () => {
  const calls: string[] = [];
  const mr = {
    ...mrWith(),
    peerReviews: [parkedPeer()],
  } as unknown as BoardMRWithReview;
  await render(
    mr,
    ctx({
      slackNames: {},
      onAskRemind: async () => {
        calls.push('remind');
      },
    })
  );
  expect(remindButton().disabled).toBe(true);
  expect(remindButton().title).toBe('No Slack account matches grace');
  await React.act(async () => remindButton().click());
  expect(calls).toEqual([]);
});

test('a reminded review shows when, and holds Remind for 15 minutes', async () => {
  const remindedAt = Date.now() - 5 * 60_000;
  const mr = {
    ...mrWith(),
    peerReviews: [parkedPeer({ remindedAt })],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx({ slackNames: FACES }));
  const { clock } = await import('../ask-band.ts');
  expect(container.querySelector('.tui-ask-note')?.textContent).toBe(
    'Reminded 5m ago'
  );
  expect(remindButton().disabled).toBe(true);
  expect(remindButton().title).toBe(
    `Remind again at ${clock(remindedAt + 15 * 60_000)}`
  );
});

test("a parked sent ask shows the reminder kept on its reviewer's state", async () => {
  const remindedAt = Date.now() - 20 * 60_000;
  const mr = {
    ...mrWith({ display: 'parked', resolvedAt: Date.now() - 60 * 60_000 }),
    peerReviews: [parkedPeer({ remindedAt })],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx({ slackNames: FACES }));
  const { clock } = await import('../ask-band.ts');
  expect(container.querySelector('.tui-ask')?.getAttribute('data-ask')).toBe(
    'parked'
  );
  expect(container.querySelector('.tui-ask-note')?.textContent).toBe(
    'Reminded 20m ago'
  );
  expect(remindButton().disabled).toBe(false);
});

test('a roster username with capitals still matches the canonical reviewer', async () => {
  const mr = {
    ...mrWith(),
    peerReviews: [parkedPeer()],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx({ slackNames: { Grace: 'Grace Hopper' } }));
  expect(remindButton().disabled).toBe(false);
});

test('a parked sent ask whose reviewer state was dismissed or went stale cannot remind', async () => {
  const old = Date.now() - 49 * 60 * 60_000;
  for (const peer of [
    parkedPeer({ dismissedAt: Date.now() }),
    parkedPeer({ updatedAt: old, receivedAt: old, parkedAt: old }),
  ]) {
    const calls: string[] = [];
    const mr = {
      ...mrWith({ display: 'parked', resolvedAt: Date.now() - 60_000 }),
      peerReviews: [peer],
    } as unknown as BoardMRWithReview;
    await render(
      mr,
      ctx({
        slackNames: FACES,
        onAskRemind: async () => {
          calls.push('remind');
        },
      })
    );
    expect(remindButton().disabled).toBe(true);
    await React.act(async () => remindButton().click());
    expect(calls).toEqual([]);
  }
});

test('a dismissed peer failure renders nothing', async () => {
  const mr = {
    ...mrWith(),
    peerReviews: [
      {
        mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
        iid: 1418,
        reviewer: 'grace',
        status: 'error',
        updatedAt: NOW - 60_000,
        dismissedAt: NOW,
      },
    ],
  } as unknown as BoardMRWithReview;
  await render(mr, ctx());
  expect(container.querySelector('.tui-ask')).toBeNull();
});

test('a quiet ask renders no update with retry, dismiss and its history trail', async () => {
  const calls: string[] = [];
  await render(
    mrWith({
      display: 'no-update',
      kind: 'review',
      resolvedAt: NOW - 40 * 60_000,
    }),
    ctx({
      onAskRetry: m => calls.push(`retry ${m.iid}`),
      onAskDismiss: m => calls.push(`dismiss ${m.iid}`),
    })
  );
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-ask-tone')).toBe('warn');
  expect(container.querySelector('.tui-ask-label')?.textContent).toBe(
    'no update'
  );
  expect(container.querySelector('[data-part="spinner"]')).toBeNull();
  expect(buttons()).toEqual(['Retry', 'Dismiss']);
  const [retry, dismiss] = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-ask-btn'),
  ];
  await React.act(async () => retry!.click());
  await React.act(async () => dismiss!.click());
  expect(calls).toEqual(['retry 1418', 'dismiss 1418']);
  await React.act(async () =>
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!.click()
  );
  const trail = document.querySelector('.tui-ask-trail')!;
  expect(
    [...trail.querySelectorAll('.tui-ask-trail-name')].map(s => s.textContent)
  ).toEqual(['Requested', 'Started', 'No update']);
  expect(trail.textContent).toContain("Grace's agent has been quiet for 30m");
  expect(trail.querySelector('.tui-ask-trail-foot')?.textContent).toBe(
    'Dismiss clears it now. Retry drops the old ask and sends a fresh one.'
  );
  expect(
    [...trail.querySelectorAll('.tui-ask-trail-step')]
      .at(-1)
      ?.getAttribute('data-stop')
  ).toBe('warn');
});

test('a clicked action does not bubble to the row', async () => {
  let rowClicks = 0;
  await React.act(async () => {
    root.render(
      <div onClick={() => rowClicks++}>
        <AskBand
          mr={mrWith({ display: 'failed' })}

          ctx={ctx({ onAskRetry: () => {}, onAskDismiss: () => {} })}
        />
      </div>
    );
  });
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('.tui-ask-btn')!.click();
  });
  expect(rowClicks).toBe(0);
});

test('clicks inside the open trail do not reach the row', async () => {
  const seen: string[] = [];
  await React.act(async () => {
    root.render(
      <div
        onClick={() => seen.push('click')}
        onContextMenu={() => seen.push('context')}
      >
        <AskBand mr={mrWith({})} ctx={ctx()} />
      </div>
    );
  });
  const trigger =
    container.querySelector<HTMLButtonElement>('.tui-ask-trigger')!;
  await React.act(async () => trigger.click());
  seen.length = 0;
  const step = document.querySelector('.tui-ask-trail-step')!;
  await React.act(async () => {
    step.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    step.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  });
  expect(seen).toEqual([]);
});

test('a remote viewer sees the band without actions', async () => {
  await render(mrWith({ display: 'failed' }), ctx({ local: false }));
  expect(container.querySelector('.tui-ask')).not.toBeNull();
  expect(buttons()).toEqual([]);
});
