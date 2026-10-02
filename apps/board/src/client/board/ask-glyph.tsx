import { cloneElement, type ReactElement } from 'react';

import { Icon, ICONS } from '@mattstack/tui-kit';

/** The sent-ask band's glyphs: the kit's own where it has them, the rest
    drawn through the kit's `Icon` from lucide-react 1.34.0 path data (ISC
    licensed, https://lucide.dev), subpaths joined with explicit moves the way
    the kit's own set does. */
const KIT_GLYPH = new Set(['triangle-alert', 'circle-check']);

const ASK_PATHS: Record<string, string> = {
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
  send: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zM21.854 2.147L10.914 13.086',
  check: 'M20 6L9 17l-5-5',
  ban: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M4.9 4.9L19.1 19.1',
  hourglass:
    'M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
  'chevron-down': 'M6 9l6 6 6-6',
};

export function AskGlyph({ name, size = 13 }: { name: string; size?: number }) {
  if (KIT_GLYPH.has(name))
    return cloneElement(
      ICONS[name] as ReactElement<{ width: number; height: number }>,
      { width: size, height: size }
    );
  return <Icon d={ASK_PATHS[name] ?? ''} width={size} height={size} />;
}
