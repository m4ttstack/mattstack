import type { ReactNode } from 'react';
import { Badge, Group } from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';
import type { RunOutcome } from '@mattstack/rt-client';

import { postedLabel } from '../derive/record';

interface Pill {
  id: string;
  /** The board layer: `primary` for how the run ended, `ci` for its CI. */
  layer: 'primary' | 'ci';
  color: MantineColor;
  icon: IconName;
  label: string;
  /** The review board names its pill's icon and label `i` and `l`. */
  layers?: { icon: string; label: string };
}

/** The boards name an icon layer after its lucide glyph. */
const GLYPH: Partial<Record<IconName, string>> = {
  gitMerge: 'git-merge',
  circleCheck: 'circle-check',
  circleX: 'circle-x',
  circleSlash: 'circle-slash',
  messageSquare: 'message-square',
};

/** Only a pill about the run's own MR carries its CI. */
const MR_PILLS = new Set(['merged', 'open', 'closed']);

function ciPill(ci: string | null | undefined): Pill | null {
  const base = { layer: 'ci' } as const;
  if (ci === 'success' || ci === 'passed') {
    return {
      ...base,
      id: 'ci-passed',
      color: 'ok',
      icon: 'circleCheck',
      label: 'CI passed',
    };
  }
  if (ci === 'failed') {
    return {
      ...base,
      id: 'ci-failed',
      color: 'bad',
      icon: 'circleX',
      label: 'CI failed',
    };
  }
  return null;
}

const REVIEW_POSTS: {
  match: RegExp;
  color: MantineColor;
  icon: IconName;
  label: (iid: number) => string;
}[] = [
  {
    match: /request/i,
    color: 'warn',
    icon: 'messageSquareDiff',
    label: iid => `Requested changes on !${iid}`,
  },
  {
    match: /approv/i,
    color: 'ok',
    icon: 'circleCheck',
    label: iid => `Approved !${iid}`,
  },
  {
    match: /comment/i,
    color: 'accent',
    icon: 'messageSquare',
    label: iid => `Commented on !${iid}`,
  },
];

/** What a review posted on the MR: "Requested changes on !412", "Approved
    !406", "Commented on !399"; a disposition it does not know reads as it
    was posted. */
function reviewedPill({
  iid,
  posted,
}: NonNullable<RunOutcome['reviewed']>): Pill {
  const post = posted ? REVIEW_POSTS.find(p => p.match.test(posted)) : null;
  return {
    layer: 'primary',
    id: 'reviewed',
    layers: { icon: 'i', label: 'l' },
    ...(post
      ? { color: post.color, icon: post.icon, label: post.label(iid) }
      : {
          color: 'accent',
          icon: 'messageSquare',
          label: posted
            ? `Reviewed !${iid} · ${postedLabel(posted)}`
            : `Reviewed !${iid}`,
        }),
  };
}

function primaryPill(outcome: RunOutcome): Pill | null {
  const base = { layer: 'primary' } as const;
  if (outcome.status === 'abandoned') {
    return {
      ...base,
      id: 'abandoned',
      color: 'gray',
      icon: 'circleSlash',
      label: 'abandoned',
    };
  }
  if (outcome.status === 'failed') {
    return {
      ...base,
      id: 'failed',
      color: 'bad',
      icon: 'circleX',
      label: 'failed',
    };
  }
  if (outcome.status !== 'done') return null;
  if (outcome.reviewed) return reviewedPill(outcome.reviewed);
  const mr = outcome.mr;
  if (!mr || mr.state === 'unknown') return null;
  if (mr.state === 'merged') {
    return {
      ...base,
      id: 'merged',
      color: 'ok',
      icon: 'gitMerge',
      label: `merged !${mr.iid}`,
    };
  }
  return {
    ...base,
    id: mr.state === 'opened' ? 'open' : 'closed',
    color: mr.state === 'opened' ? 'accent' : 'gray',
    icon: 'gitMerge',
    label: `!${mr.iid} ${mr.state === 'opened' ? 'open' : 'closed'}`,
  };
}

function badge({ id, layer, color, icon, label, layers }: Pill): ReactNode {
  return (
    <Badge
      key={id}
      size="lg"
      variant="light"
      color={color}
      tt="none"
      data-outcome={id}
      data-parity={layer}
      leftSection={
        <Icon name={icon} size={13} data-parity={layers?.icon ?? GLYPH[icon]} />
      }
    >
      <span data-parity={layers?.label ?? 'label'}>{label}</span>
    </Badge>
  );
}

/** How a finished run ended: the MR it merged and its CI, a review it posted,
    or abandoned and failed. A run still running, one with no MR, and an MR in
    an `unknown` state draw nothing, since the forge has not answered yet. */
export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  const primary = primaryPill(outcome);
  if (!primary) return null;
  const ci = MR_PILLS.has(primary.id) ? ciPill(outcome.ci) : null;
  return (
    <Group gap={8} wrap="nowrap">
      {badge(primary)}
      {ci ? badge(ci) : null}
    </Group>
  );
}
