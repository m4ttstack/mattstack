/** The code owners post is confirmed, never fired: the dialog lists the
    channels it will post to and the sections it leaves out, and sends only
    what is still checked when the user confirms. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { ActionResult } from '../../api.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { OwnersPostModal } from '../OwnersPostModal.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const MR_URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418';
const mr = {
  iid: 1418,
  title: 'ACME-12 Port the flows',
  webUrl: MR_URL,
} as unknown as BoardMRWithReview;

const PREVIEW = {
  text: `please review ${MR_URL}`,
  channels: [
    {
      channel: 'pod-acme',
      sections: ['Acme - #pod-acme', 'Acme Jobs - #pod-acme'],
    },
    { channel: 'pod-docs', sections: ['Docs - #pod-docs'] },
  ],
  skipped: [
    {
      section: 'Billing - #pod-billing',
      reason: 'approved',
      channel: 'pod-billing',
    },
    { section: 'Tools', reason: 'no-channel' },
    {
      section: 'Hub - #pod-hub',
      reason: 'already-posted',
      channel: 'pod-hub',
      permalink: 'https://team.slack.example/archives/C1/p1',
    },
    {
      section: 'Gone - #pod-gone',
      reason: 'channel-unavailable',
      channel: 'pod-gone',
    },
  ],
};

const ok = (body: unknown): ActionResult =>
  ({ ok: true, status: 200, body, text: JSON.stringify(body) }) as ActionResult;
const fail = (status: number, text: string): ActionResult =>
  ({ ok: false, status, body: null, text }) as ActionResult;

type Call = { path: string; payload: unknown };

async function open(
  answers: Record<string, ActionResult>,
  handlers: {
    onPosted?: (channels: string[]) => void;
    onClose?: () => void;
  } = {}
): Promise<Call[]> {
  const calls: Call[] = [];
  await React.act(async () => {
    root.render(
      <OwnersPostModal
        mr={mr}
        post={async (path, payload) => {
          calls.push({ path, payload });
          return answers[path]!;
        }}
        onPosted={handlers.onPosted ?? (() => {})}
        onClose={handlers.onClose ?? (() => {})}
      />
    );
  });
  return calls;
}

const confirmButton = () =>
  [...document.querySelectorAll('button')].find(b =>
    /^post to |^posting/.test(b.textContent?.trim() ?? '')
  ) as HTMLButtonElement | undefined;
const toggle = (channel: string) =>
  document.querySelector(
    `input[aria-label="post to #${channel}"]`
  ) as HTMLInputElement;
const click = (el: Element) =>
  React.act(async () => {
    (el as HTMLElement).click();
  });

test('asks for the preview on open and lists each channel, checked, with its sections', async () => {
  const calls = await open({ '/slack/owners/preview': ok(PREVIEW) });
  expect(calls).toEqual([
    { path: '/slack/owners/preview', payload: { mrUrl: MR_URL } },
  ]);
  expect(toggle('pod-acme').checked).toBe(true);
  expect(toggle('pod-docs').checked).toBe(true);
  const text = document.body.textContent ?? '';
  expect(text).toContain('#pod-acme');
  expect(text).toContain('Acme, Acme Jobs');
  expect(text).toContain(`please review ${MR_URL}`);
  expect(confirmButton()!.textContent).toBe('post to 2 channels');
  expect(confirmButton()!.disabled).toBe(false);
});

test('says why each skipped section is left out, and links a post already made', async () => {
  await open({ '/slack/owners/preview': ok(PREVIEW) });
  const text = document.body.textContent ?? '';
  expect(text).toContain('Billing');
  expect(text).toContain('already approved');
  expect(text).toContain('Tools');
  expect(text).toContain('no channel in its name');
  expect(text).toContain(
    '#pod-gone is not in Slack, or the board is not in it'
  );
  const link = document.querySelector(
    'a[href="https://team.slack.example/archives/C1/p1"]'
  );
  expect(link?.textContent).toBe('already posted to #pod-hub');
});

test('unchecking a channel changes the count, and unchecking all disables the confirm', async () => {
  await open({ '/slack/owners/preview': ok(PREVIEW) });
  await click(toggle('pod-docs'));
  expect(confirmButton()!.textContent).toBe('post to 1 channel');
  await click(toggle('pod-acme'));
  const none = [...document.querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'no channel selected'
  ) as HTMLButtonElement;
  expect(none.disabled).toBe(true);
  expect(confirmButton()).toBeUndefined();
});

test('confirm sends only the channels still checked, then reports them', async () => {
  const posted: string[][] = [];
  const calls = await open(
    {
      '/slack/owners/preview': ok(PREVIEW),
      '/slack/owners/post': ok({
        posted: [{ channel: 'pod-acme', permalink: 'https://x' }],
        failed: [],
      }),
    },
    { onPosted: channels => posted.push(channels) }
  );
  await click(toggle('pod-docs'));
  expect(calls).toHaveLength(1);
  await click(confirmButton()!);
  expect(calls[1]).toEqual({
    path: '/slack/owners/post',
    payload: { mrUrl: MR_URL, channels: ['pod-acme'] },
  });
  expect(posted).toEqual([['pod-acme']]);
});

test('cancel closes without sending', async () => {
  let closed = 0;
  const calls = await open(
    { '/slack/owners/preview': ok(PREVIEW) },
    { onClose: () => closed++ }
  );
  const cancel = [...document.querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'cancel'
  )!;
  await click(cancel);
  expect(closed).toBe(1);
  expect(calls.map(c => c.path)).toEqual(['/slack/owners/preview']);
});

test('with nothing to post there is no confirm, only the reasons', async () => {
  await open({
    '/slack/owners/preview': ok({ ...PREVIEW, channels: [] }),
  });
  expect(confirmButton()).toBeUndefined();
  const text = document.body.textContent ?? '';
  expect(text).toContain('nothing to post');
  expect(text).toContain('already approved');
});

test('an MR with no code owner sections says so', async () => {
  await open({
    '/slack/owners/preview': ok({ text: 'x', channels: [], skipped: [] }),
  });
  expect(document.body.textContent).toContain(
    'this MR has no code owner sections'
  );
  expect(confirmButton()).toBeUndefined();
});

test('a failed preview shows the reason and offers no confirm', async () => {
  await open({
    '/slack/owners/preview': fail(
      502,
      'could not read approvals from GitLab: timeout'
    ),
  });
  expect(document.body.textContent).toContain(
    'could not read approvals from GitLab: timeout'
  );
  expect(confirmButton()).toBeUndefined();
});

test('a failed post keeps the dialog open and says nothing was confirmed sent', async () => {
  const posted: string[][] = [];
  await open(
    {
      '/slack/owners/preview': ok(PREVIEW),
      '/slack/owners/post': fail(502, ''),
    },
    { onPosted: channels => posted.push(channels) }
  );
  await click(confirmButton()!);
  expect(posted).toEqual([]);
  expect(document.body.textContent).toContain('post failed (502)');
  expect(confirmButton()!.disabled).toBe(false);
});

test('a partly failed post names the channels that did not go', async () => {
  const posted: string[][] = [];
  await open(
    {
      '/slack/owners/preview': ok(PREVIEW),
      '/slack/owners/post': ok({
        posted: [{ channel: 'pod-acme', permalink: 'https://x' }],
        failed: [
          {
            channel: 'pod-docs',
            error: 'slack chat.postMessage: not_in_channel',
          },
        ],
      }),
    },
    { onPosted: channels => posted.push(channels) }
  );
  await click(confirmButton()!);
  expect(posted).toEqual([]);
  const text = document.body.textContent ?? '';
  expect(text).toContain('posted to #pod-acme');
  expect(text).toContain(
    '#pod-docs failed: slack chat.postMessage: not_in_channel'
  );
});
