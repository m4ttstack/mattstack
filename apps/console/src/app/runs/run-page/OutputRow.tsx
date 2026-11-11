import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Accordion, Text, UnstyledButton } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import { fieldLabel } from '../derive/fields';
import { FieldStrip, isStripField } from './FieldStrip';
import { FieldValue } from './FieldValue';
import classes from './OutputRow.module.css';

/** One labelled line of the Now card, drawn like a gate record's row: the
    value shows its first two lines, and a chevron opens the rest in place
    when there is more. The value carries the `v` layer. */
export function OutputRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const valueRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el || open) return;
    const measure = () => {
      const clamp = el.querySelector('p');
      setClipped(!!clamp && clamp.scrollHeight > clamp.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  const toggles = clipped || open;
  return (
    <div
      className={classes.row}
      data-row={label}
      data-open={open || undefined}
      data-toggles={toggles || undefined}
      onClick={e => {
        if (!toggles || (e.target as HTMLElement).closest('a, button')) return;
        setOpen(o => !o);
      }}
    >
      <Text
        fz="md"
        lh="normal"
        c="dimmed"
        className={classes.label}
        data-parity={label}
      >
        {label}
      </Text>
      <div ref={valueRef} className={classes.value}>
        {children}
      </div>
      {toggles ? (
        <UnstyledButton
          className={classes.toggle}
          aria-expanded={open}
          aria-label={open ? `Show less of ${label}` : `Show all of ${label}`}
          onClick={() => setOpen(o => !o)}
        >
          <Accordion.Chevron
            size={16}
            className={classes.chevron}
            data-open={open || undefined}
          />
        </UnstyledButton>
      ) : null}
    </div>
  );
}

export function FieldRows({
  fields,
  pathHref,
}: {
  fields: RunFieldRow[];
  pathHref?: (path: string) => string | null;
}) {
  return (
    <>
      <FieldStrip fields={fields.filter(isStripField)} />
      {fields
        .filter(f => !isStripField(f))
        .map(f => (
          <OutputRow key={f.key} label={fieldLabel(f.key)}>
            <FieldValue
              fieldKey={f.key}
              value={f.value}
              pathHref={pathHref}
              data-parity="v"
            />
          </OutputRow>
        ))}
    </>
  );
}
