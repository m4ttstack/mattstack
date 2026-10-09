import { useOptimistic, useTransition } from 'react';

import { Switch, Tooltip } from '@mattstack/tui-kit';

/** Optimistic boolean for a Switch backed by a server mutation: the shown
    value flips the moment the user clicks, and the canonical value takes
    over when the action settles. `mutate` must end by refreshing board
    state (every useBoardState mutation does), so the canonical value is
    already correct at settle time and the hand-off is invisible; a failed
    mutation leaves canonical state unchanged and the switch snaps back. */
export function useOptimisticToggle(
  actual: boolean,
  mutate: () => Promise<void>
): [boolean, () => void] {
  const [shown, setShown] = useOptimistic(actual);
  const [, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      setShown(!actual);
      await mutate();
    });
  return [shown, toggle];
}

/** The Switch for the table cell and the settings modal, on the same
    optimistic mechanism. `disabled` with a `disabledTip` wraps only the Switch in the tooltip, so
    the reason shows on the control that refuses the click. */
export function OptimisticSwitch({
  checked,
  mutate,
  disabled,
  disabledTip,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  mutate: () => Promise<void>;
  disabled?: boolean;
  disabledTip?: string;
  'aria-label': string;
}) {
  const [shown, toggle] = useOptimisticToggle(checked, mutate);
  const control = (
    <Switch
      checked={shown}
      onChange={disabled ? () => {} : toggle}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
  return disabled && disabledTip ? (
    <Tooltip tip={disabledTip}>{control}</Tooltip>
  ) : (
    control
  );
}
