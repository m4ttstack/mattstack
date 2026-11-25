import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { SupportRead } from '../../../support.ts';
import { HelpButton } from '../support/HelpButton.tsx';
import type { HelpRequest } from '../support/support-model.ts';
import {
  DM,
  MR,
  MR_PART,
  NO_SLACK,
  READY,
  request,
  VERSIONS,
  WORDS,
} from '../support/support.fixtures.ts';
import { useSupport, type Help } from '../support/use-support.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let help: Help | null = null;
const realFetch = globalThis.fetch;

/** A board server that answers from here and keeps what it is sent. */
const server = {
  read: READY as unknown,
  mine: [] as HelpRequest[] | null,
  parts: [VERSIONS] as unknown,
  send: (): Response => Response.json({ request: request('sent') }),
  asked: [] as { path: string; body: Record<string, unknown> | null }[],
};

beforeEach(() => {
  server.read = READY;
  server.mine = [];
  server.parts = [VERSIONS];
  server.send = () => Response.json({ request: request('sent') });
  server.asked = [];
  localStorage.clear();
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    server.asked.push({ path, body });
    switch (path) {
      case '/support':
        return server.read === null
          ? Response.json({}, { status: 502 })
          : Response.json(server.read);
      case '/support/mine':
        return server.mine === null
          ? Response.json({}, { status: 502 })
          : Response.json({ requests: server.mine });
      case '/support/context':
        return server.parts === null
          ? Response.json({}, { status: 502 })
          : Response.json({ parts: server.parts });
      case '/support/send':
        return server.send();
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

function Probe({ local }: { local: boolean }) {
  help = useSupport(local);
  return help && <HelpButton help={help} />;
}

const settle = () =>
  React.act(async () => {
    await new Promise(r => setTimeout(r, 5));
  });

async function mount(local = true) {
  await React.act(async () => {
    root.render(<Probe local={local} />);
  });
  await settle();
}

const pillOf = () => document.querySelector<HTMLElement>('.tui-help');
const text = () => document.body.textContent ?? '';
const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    b => b.textContent === name || b.getAttribute('aria-label') === name
  )!;
const click = async (el: HTMLElement) => {
  await React.act(async () => {
    el.click();
  });
  await settle();
};
const write = (words: string) => React.act(async () => help!.setText(words));
const sends = () => server.asked.filter(a => a.path === '/support/send');

test('no button until rt says there is someone to ask, nor on a board read from elsewhere', async () => {
  for (const read of [
    null,
    {},
    { ...READY, availability: { state: 'hidden' } },
  ]) {
    server.read = read;
    await mount();
    expect(pillOf()).toBe(null);
    await React.act(async () => root.unmount());
    root = createRoot(container);
  }
  server.read = READY;
  server.asked = [];
  await mount(false);
  expect(pillOf()).toBe(null);
  expect(server.asked).toEqual([]);
});

test('greyed, with its reason, when something is missing here', async () => {
  server.read = NO_SLACK satisfies SupportRead;
  await mount();
  expect(pillOf()!.getAttribute('aria-disabled')).toBe('true');
  expect(pillOf()!.getAttribute('aria-label')).toBe(
    'Need help? Connect Slack first'
  );
  await click(pillOf()!);
  expect(document.querySelector('.tui-help-card')).toBe(null);
});

test('the form shows who answers and what goes with it, and sends only what is left', async () => {
  server.parts = [VERSIONS, MR_PART];
  await mount();
  await React.act(async () => help!.askAbout(MR));
  await settle();
  expect(text()).toContain("Alex's Mac answers in Slack");
  expect(text()).toContain("Goes through mattstack's relay");
  expect(server.asked.find(a => a.path === '/support/context')!.body).toEqual({
    mr: { url: MR.url, state: MR.state },
  });
  await write(`  ${WORDS} `);
  await click(button('Leave out Versions'));
  // What was sent shows without the list being read again.
  server.mine = null;
  await click(button('Ask Maude'));
  expect(sends()).toHaveLength(1);
  expect(sends()[0]!.body).toMatchObject({ text: WORDS, parts: [MR_PART] });
  expect(text()).toContain("Asked Alex's agent");
  expect(help!.text).toBe('');
});

test('nothing can be sent while what goes with it is unknown', async () => {
  server.parts = null;
  await mount();
  await click(pillOf()!);
  await write(WORDS);
  expect(text()).toContain('rt did not say what would be sent');
  await React.act(async () => help!.send());
  expect(sends()).toEqual([]);
  server.parts = [VERSIONS];
  await click(button('Try again'));
  expect(text()).toContain('Versions');
});

test('a retry keeps its id and the words; changed words are a new request', async () => {
  server.send = () =>
    Response.json(
      { code: 'support-unreachable', message: 'x' },
      { status: 409 }
    );
  await mount();
  await click(pillOf()!);
  await write(WORDS);
  await click(button('Ask Maude'));
  expect(text()).toContain('Nothing was sent');
  expect(help!.text).toBe(WORDS);
  await click(button('Try again'));
  await write('Something else');
  await React.act(async () => help!.send());
  const ids = sends().map(s => s.body!.id);
  expect(ids).toHaveLength(3);
  expect(ids[1]).toBe(ids[0]!);
  expect(ids[2]).not.toBe(ids[0]!);
});

test('a send nobody answered never says nothing was sent', async () => {
  server.send = () => new Response('gateway', { status: 502 });
  await mount();
  await click(pillOf()!);
  await write(WORDS);
  await click(button('Ask Maude'));
  expect(text()).toContain('rt did not answer');
  expect(text()).not.toContain('Nothing was sent');
});

test('words rt will not take come back to be shortened', async () => {
  server.send = () =>
    Response.json(
      { code: 'support-too-long', message: 'That is too long to send.' },
      { status: 409 }
    );
  await mount();
  await click(pillOf()!);
  await write(WORDS);
  await click(button('Ask Maude'));
  await click(button('Edit'));
  expect(document.querySelector('textarea')!.value).toBe(WORDS);
});

test('a request keeps the name and the DM of the person it went to', async () => {
  server.read = {
    ...READY,
    availability: { ...READY.availability, host: 'Bea Finch' },
  };
  server.mine = [
    request('not-accepting', {
      hostDm: 'https://slack.com/app_redirect?channel=U0OLD',
    }),
  ];
  await mount();
  await click(pillOf()!);
  expect(text()).toContain("Alex isn't taking requests");
  const link = [...document.querySelectorAll('a')].find(
    a => a.textContent === 'Message Alex'
  )!;
  expect(link.href).toBe('https://slack.com/app_redirect?channel=U0OLD');
});

test('a host who stops answering keeps the open form, and their name on its refusal', async () => {
  server.send = () =>
    Response.json(
      { code: 'support-not-accepting', message: 'x' },
      { status: 409 }
    );
  await mount();
  await click(pillOf()!);
  await write(WORDS);
  server.read = { ...READY, availability: { state: 'hidden' } };
  await React.act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
  await click(button('Ask Maude'));
  expect(text()).toContain("Alex isn't taking requests");
  await click(button('Close'));
  expect(pillOf()).toBe(null);
});

test('an opened chat is a link into Slack, and following it puts the button back', async () => {
  server.mine = [request('opened', { dmLink: DM })];
  await mount();
  const link = pillOf() as HTMLAnchorElement;
  expect(link.textContent).toBe('Maude is in Slack');
  expect(link.getAttribute('href')).toBe(DM);
  link.addEventListener('click', e => e.preventDefault());
  await click(link);
  expect(pillOf()!.textContent).toBe('Need help?');
  expect(localStorage.getItem('board-support-seen')).toContain('req-opened');
});

test('news is told once: closing its card puts the button back', async () => {
  server.mine = [request('declined')];
  await mount();
  expect(pillOf()!.textContent).toBe("Request didn't open");
  await click(pillOf()!);
  expect(text()).toContain('Alex declined this one');
  expect(
    [...document.querySelectorAll('a')].find(
      a => a.textContent === 'Message Alex'
    )!.href
  ).toBe(READY.hostDm!);
  await click(button('Close'));
  expect(pillOf()!.textContent).toBe('Need help?');
});

test('a request still going stays on the button after its card closes', async () => {
  server.mine = [request('waiting')];
  await mount();
  await click(pillOf()!);
  expect(text()).toContain('Alex needs to OK this one');
  await click(button('Close'));
  expect(pillOf()!.textContent).toBe('Waiting for Alex');
});

test('asking again brings the words back', async () => {
  server.mine = [request('expired')];
  await mount();
  await click(pillOf()!);
  await click(button('Ask again'));
  expect(help!.text).toBe(WORDS);
  expect(document.querySelector('[data-face="form"]')).not.toBe(null);
});
