import { Badge } from '@mattstack/app-kit/core';

/** Marks the signed-in person's own row or profile. */
export function YouBadge() {
  return (
    <Badge size="sm" color="accent" variant="filled" data-parity="You Badge">
      <span data-parity="You">you</span>
    </Badge>
  );
}
