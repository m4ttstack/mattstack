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
  await React.act(async () => root.render(<RowSpotlight mrUrl={MR} open />));
  expect(spot()?.style.top).toBe('100px');

  placeRow(row, 132);
  rows.insertBefore(makeRow('https://gitlab.example/other', 100), row);
  await settle();

  expect(spot()?.style.top).toBe('132px');
});

test('finds the row again when the board replaces its element', async () => {
  const first = makeRow(MR, 100);
  rows.appendChild(first);
  await React.act(async () => root.render(<RowSpotlight mrUrl={MR} open />));

  first.remove();
  rows.appendChild(makeRow(MR, 240));
  await settle();

  expect(spot()?.style.top).toBe('240px');
});

test('follows its row when it resizes without a DOM change', async () => {
  const row = makeRow(MR, 100);
  rows.appendChild(row);
  await React.act(async () => root.render(<RowSpotlight mrUrl={MR} open />));
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
  await React.act(async () => root.render(<RowSpotlight mrUrl={MR} open />));

  row.remove();
  await settle();

  expect(spot()).toBeNull();
});
