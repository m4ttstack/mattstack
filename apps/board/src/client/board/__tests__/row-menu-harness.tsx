/** Render harness for the row menu's DOM tests. Every call the menu makes is
    recorded as an effect string ("mr:merge", "launch:review:focus"), so the
    pins describe what a click does without naming the props that carry it.
    When RowMenu's props change, only renderRowMenu changes; the pins must
    not. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import type { ActionRequest, MenuEntry, RunOpts } from '../row-actions.ts';
import { actionEnvOf, type MenuEnv } from './menu-fixtures.ts';

export interface Effect {
  effect: string;
  iid: number;
  note?: string;
}

export const harness: { effects: Effect[]; closed: boolean } = {
  effects: [],
  closed: false,
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RowMenu: typeof import('../RowMenu.tsx').RowMenu;
let ActionMenu: typeof import('../ActionMenu.tsx').ActionMenu;
let root: ReturnType<typeof import('react-dom/client').createRoot> | null =
  null;
let container: HTMLDivElement | null = null;

export function useMenuHarness(): void {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  beforeAll(async () => {
    React = await import('react');
    ({ createRoot } = await import('react-dom/client'));
    ({ RowMenu } = await import('../RowMenu.tsx'));
    ({ ActionMenu } = await import('../ActionMenu.tsx'));
  });
  afterEach(async () => {
    await closeMenu();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

function record(effect: string, mr: { iid: number }, note?: string): void {
  harness.effects.push(
    note === undefined ? { effect, iid: mr.iid } : { effect, iid: mr.iid, note }
  );
}

function effectOf(req: ActionRequest, opts: RunOpts): string {
  switch (req.kind) {
    case 'launch':
      return `launch:${req.flow}${req.intent === 'focus' ? ':focus' : ''}`;
    case 'mr':
      return `mr:${req.action}`;
    case 'draft':
      return `draft:${req.draft}`;
    case 'react':
      return `react:${req.emoji}:${req.remove}`;
    case 'ask':
      return `ask:${req.ask}:${opts.pick ?? req.reviewer}`;
    case 'open':
      return `open:${req.url}`;
    case 'view-report':
      return `view-report:${req.lane}`;
    case 'dismiss':
      return `dismiss:${req.lane}`;
    case 'stand-down':
      return `stand-down:${req.on}`;
    default:
      return req.kind;
  }
}

function renderRowMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  reactionsReply: string[] | null,
  reactionsHeld: Promise<void>
) {
  return (
    <RowMenu
      menu={{ x: 10, y: 10, mr }}
      env={actionEnvOf(env, mr)}
      onClose={() => {
        harness.closed = true;
      }}
      onRun={(action, m, opts) => {
        record(effectOf(action.request, opts), m, opts.note);
        return action.request.kind === 'react'
          ? reactionsHeld.then(() => ({
              ok: true,
              status: 200,
              body: reactionsReply ? { reactions: reactionsReply } : null,
              text: '',
            }))
          : undefined;
      }}
    />
  );
}

/** `reactionsHeld` keeps a reaction's write in flight until it settles. */
export async function openMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  opts: {
    reactionsReply?: string[] | null;
    reactionsHeld?: Promise<void>;
  } = {}
): Promise<void> {
  await mount(
    renderRowMenu(
      mr,
      env,
      opts.reactionsReply ?? null,
      opts.reactionsHeld ?? Promise.resolve()
    )
  );
}

/** The shared menu on its own, as the bulk menu draws it: effects are the
    bare entry keys. */
export async function openActionMenu(
  entries: MenuEntry[],
  opts: { flat?: boolean } = {}
): Promise<void> {
  await mount(
    <ActionMenu
      x={10}
      y={10}
      subject="2 selected"
      entries={entries}
      flat={opts.flat}
      onRun={key => {
        harness.effects.push({ effect: key, iid: 0 });
      }}
      onClose={() => {
        harness.closed = true;
      }}
    />
  );
}

async function mount(node: React.ReactNode): Promise<void> {
  await closeMenu();
  harness.effects = [];
  harness.closed = false;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await React.act(async () => {
    r.render(node);
  });
}

export async function closeMenu(): Promise<void> {
  const r = root;
  if (r) await React.act(async () => r.unmount());
  container?.remove();
  root = null;
  container = null;
}

const ITEM = '[role="menuitem"]';
const OPENER = '[aria-haspopup="menu"]';
// Scoped to a Sub part: the kit's hidden root trigger is an opener too.
const SUB_ROW = `[data-part="contextmenu-sub"] > ${OPENER}`;

/** A reaction toggle shows only its emoji; its words are its aria-label. */
function labelOf(el: Element): string {
  return el.getAttribute('aria-label') ?? el.textContent ?? '';
}

function rootMenu(): Element | null {
  return document.querySelector('[data-part="contextmenu"]');
}

function subRows(): HTMLElement[] {
  return [...(rootMenu()?.querySelectorAll<HTMLElement>(SUB_ROW) ?? [])];
}

/** A flyout's panel is portalled next to the menu, not inside its Sub, so it
    is found through the row's aria-controls. Null while closed. */
function panelOf(row: HTMLElement): Element | null {
  const id = row.getAttribute('aria-controls');
  return row.getAttribute('aria-expanded') === 'true' && id
    ? document.getElementById(id)
    : null;
}

/** Throws when the panel does not appear, so a flyout that fails to open
    cannot read as an empty one. */
async function openRow(row: HTMLElement): Promise<Element> {
  if (row.getAttribute('aria-expanded') !== 'true')
    await React.act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  const panel = panelOf(row);
  if (!panel) throw new Error(`flyout "${labelOf(row)}" did not open`);
  return panel;
}

/** Opens the flyout whose row reads `title`. */
export async function openSub(title: string): Promise<void> {
  const row = subRows().find(el => labelOf(el) === title);
  if (!row) throw new Error(`no flyout "${title}"`);
  await openRow(row);
}

/** The open menu, top to bottom: `# label`, item text, `---` separator,
    `[a | b]` for a row of toggles, `> title` for a flyout. */
export function menuLines(): string[] {
  const menu = rootMenu();
  if (!menu) return [];
  return [...menu.children].map(el => {
    const part = el.getAttribute('data-part');
    if (part === 'contextmenu-label') return `# ${el.textContent}`;
    if (part === 'contextmenu-separator') return '---';
    if (part === 'contextmenu-row')
      return `[${[...el.querySelectorAll(ITEM)].map(labelOf).join(' | ')}]`;
    if (part === 'contextmenu-sub')
      return `> ${el.querySelector(OPENER)?.firstElementChild?.textContent ?? ''}`;
    if (el.tagName === 'TEXTAREA') return '[note box]';
    return el.textContent ?? '';
  });
}

/** Every item label on screen, open flyouts included. */
export function itemTexts(): string[] {
  return [...document.querySelectorAll(ITEM)].map(labelOf);
}

/** Every item label, flyout contents included, top to bottom. Opens each
    flyout to read it. */
export async function allItemLabels(): Promise<string[]> {
  const menu = rootMenu();
  if (!menu) return [];
  const out: string[] = [];
  for (const el of [...menu.children]) {
    const part = el.getAttribute('data-part');
    if (part === 'contextmenu-row')
      out.push(...[...el.querySelectorAll(ITEM)].map(labelOf));
    else if (part === 'contextmenu-sub') {
      const panel = await openRow(el.querySelector<HTMLElement>(OPENER)!);
      out.push(...[...(panel?.querySelectorAll(ITEM) ?? [])].map(labelOf));
    } else if (el.matches(ITEM)) out.push(labelOf(el));
  }
  return out;
}

/** The item reading exactly `text`, else the first that contains it. The menu
    is searched first, then each flyout in turn, opening it; the flyout that
    holds the hit is left open. */
async function locate(text: string): Promise<HTMLElement | undefined> {
  const scopes: Array<() => Promise<Element | null>> = [
    async () => rootMenu(),
    ...subRows().map(row => () => openRow(row)),
  ];
  const matches = [
    (el: Element) => labelOf(el) === text,
    (el: Element) => labelOf(el).includes(text),
  ];
  for (const match of matches)
    for (const scope of scopes) {
      const hit = [
        ...((await scope())?.querySelectorAll<HTMLElement>(
          `${ITEM}:not(${OPENER})`
        ) ?? []),
      ].find(match);
      if (hit) return hit;
    }
  return undefined;
}

export async function clickItem(
  text: string,
  init: MouseEventInit = {}
): Promise<void> {
  const hit = await locate(text);
  if (!hit) {
    throw new Error(
      `no menu item "${text}" in: ${(await allItemLabels()).join(' | ')}`
    );
  }
  await React.act(async () => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });
}

export async function typeNote(text: string): Promise<void> {
  const ta = document.querySelector<HTMLTextAreaElement>(
    'textarea.tui-menu-note'
  );
  if (!ta) throw new Error('no note box');
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    setValue.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  });
}

export async function act(fn: () => unknown): Promise<void> {
  await React.act(async () => {
    await fn();
  });
}

/** happy-dom never turns Enter on a button into a click, so this does what
    the browser does: the click follows unless the keydown was prevented. */
export async function pressEnter(el: HTMLElement): Promise<void> {
  await act(() => {
    const down = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    if (el.dispatchEvent(down))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
}

export async function flush(): Promise<void> {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

/** Opens the menu fresh for every item, clicks it (and its confirm or first
    pick, when it has one), and reports `label → effects`. */
export async function clickEach(
  mr: BoardMRWithReview,
  env: MenuEnv
): Promise<string[]> {
  await openMenu(mr, env);
  const labels = await allItemLabels();
  const out: string[] = [];
  for (const label of labels) {
    await openMenu(mr, env);
    await clickItem(label);
    const armed = harness.closed
      ? undefined
      : itemTexts().find(t => t.startsWith('really'));
    if (armed) await clickItem(armed);
    if (!harness.closed && menuLines()[0] === '# request review from')
      await clickItem(itemTexts()[0]!);
    const fx = harness.effects.map(e => e.effect).join(', ') || '(nothing)';
    out.push(`${label} → ${fx}${harness.closed ? '' : ' (stays open)'}`);
  }
  await closeMenu();
  return out;
}
