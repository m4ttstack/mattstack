import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

const TRIGGER = /^actions for /;

/** The layer's actions menu trigger, or null when no action applies. */
export function actionsTrigger(layer: HTMLElement): HTMLElement | null {
  return within(layer).queryByRole('button', { name: TRIGGER });
}

/** Opens a layer's actions menu; the menu is portalled, so its items are
    read from `screen`. */
export async function openLayerActions(layer: HTMLElement): Promise<void> {
  const trigger = within(layer).getByRole('button', { name: TRIGGER });
  if (trigger.getAttribute('aria-expanded') !== 'true')
    await userEvent.click(trigger);
  await screen.findAllByRole('menuitem');
}

/** Closes an open actions menu by clicking its trigger again. */
export async function closeLayerActions(layer: HTMLElement): Promise<void> {
  const trigger = within(layer).getByRole('button', { name: TRIGGER });
  if (trigger.getAttribute('aria-expanded') === 'true')
    await userEvent.click(trigger);
  await waitFor(() =>
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  );
}

/** Every item name in every actions menu under `container`, each menu
    opened and closed in turn. */
export async function allLayerActionNames(
  container: HTMLElement = document.body
): Promise<string[]> {
  const names: string[] = [];
  for (const trigger of within(container).queryAllByRole('button', {
    name: TRIGGER,
  })) {
    await userEvent.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    names.push(
      ...items.map(i => i.getAttribute('aria-label') ?? i.textContent ?? '')
    );
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    );
  }
  return names;
}

/** Opens a layer's actions menu and finds one of its items. */
export async function layerAction(
  layer: HTMLElement,
  name: string | RegExp
): Promise<HTMLElement> {
  await openLayerActions(layer);
  return screen.findByRole('menuitem', { name });
}

/** Opens a layer's actions menu and clicks one of its items. */
export async function clickLayerAction(
  layer: HTMLElement,
  name: string | RegExp
): Promise<void> {
  await userEvent.click(await layerAction(layer, name));
}

/** The actions trigger an item's name belongs to: `set <key> at <label>`,
    `cancel editing <key> at <label>` and `remove <key> from <label>` all sit
    in the menu named `actions for <key> at <label>`. */
function triggerNameFor(item: string): string {
  const m =
    /^(?:set|cancel editing) (\S+) at (.+)$/.exec(item) ??
    /^remove (\S+) from (.+)$/.exec(item);
  if (!m) throw new Error(`no layer action is named "${item}"`);
  return `actions for ${m[1]} at ${m[2]}`;
}

/** Opens the menu holding the item named `item`, wherever it is on the
    page, and finds that item. */
export async function namedLayerAction(item: string): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', {
    name: triggerNameFor(item),
  });
  if (trigger.getAttribute('aria-expanded') !== 'true')
    await userEvent.click(trigger);
  return screen.findByRole('menuitem', { name: item });
}

/** Clicks the layer action named `item`, wherever it is on the page. */
export async function clickNamedLayerAction(item: string): Promise<void> {
  await userEvent.click(await namedLayerAction(item));
}
