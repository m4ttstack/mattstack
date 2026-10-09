import { Paper, Skeleton, Stack } from '@mattstack/app-kit/core';

import hero from './RunHeader.module.css';
import page from './RunPage.module.css';
import side from './SideCards.module.css';

function CardSkeleton({ lines }: { lines: string[] }) {
  return (
    <Paper variant="ground" withBorder radius={12} className={side.card}>
      <Stack gap={10}>
        {lines.map((w, i) => (
          <Skeleton key={i} h={i === 0 ? 14 : 10} w={w} radius="sm" />
        ))}
      </Stack>
    </Paper>
  );
}

/** The run page's shape while its run loads: the hero with its rail, the
    story column and the side card. */
export function RunPageSkeleton() {
  return (
    <Stack gap={20} aria-busy="true" data-testid="run-page-skeleton">
      <Paper variant="ground" withBorder radius={12} className={hero.hero}>
        <Stack gap={18}>
          <Stack gap={10}>
            <Skeleton h={12} w={260} radius="sm" />
            <Skeleton h={22} w="40%" radius="sm" />
          </Stack>
          <Skeleton h={28} radius="md" />
        </Stack>
      </Paper>
      <div className={page.columns}>
        <Stack gap={14} className={page.story}>
          <CardSkeleton lines={['30%', '90%', '75%']} />
          <CardSkeleton lines={['20%', '85%', '60%', '70%']} />
        </Stack>
        <div className={side.side}>
          <CardSkeleton lines={['40%', '80%', '65%', '70%']} />
        </div>
      </div>
    </Stack>
  );
}
