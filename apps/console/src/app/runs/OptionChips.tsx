import { Badge, Group } from '@mattstack/app-kit/core';

import type { OptionView } from './derive/gates';

/** A question's options as read-only chips: each label, and the recommended
    one washed in the accent with a small filled marker. No number keys: these
    surfaces answer nothing, so a key badge would promise a shortcut. */
export function OptionChips({ options }: { options: OptionView[] }) {
  return (
    <Group gap={8}>
      {options.map(o => (
        <Badge
          key={o.value}
          size="lg"
          variant={o.recommended ? 'light' : 'default'}
          color={o.recommended ? 'accent' : undefined}
          tt="none"
          rightSection={
            o.recommended ? (
              <Badge
                size="sm"
                variant="filled"
                color="accent"
                tt="none"
                data-parity="rec"
              >
                <span data-parity="r">recommended</span>
              </Badge>
            ) : undefined
          }
          data-option={o.value}
          data-parity={`opt ${o.text}`}
        >
          <span data-parity="l">{o.text}</span>
        </Badge>
      ))}
    </Group>
  );
}
