import { expect, test } from 'vitest';

import { hostSignalScript, injectHostSignal } from './host-signal';

type Listener = () => void;

interface FakeLink {
  tagName: 'LINK';
  href: string;
  disabled: boolean;
  sheet: { cssRules: unknown[] } | null;
  listeners: Record<string, Listener[]>;
  addEventListener(type: string, fn: Listener): void;
  fire(type: string): void;
  /** The document's capture listeners, set once the script has run. */
  capture?: (type: string, target: FakeLink) => void;
}

function link(
  href: string,
  sheet: FakeLink['sheet'],
  disabled = false
): FakeLink {
  const l: FakeLink = {
    tagName: 'LINK',
    href,
    disabled,
    sheet,
    listeners: {},
    addEventListener(type, fn) {
      (l.listeners[type] ??= []).push(fn);
    },
    fire(type) {
      l.capture?.(type, l);
      for (const fn of l.listeners[type] ?? []) fn();
    },
  };
  return l;
}

const rules = (n: number) => ({ cssRules: Array.from({ length: n }) });

function run(
  buildId: string | null,
  links: FakeLink[] = [],
  withHandler = true
) {
  const posted: unknown[] = [];
  const window: Record<string, unknown> = {
    location: { href: 'https://x/', origin: 'https://x' },
  };
  if (withHandler)
    window.webkit = {
      messageHandlers: {
        mattstackHost: { postMessage: (m: unknown) => posted.push(m) },
      },
    };
  const captured: Record<string, Array<(e: { target: unknown }) => void>> =
    {};
  const document = {
    querySelectorAll: (sel: string) =>
      sel === 'link[rel~="stylesheet"]' ? links : [],
    addEventListener(
      type: string,
      fn: (e: { target: unknown }) => void,
      capture?: boolean
    ) {
      if (capture) (captured[type] ??= []).push(fn);
    },
  };
  for (const l of links)
    l.capture = (type, target) => {
      for (const fn of captured[type] ?? []) fn({ target });
    };
  const body = hostSignalScript(buildId)
    .replace(/^<script>/, '')
    .replace(/<\/script>$/, '');
  new Function('window', 'document', body)(window, document);
  const host = window.__mattstackHost as {
    ready(): void;
    failed(reason: string): void;
    fatal(): void;
  };
  return { posted, host };
}

test('posts booting as soon as the script runs', () => {
  const { posted } = run('abc');
  expect(posted[0]).toEqual({ type: 'booting' });
});

test('ready posts ready with the build id when every sheet has rules', () => {
  const { posted, host } = run('abc', [
    link('https://x/style.css', rules(3)),
    link('/app.css', rules(1)),
  ]);
  host.ready();
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: 'abc' }]);
});

test('ready posts failed naming the stylesheet with no rules', () => {
  const { posted, host } = run('abc', [
    link('https://x/ok.css', rules(2)),
    link('https://x/style.css', rules(0)),
  ]);
  host.ready();
  expect(posted.slice(1)).toEqual([
    { type: 'failed', reason: 'stylesheet https://x/style.css' },
  ]);
});

test('ready waits for a stylesheet that is still loading', () => {
  const loading = link('https://x/style.css', null);
  const { posted, host } = run('abc', [loading]);
  host.ready();
  expect(posted.slice(1)).toEqual([]);
  loading.sheet = rules(4);
  loading.fire('load');
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: 'abc' }]);
});

test('a stylesheet that errors while loading fails', () => {
  const loading = link('https://x/style.css', null);
  const { posted, host } = run('abc', [loading]);
  host.ready();
  loading.fire('error');
  expect(posted.slice(1)).toEqual([
    { type: 'failed', reason: 'stylesheet https://x/style.css' },
  ]);
});

test('a stylesheet that failed before ready was called fails at once', () => {
  const broken = link('https://x/style.css', null);
  const { posted, host } = run('abc', [broken]);
  broken.fire('error');
  host.ready();
  expect(posted.slice(1)).toEqual([
    { type: 'failed', reason: 'stylesheet https://x/style.css' },
  ]);
});

test('a stylesheet that loaded before ready was called counts as loaded', () => {
  const loaded = link('https://x/style.css', null);
  const { posted, host } = run('abc', [loaded]);
  loaded.sheet = rules(2);
  loaded.fire('load');
  host.ready();
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: 'abc' }]);
});

test('a disabled link and a cross-origin sheet do not count', () => {
  const throwing = {
    get cssRules(): unknown[] {
      throw new Error('SecurityError');
    },
  };
  const { posted, host } = run('abc', [
    link('https://x/off.css', rules(0), true),
    link('https://cdn.example/a.css', null),
    link('https://x/fonts.css', throwing),
  ]);
  host.ready();
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: 'abc' }]);
});

test('ready posts only once', () => {
  const { posted, host } = run('abc', [link('https://x/a.css', rules(1))]);
  host.ready();
  host.ready();
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: 'abc' }]);
});

test('failed and fatal post their messages', () => {
  const { posted, host } = run('abc');
  host.failed('boot error');
  host.fatal();
  expect(posted.slice(1)).toEqual([
    { type: 'failed', reason: 'boot error' },
    { type: 'fatal' },
  ]);
});

test('with no message handler nothing throws', () => {
  const { host } = run('abc', [link('https://x/a.css', rules(1))], false);
  expect(() => {
    host.ready();
    host.failed('x');
    host.fatal();
  }).not.toThrow();
});

test('injectHostSignal puts the script right after <head>', () => {
  const script = hostSignalScript('abc');
  expect(
    injectHostSignal('<html><head><title>t</title></head></html>', 'abc')
  ).toBe(`<html><head>${script}<title>t</title></head></html>`);
  expect(injectHostSignal('<html><head lang="en"><meta></head>', 'abc')).toBe(
    `<html><head lang="en">${script}<meta></head>`
  );
  const noHead = '<html><header>x</header><body></body></html>';
  expect(injectHostSignal(noHead, 'abc')).toBe(noHead);
});

test('a null build id is sent as null', () => {
  const { posted, host } = run(null);
  host.ready();
  expect(posted.slice(1)).toEqual([{ type: 'ready', buildId: null }]);
});

test('a build id cannot close the script element', () => {
  expect(hostSignalScript('</script><b>')).not.toContain('</script><b>');
});
