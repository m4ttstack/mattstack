import { useEffect, useRef } from 'react';
import { SegmentedControl } from '@mattstack/app-kit/core';

export type EditMode = 'form' | 'json';

// A switch unmounts the toggle that was used and mounts the other editor's
// toggle, so the choice is handed across and the new one takes focus. It
// expires, since a switch inside one editor remounts nothing to consume it.
const REFOCUS_WINDOW_MS = 500;
let switchedAt = -Infinity;

/** The Form | JSON switch every expanded composite row carries in the same
    spot, whichever editor is behind the Form side. */
export function ModeToggle({
  value,
  onChange,
  formDisabled = false,
}: {
  value: EditMode;
  onChange: (mode: EditMode) => void;
  formDisabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (performance.now() - switchedAt > REFOCUS_WINDOW_MS) return;
    switchedAt = -Infinity;
    root.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);
  return (
    <SegmentedControl
      ref={root}
      size="sm"
      aria-label="Edit mode"
      value={value}
      onChange={v => {
        switchedAt = performance.now();
        onChange(v === 'json' ? 'json' : 'form');
      }}
      data={[
        { value: 'form', label: 'Form', disabled: formDisabled },
        { value: 'json', label: 'JSON' },
      ]}
    />
  );
}
