import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { GateBoards } from './GateBoards';

/** Storybook serves the design fixture's own pictures in place of the gate's
    board route, so no gate or fixture server is needed. A URL rather than an
    import: the server wall is for code, and these never ship. */
const fixture = (name: string): string =>
  new URL(
    `../../../server/fixtures/design/files/evidence/web-421/${name}`,
    import.meta.url
  ).href;

const DIR = '/Users/acme/.fast-browser/screenshots/web-421';

const SRC: Record<string, string> = {
  [`${DIR}/rush-before.png`]: fixture('rush-before-annotated.png'),
  [`${DIR}/rush-after.png`]: fixture('rush-after-annotated.png'),
  [`${DIR}/card-after-light.png`]: fixture('card-after-light-annotated.png'),
  [`${DIR}/card-after-dark.png`]: fixture('card-after-dark.png'),
};

const meta = {
  title: 'Runs/Run page/Gate boards',
  component: GateBoards,
  parameters: { layout: 'padded' },
  args: {
    gateId: 'g-boards',
    srcOf: path => SRC[path] ?? path,
    boards: {
      summary: 'Four boards are about to be attached to !424.',
      boards: [
        {
          case: 'rush-window',
          slot: 'before',
          path: `${DIR}/rush-before.png`,
          caption: 'The order card shows no delivery window',
        },
        {
          case: 'rush-window',
          slot: 'after',
          path: `${DIR}/rush-after.png`,
          caption: '"Today, 2–4 PM" now sits under the total',
        },
        {
          case: 'order-card',
          slot: 'after',
          theme: 'light',
          path: `${DIR}/card-after-light.png`,
          caption: 'The window keeps its contrast on the card',
        },
        {
          case: 'order-card',
          slot: 'after',
          theme: 'dark',
          path: `${DIR}/card-after-dark.png`,
          caption: 'Same marks as light; only the theme differs',
        },
      ],
    },
  },
} satisfies Meta<typeof GateBoards>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Thumbnails: Story = {};

/** Opened on the second board; the arrow keys page through all four. */
export const OpenFullSize: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', {
        name: 'Open rush-window/after full size',
      })
    );
  },
};

export const OneBoard: Story = {
  args: {
    boards: {
      boards: [
        {
          case: 'rush-window',
          slot: 'after',
          path: `${DIR}/rush-after.png`,
          caption: '"Today, 2–4 PM" now sits under the total',
        },
      ],
    },
  },
  play: OpenFullSize.play,
};
