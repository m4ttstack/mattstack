import { Badge, Button, Group } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';

/** The dev app's way into a pack no team owns (the mattstack plugin's own
    source). Drawn as a dashed dev-tool toggle, apart from the org and team
    scope, so it never reads as part of the org. Pressing the shown pack
    again goes back to a team (null). */
export function DevPackSwitch({
  packs,
  pack,
  onPick,
}: {
  packs: string[];
  pack: string | null;
  onPick: (pack: string | null) => void;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      {packs.map(name => {
        const on = name === pack;
        return (
          <Button
            key={name}
            size="compact-sm"
            radius="sm"
            variant={on ? 'light' : 'subtle'}
            color={on ? 'accent' : 'gray'}
            style={{ border: '1px dashed currentColor' }}
            leftSection={<Icons.terminal size={14} />}
            rightSection={
              <Badge size="xs" radius="sm" variant="outline" color="gray">
                dev
              </Badge>
            }
            aria-pressed={on}
            aria-label={`dev pack: ${name}`}
            title={
              on
                ? `Back to your team's pack`
                : `Open the ${name} pack (dev app only)`
            }
            onClick={() => onPick(on ? null : name)}
          >
            {name}
          </Button>
        );
      })}
    </Group>
  );
}
