import { Badge, Button } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

export type FreshnessTone = 'ok' | 'accent' | 'warn';

export interface Freshness {
  label: string;
  tone: FreshnessTone;
}

export function syncedLabel(generatedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(generatedAt)) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${Math.floor(hours / 24)} d ago`;
}

/** The parity runner drives a refresh through `Refresh Button` and reads the clock off `Fresh Label`. */
export function HeaderStatus({
  scope,
  freshness,
  action,
  onAction,
}: {
  scope: string | null;
  freshness: Freshness | null;
  action: 'refresh' | 'cancel';
  onAction: () => void;
}) {
  return (
    <>
      {freshness !== null && (
        <Badge variant="dot" color={freshness.tone} data-parity="Fresh Label">
          {freshness.label}
        </Badge>
      )}
      {scope !== null && (
        <Badge
          variant="default"
          leftSection={<Icon name="gitBranch" size={12} />}
        >
          {scope}
        </Badge>
      )}
      <Button
        variant="default"
        size="xs"
        data-parity="Refresh Button"
        onClick={onAction}
        leftSection={
          <Icon name={action === 'refresh' ? 'refresh' : 'close'} size={14} />
        }
      >
        {action === 'refresh' ? 'Refresh' : 'Cancel'}
      </Button>
    </>
  );
}
