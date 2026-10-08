/** Posting to Slack across code owners is confirmed, never fired: the
    dialog lists the team channel first, then the code owner channels it will
    post to and the sections it leaves out, and sends only what is still
    checked when the user confirms. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { ActionResult } from '../../api.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { OwnersPostModal, type SlackPostPreview } from '../OwnersPostModal.tsx';

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

const PREVIEW: SlackPostPreview = {
  text: `please review ${MR_URL}`,
  team: { channel: 'code-review', posted: false },
  direct: false,
  ownSections: [] as string[],
  unchecked: [] as string[],
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
    { section: 'C#Tools', reason: 'no-channel' },
    {
      section: 'Hub - #pod-hub',
      reason: 'already-posted',
      channel: 'pod-hub',
      permalink: 'https://team.slack.example/archives/C1/p1',
    },
    {
      section: 'Gone - #pod-gone',
      reason: 'channel-missing',
      channel: 'pod-gone',
    },
    {
      section: 'Ops - #pod-ops',
      reason: 'not-member',
      channel: 'pod-ops',
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
    initial?: SlackPostPreview;
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
        initial={handlers.initial}
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
  expect(toggle('code-review').checked).toBe(true);
  expect(toggle('pod-acme').checked).toBe(true);
  expect(toggle('pod-docs').checked).toBe(true);
  const text = document.body.textContent ?? '';
  expect(text).toContain('post to slack');
  expect(text).toContain('team review');
  expect(text).toContain('#pod-acme');
  expect(text).toContain('Acme, Acme Jobs');
  expect(text).toContain(`please review ${MR_URL}`);
  expect(confirmButton()!.textContent).toBe('post to 3 channels');
  expect(confirmButton()!.disabled).toBe(false);
});

test('says why each skipped section is left out, and links a post already made', async () => {
  await open({ '/slack/owners/preview': ok(PREVIEW) });
  const text = document.body.textContent ?? '';
  expect(text).toContain('Billing');
  expect(text).toContain('already approved');
  expect(text).toContain('Tools');
  expect(text).toContain('no channel in its name');
  expect(text).toContain('#pod-gone was not found in Slack');
  expect(text).toContain('you are not in #pod-ops, join it in Slack to post');
  const link = document.querySelector(
    'a[href="https://team.slack.example/archives/C1/p1"]'
  );
  expect(link?.textContent).toBe('already posted to #pod-hub');
});

test('unchecking a channel changes the count, and unchecking all disables the confirm', async () => {
  await open({ '/slack/owners/preview': ok(PREVIEW) });
  await click(toggle('pod-docs'));
  expect(confirmButton()!.textContent).toBe('post to 2 channels');
  await click(toggle('code-review'));
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
    payload: { mrUrl: MR_URL, team: true, channels: ['pod-acme'] },
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
    '/slack/owners/preview': ok({
      ...PREVIEW,
      team: { channel: 'code-review', posted: true },
      channels: [],
    }),
  });
  expect(confirmButton()).toBeUndefined();
  const text = document.body.textContent ?? '';
  expect(text).toContain('nothing to post');
  expect(text).toContain('already approved');
});

test('a team thread already posted shows its link and is not sent again', async () => {
  const calls = await open({
    '/slack/owners/preview': ok({
      ...PREVIEW,
      team: {
        channel: 'code-review',
        posted: true,
        permalink: 'https://team.slack.example/archives/C9/p9',
      },
    }),
    '/slack/owners/post': ok({ posted: [], failed: [] }),
  });
  expect(toggle('code-review')).toBeNull();
  const link = document.querySelector(
    'a[href="https://team.slack.example/archives/C9/p9"]'
  );
  expect(link?.textContent).toBe('already posted to #code-review');
  expect(confirmButton()!.textContent).toBe('post to 2 channels');
  await click(confirmButton()!);
  expect(calls[1]!.payload).toEqual({
    mrUrl: MR_URL,
    team: false,
    channels: ['pod-acme', 'pod-docs'],
  });
});

test('our own code owner sections ride on the team row', async () => {
  await open({
    '/slack/owners/preview': ok({
      ...PREVIEW,
      ownSections: ['Ours - #pod-ours'],
    }),
  });
  expect(document.body.textContent).toContain('team review, Ours');
});

test('a channel the board could not read for an earlier post says so', async () => {
  await open({
    '/slack/owners/preview': ok({ ...PREVIEW, unchecked: ['pod-docs'] }),
  });
  expect(document.body.textContent).toContain(
    'could not check for an earlier post'
  );
});

test('a preview handed in is shown without asking again', async () => {
  const calls = await open({}, { initial: PREVIEW });
  expect(calls).toEqual([]);
  expect(toggle('pod-acme').checked).toBe(true);
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

test('a section name keeps a hash that is not its channel', async () => {
  await open({ '/slack/owners/preview': ok(PREVIEW) });
  expect(document.body.textContent).toContain('C#Tools');
});

test('a failed post keeps the dialog open, reports the status and asks for a fresh preview', async () => {
  const posted: string[][] = [];
  const calls = await open(
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
  expect(calls.map(c => c.path)).toEqual([
    '/slack/owners/preview',
    '/slack/owners/post',
    '/slack/owners/preview',
  ]);
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
