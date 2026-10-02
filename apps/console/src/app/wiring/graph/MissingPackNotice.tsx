import { Alert, Text } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';

import classes from './graph.module.css';

/** The URL named a pack this Mac does not have, so the page shows another. */
export function MissingPackNotice({
  asked,
  shown,
}: {
  asked: string;
  shown: string;
}) {
  return (
    <Alert
      variant="tint-outline"
      color="accent"
      radius={0}
      icon={<Icons.info size={16} />}
      classNames={{
        root: classes.banner,
        wrapper: classes.bannerWrapper,
        icon: classes.bannerIcon,
      }}
      data-testid="missing-pack"
    >
      <Text fz={13} fw={500} lh="normal" c="var(--tk-text-1)">
        No pack named {asked}; showing {shown}.
      </Text>
    </Alert>
  );
}
