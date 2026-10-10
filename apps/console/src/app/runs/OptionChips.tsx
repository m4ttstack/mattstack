import { Badge, Group, Kbd } from '@mattstack/app-kit/core';

import type { OptionView } from './derive/gates';

/** A question's options as read-only chips: the number key that picks each
    in the gate panel, its label, and the recommended one washed in the
    accent with a small filled marker. */
export function OptionChips({ options }: { options: OptionView[] }) {
  return (
    <Group gap={8}>
      {options.map((o, i) => (
        <Badge
          key={o.value}
          size="lg"
          variant={o.recommended ? 'light' : 'default'}
          color={o.recommended ? 'accent' : undefined}
          tt="none"
          leftSection={
            i < 9 ? (
              <Kbd size="xxs" data-parity="kbd">
                <span data-parity="k">{i + 1}</span>
              </Kbd>
            ) : undefined
          }
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
