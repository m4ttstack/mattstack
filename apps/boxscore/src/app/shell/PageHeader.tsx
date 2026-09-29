import { useState, type ReactNode } from 'react';

import { Button, Group, Popover, TextInput } from '@mattstack/app-kit/core';
import type { IconName } from '@mattstack/app-kit/icons';
import { Glyph } from '../ui/Glyph';
import classes from './shell.module.css';

export type ViewMode = 'table' | 'cards';

export interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

interface Option<T extends string> {
  value: T;
  label?: string;
  icon?: IconName;
  /** Accessible name when the option shows only an icon. */
  aria?: string;
  /** Keeps the card fill while inactive, without the active shadow. */
  raised?: boolean;
}

function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  render,
}: {
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  render?: (o: Option<T>, button: ReactNode) => ReactNode;
}) {
  return (
    <div className={classes.segmented} data-parity={name} role="group">
      {options.map(o => {
        const active = o.value === value;
        const layer = o.label ?? `icon:${iconLayer(o.icon!)}`;
        const colour = active ? 'var(--tk-text-1)' : 'var(--tk-text-3)';
        const button = (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.aria}
            className={`${classes.segment} ${active ? classes.segmentActive : o.raised ? classes.segmentRaised : ''}`}
            data-parity={active || o.raised ? layer : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label !== undefined ? (
              <span
                className={classes.segmentLabel}
                data-parity={layer}
                style={{ color: colour }}
              >
                {o.label}
              </span>
            ) : (
              <Glyph name={o.icon!} size={15} color={colour} parity={layer} />
            )}
          </button>
        );
        return render ? render(o, button) : button;
      })}
    </div>
  );
}

const ICON_LAYERS: Partial<Record<IconName, string>> = {
  table2: 'table-2',
  layoutGrid: 'layout-grid',
};

function iconLayer(icon: IconName): string {
  return ICON_LAYERS[icon] ?? icon;
}

const toDateInput = (iso: string | undefined): string =>
  iso ? iso.slice(0, 10) : '';

function CustomRange({
  range,
  onRange,
  button,
}: {
  range: RangeState;
  onRange: (range: string, start?: string, end?: string) => void;
  button: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => toDateInput(range.start));
  const [end, setEnd] = useState(() => toDateInput(range.end));
  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-end"
      withArrow
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <span
          className={classes.popoverTarget}
          onClick={() => setOpen(o => !o)}
        >
          {button}
        </span>
      </Popover.Target>
      <Popover.Dropdown>
        <Group gap="sm" align="flex-end" wrap="nowrap">
          <TextInput
            label="Start"
            type="date"
            size="xs"
            value={start}
            onTextChange={setStart}
          />
          <TextInput
            label="End"
            type="date"
            size="xs"
            value={end}
            onTextChange={setEnd}
          />
          <Button
            size="xs"
            disabled={!start || !end}
            onClick={() => {
              onRange(
                'custom',
                new Date(start).toISOString(),
                new Date(end).toISOString()
              );
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </Group>
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
    <div className={classes.pageHeader}>
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
        <Segmented
          name="Range"
          value={range.range}
          options={[
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={v => {
            if (v !== 'custom') onRange(v);
          }}
          render={(o, button) =>
            o.value === 'custom' ? (
              <CustomRange
                key="custom"
                range={range}
                onRange={onRange}
                button={button}
              />
            ) : (
              button
            )
          }
        />
        <Segmented
          name="Mode"
          value={trend ? 'trend' : 'values'}
          options={[
            { value: 'values', label: 'Values', raised: true },
            { value: 'trend', label: 'Trend' },
          ]}
          onChange={v => onTrend(v === 'trend')}
        />
        {view !== undefined && onView !== undefined && (
          <Segmented
            name="View"
            value={view}
            options={[
              {
                value: 'table',
                icon: 'table2',
                aria: 'Table view',
                raised: true,
              },
              { value: 'cards', icon: 'layoutGrid', aria: 'Cards view' },
            ]}
            onChange={onView}
          />
        )}
      </div>
    </div>
  );
}
