import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HeatCalendar, type HeatCalendarDay } from './HeatCalendar';

const meta: Meta<typeof HeatCalendar> = {
  title: 'Core/HeatCalendar',
  component: HeatCalendar,
};
export default meta;

const LEVELS = [0, 1, 3, 2, 0, 0, 1, 2, 3, 3, 1, 0, 0, 0] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Two weeks from Sun Sep 27 2026, the period Wed Sep 30 to Fri Oct 9. */
const weeks: HeatCalendarDay[][] = [0, 1].map(w =>
  Array.from({ length: 7 }, (_, d) => {
    const i = w * 7 + d;
    return {
      date: iso(new Date(Date.UTC(2026, 8, 27 + i))),
      level: LEVELS[i]!,
      count: LEVELS[i]! * 3,
      inWindow: i >= 3 && i <= 12,
    };
  })
);

export const Default: StoryObj<typeof HeatCalendar> = {
  args: { weeks },
};

export const Pickable: StoryObj<typeof HeatCalendar> = {
  render: () => {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <HeatCalendar
        weeks={weeks}
        hue="accent"
        selected={selected}
        onPick={setSelected}
      />
    );
  },
};
