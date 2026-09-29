import type { Meta, StoryObj } from '@storybook/react-vite';

import { BarChart, chartDefaults } from '.';

const meta = {
  component: BarChart,
  title: 'Charts/BarChart',
  args: {
    h: 240,
    type: 'stacked',
    tooltipProps: chartDefaults.tooltipProps,
    gridProps: chartDefaults.gridProps,
    textColor: chartDefaults.textColor,
  },
} satisfies Meta<typeof BarChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Histogram: Story = {
  args: {
    dataKey: 'bin',
    data: [
      { bin: '< 0.5h', normal: 0, hi: 0 },
      { bin: '0.5–1h', normal: 0, hi: 33 },
      { bin: '1–2h', normal: 8, hi: 0 },
      { bin: '2–4h', normal: 3, hi: 0 },
    ],
    series: [
      { name: 'normal', color: 'gray' },
      { name: 'hi', color: 'accent' },
    ],
  },
};

export const StackedRows: Story = {
  args: {
    orientation: 'vertical',
    dataKey: 'day',
    data: [
      { day: 'Mon', ok: 6, bad: 1, gray: 2, accent: 3 },
      { day: 'Tue', ok: 4, bad: 0, gray: 3, accent: 5 },
      { day: 'Wed', ok: 7, bad: 2, gray: 1, accent: 2 },
    ],
    series: [
      { name: 'ok', color: 'ok' },
      { name: 'bad', color: 'bad' },
      { name: 'gray', color: 'gray' },
      { name: 'accent', color: 'accent' },
    ],
  },
};
