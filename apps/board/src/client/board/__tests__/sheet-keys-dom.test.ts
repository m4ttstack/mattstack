import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

const { sheetKey } = await import('../sheet-keys.ts');

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let sheet: HTMLElement;

beforeEach(() => {
  sheet = document.createElement('div');
  sheet.className = 'tui-gate-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  sheet.innerHTML = `
    <textarea id="comment"></textarea>
    <input id="note" type="text" />
    <input id="verdict" type="radio" />
    <input id="pick" type="checkbox" />
    <button id="btn" type="button">x</button>`;
  document.body.appendChild(sheet);
});

afterEach(() => {
  document.body.innerHTML = '';
});

const key = (
  target: EventTarget | null,
  k: string,
  mods: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    isComposing: boolean;
  }> = {}
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  target,
  ...mods,
});

const el = (id: string) => document.getElementById(id);

test('Cmd+Enter and Ctrl+Enter submit from anywhere in the sheet, text fields included', () => {
  for (const target of [sheet, el('comment'), el('note'), el('btn')]) {
    expect(sheetKey(key(target, 'Enter', { metaKey: true }), 0)).toEqual({
      kind: 'submit',
    });
    expect(sheetKey(key(target, 'Enter', { ctrlKey: true }), 0)).toEqual({
      kind: 'submit',
    });
  }
});

test('plain, shifted or alt Enter is never a submit', () => {
  expect(sheetKey(key(sheet, 'Enter'), 2)).toBeNull();
  expect(
    sheetKey(key(sheet, 'Enter', { metaKey: true, shiftKey: true }), 2)
  ).toBeNull();
  expect(
    sheetKey(key(sheet, 'Enter', { metaKey: true, altKey: true }), 2)
  ).toBeNull();
});

test('a number picks its option outside text fields, up to the option count', () => {
  for (const target of [sheet, el('verdict'), el('pick'), el('btn')]) {
    expect(sheetKey(key(target, '2'), 2)).toEqual({ kind: 'pick', index: 1 });
  }
  expect(sheetKey(key(sheet, '3'), 2)).toBeNull();
  expect(sheetKey(key(sheet, '0'), 9)).toBeNull();
  expect(sheetKey(key(sheet, '1'), 0)).toBeNull();
});

test('a number typed into a text field stays text', () => {
  expect(sheetKey(key(el('comment'), '1'), 2)).toBeNull();
  expect(sheetKey(key(el('note'), '1'), 2)).toBeNull();
});

test('a number with a modifier is the browser’s, not a pick', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const)
    expect(sheetKey(key(sheet, '1', { [mod]: true }), 2)).toBeNull();
});

test('an IME composition keeps its keys', () => {
  expect(
    sheetKey(
      key(el('comment'), 'Enter', { metaKey: true, isComposing: true }),
      0
    )
  ).toBeNull();
});

test('focus on the page counts as the open sheet', () => {
  expect(sheetKey(key(document.body, '1'), 2)).toEqual({
    kind: 'pick',
    index: 0,
  });
});

test('a modal open over the sheet keeps its keys', () => {
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = '<button id="inner" type="button">x</button>';
  sheet.appendChild(modal);
  expect(sheetKey(key(el('inner'), 'Enter', { metaKey: true }), 0)).toBeNull();
  expect(sheetKey(key(el('inner'), '1'), 2)).toBeNull();
});

test('keys outside any gate sheet are ignored', () => {
  sheet.remove();
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  expect(sheetKey(key(outside, 'Enter', { metaKey: true }), 0)).toBeNull();
  expect(sheetKey(key(document.body, '1'), 2)).toBeNull();
});
