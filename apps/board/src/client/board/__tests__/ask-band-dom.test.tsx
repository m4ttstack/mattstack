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
type RowContext = import('../../types.ts').RowContext;
type BoardMRWithReview = import('../../types.ts').BoardMRWithReview;
type SentNudgeInfo = import('../../types.ts').SentNudgeInfo;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ AskBand } = await import('../AskBand.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const NOW = 10_000_000_000;

const mrWith = (sent?: Partial<SentNudgeInfo>): BoardMRWithReview =>
  ({
    iid: 1418,
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
    gates: [],
    ...(sent
      ? {
          sentNudge: {
            display: 'requested',
            reviewer: 'leath',
            sentAt: NOW - 60_000,
            ...sent,
          },
        }
      : {}),
  }) as unknown as BoardMRWithReview;

function ctx(over: Partial<RowContext> = {}): RowContext {
  return { local: true, ...over } as RowContext;
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
    root.render(<AskBand mr={mr} now={NOW} ctx={c} />);
  });
}

const buttons = () =>
  [...container.querySelectorAll('button')].map(b => b.textContent);

test('no sent ask renders nothing', async () => {
  await render(mrWith(), ctx());
  expect(container.querySelector('.tui-ask')).toBeNull();
});

test('names the teammate agent, the state, and carries the trail as the hover title', async () => {
  await render(mrWith({ kind: 're-review' }), ctx());
  const band = container.querySelector('.tui-ask')!;
  expect(band.getAttribute('data-tone')).toBe('neutral');
  expect(band.textContent).toContain("leath's agent");
  expect(band.textContent).toContain('re-review requested');
  expect(band.getAttribute('title')).toContain('requested 1m ago');
  expect(buttons()).toEqual([]);
});

test('a running ask shows the spinner and no action', async () => {
  await render(mrWith({ display: 'launched', resolvedAt: NOW }), ctx());
  expect(container.querySelector('.tui-ask-ring')).not.toBeNull();
  expect(buttons()).toEqual([]);
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
    container.querySelector<HTMLButtonElement>('button')!.click();
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
    const [retry, dismiss] = [...container.querySelectorAll('button')];
    await React.act(async () => retry!.click());
    await React.act(async () => dismiss!.click());
    expect(calls).toEqual(['retry 1418', 'dismiss 1418']);
  }
});

test('a clicked action does not bubble to the row', async () => {
  let rowClicks = 0;
  await React.act(async () => {
    root.render(
      <div onClick={() => rowClicks++}>
        <AskBand
          mr={mrWith({ display: 'failed' })}
          now={NOW}
          ctx={ctx({ onAskRetry: () => {}, onAskDismiss: () => {} })}
        />
      </div>
    );
  });
  await React.act(async () => {
    container.querySelector<HTMLButtonElement>('button')!.click();
  });
  expect(rowClicks).toBe(0);
});

test('a remote viewer sees the band without actions', async () => {
  await render(mrWith({ display: 'failed' }), ctx({ local: false }));
  expect(container.querySelector('.tui-ask')).not.toBeNull();
  expect(buttons()).toEqual([]);
});
