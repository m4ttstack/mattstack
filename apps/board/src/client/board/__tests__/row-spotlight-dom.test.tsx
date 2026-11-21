/** The row spotlight stays on its MR's row when the board re-lays out
    underneath it, not only on scroll and window resize. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { RowSpotlight } from '../RowSpotlight.tsx';
import {
  installFakeResizeObserver,
  observerOf,
} from './fake-resize-observer.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = 'https://gitlab.example/acme/widgets/-/merge_requests/7';

let root: Root;
let container: HTMLElement;
let rows: HTMLElement;
let restore: () => void;

function placeRow(row: Element, top: number) {
  (row as HTMLElement).getBoundingClientRect = () =>
    ({
      top,
      left: 10,
      width: 600,
      height: 32,
      right: 610,
      bottom: top + 32,
    }) as DOMRect;
}

function makeRow(url: string, top: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tui-row';
  row.dataset.mrUrl = url;
  placeRow(row, top);
  return row;
}

const spot = () => document.querySelector<HTMLElement>('.tui-row-spot');

/** Lets the observers' callbacks and the frame they schedule run. */
async function settle() {
  await React.act(async () => {
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => requestAnimationFrame(() => r(null)));
  });
}

/** Renders the spot and lets the frame its own mount schedules run. */
async function mount() {
  await React.act(async () => root.render(<RowSpotlight mrUrl={MR} open />));
  await settle();
}

beforeEach(() => {
  restore = installFakeResizeObserver();
  rows = document.createElement('div');
  document.body.appendChild(rows);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  rows.remove();
  restore();
});

test('follows its row when a row is inserted above it', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();
  expect(spot()?.style.top).toBe('100px');

  placeRow(row, 132);
  rows.insertBefore(makeRow('https://gitlab.example/other', 100), row);
  await settle();

  expect(spot()?.style.top).toBe('132px');
});

test('finds the row again when the board replaces its element', async () => {
  const first = makeRow(MR, 100);
  rows.appendChild(first);
  await mount();

  first.remove();
  rows.appendChild(makeRow(MR, 240));
  await settle();

  expect(spot()?.style.top).toBe('240px');
});

test('follows its row when it resizes without a DOM change', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();
  const observer = observerOf(row);
  expect(observer).toBeDefined();

  placeRow(row, 180);
  observer?.fire();
  await settle();

  expect(spot()?.style.top).toBe('180px');
});

test('hides when its row leaves the board', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();

  row.remove();
  await settle();

  expect(spot()).toBeNull();
});

test('still follows a scroll', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();

  placeRow(row, 60);
  window.dispatchEvent(new Event('scroll'));
  await settle();

  expect(spot()?.style.top).toBe('60px');
});

test('draws nothing over a row that measures zero', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();

  (row as HTMLElement).getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
  row.setAttribute('data-hidden', 'true');
  await settle();

  expect(spot()).toBeNull();
});

test('stops watching once closed', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await mount();
  expect(observerOf(row)).toBeDefined();

  await React.act(async () => root.unmount());
  root = createRoot(container);

  expect(observerOf(row)).toBeUndefined();
});

test('drops the old box when switched to an MR with no row', async () => {
  rows.appendChild(makeRow(MR, 100));
  await mount();

  await React.act(async () =>
    root.render(<RowSpotlight mrUrl="https://gitlab.example/gone" open />)
  );
  await settle();

  expect(spot()).toBeNull();
});
