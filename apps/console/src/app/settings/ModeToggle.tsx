import { SegmentedControl } from '@mattstack/app-kit/core';

export type EditMode = 'form' | 'json';

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
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={v => onChange(v === 'json' ? 'json' : 'form')}
      data={[
        { value: 'form', label: 'Form', disabled: formDisabled },
        { value: 'json', label: 'JSON' },
      ]}
    />
  );
}
