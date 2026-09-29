import { useState } from 'react';

import {
  Button,
  Center,
  DatePicker,
  Group,
  Popover,
  SegmentedControl,
  Stack,
  VisuallyHidden,
  type DatesRangeValue,
} from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';
import classes from './shell.module.css';

export type ViewMode = 'table' | 'cards';

export interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

const PRESETS = ['7d', '30d', '90d'];

const SEGMENTED = { size: 'sm' } as const;

const ICON_LAYERS: Partial<Record<IconName, string>> = {
  table2: 'table-2',
  layoutGrid: 'layout-grid',
};

function iconLayer(icon: IconName): string {
  return ICON_LAYERS[icon] ?? icon;
}

function textLabel(text: string, parity = text) {
  return <span data-parity={parity}>{text}</span>;
}

function iconLabel(icon: IconName, name: string) {
  return (
    <>
      <Center data-parity={`icon:${iconLayer(icon)}`}>
        <Icon name={icon} size={16} strokeWidth={1.75} />
      </Center>
      <VisuallyHidden>{name}</VisuallyHidden>
    </>
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function customRangeLabel(range: RangeState): string {
  if (range.range !== 'custom' || !range.start || !range.end) return 'Custom';
  const from = DAY_FORMAT.format(new Date(range.start));
  const to = DAY_FORMAT.format(new Date(range.end));
  return `${from} \u2013 ${to}`;
}

const toDay = (iso: string | undefined): string | null =>
  iso ? iso.slice(0, 10) : null;

function RangeControl({
  range,
  onRange,
}: {
  range: RangeState;
  onRange: (range: string, start?: string, end?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DatesRangeValue<string>>([null, null]);
  const openCustom = () => {
    setDraft([toDay(range.start), toDay(range.end)]);
    setOpen(true);
  };
  const reopenCustom = (target: EventTarget) => {
    const isCustom =
      target instanceof HTMLInputElement && target.value === 'custom';
    if (!isCustom || range.range !== 'custom' || open) return false;
    openCustom();
    return true;
  };
  const [from, to] = draft;
  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      transitionProps={{ transition: 'pop-top-right' }}
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <SegmentedControl
          {...SEGMENTED}
          aria-label="Range"
          data-parity="Range"
          value={open ? 'custom' : range.range}
          onClick={e => reopenCustom(e.target)}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (reopenCustom(e.target)) e.preventDefault();
          }}
          onChange={v => {
            if (v === 'custom') openCustom();
            else onRange(v);
          }}
          data={[
            ...PRESETS.map(p => ({ value: p, label: textLabel(p) })),
            {
              value: 'custom',
              label: textLabel(customRangeLabel(range), 'Custom'),
            },
          ]}
        />
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <DatePicker
            type="range"
            value={draft}
            onChange={setDraft}
            defaultDate={from ?? undefined}
            maxDate={new Date()}
          />
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={!from || !to}
              onClick={() => {
                onRange(
                  'custom',
                  new Date(from!).toISOString(),
                  new Date(to!).toISOString()
                );
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function PageHeader({
  title,
  subtitle,
  range,
  onRange,
  trend,
  onTrend,
  view,
  onView,
}: {
  title: string;
  subtitle: string | null;
  range: RangeState;
  onRange: (range: string, start?: string, end?: string) => void;
  trend: boolean;
  onTrend: (v: boolean) => void;
  view?: ViewMode;
  onView?: (v: ViewMode) => void;
}) {
  return (
    <div className={classes.pageHeader} data-parity="Page Header">
      <div className={classes.titleBlock}>
        <h1 className={classes.title} data-parity="Title">
          {title}
        </h1>
        {subtitle !== null && (
          <span className={classes.subtitle} data-parity="Subtitle">
            {subtitle}
          </span>
        )}
      </div>
      <div className={classes.controls}>
        <RangeControl range={range} onRange={onRange} />
        <SegmentedControl
          {...SEGMENTED}
          aria-label="Mode"
          data-parity="Mode"
          value={trend ? 'trend' : 'values'}
          onChange={v => onTrend(v === 'trend')}
          data={[
            { value: 'values', label: textLabel('Values') },
            { value: 'trend', label: textLabel('Trend') },
          ]}
        />
        {view !== undefined && onView !== undefined && (
          <SegmentedControl
            {...SEGMENTED}
            aria-label="View"
            data-parity="View"
            value={view}
            onChange={v => onView(v as ViewMode)}
            data={[
              { value: 'table', label: iconLabel('table2', 'Table view') },
              { value: 'cards', label: iconLabel('layoutGrid', 'Cards view') },
            ]}
          />
        )}
      </div>
    </div>
  );
}
