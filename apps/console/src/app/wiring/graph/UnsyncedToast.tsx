import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Transition,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './graph.module.css';
import { useUnsyncedSummary } from './UnsyncedBanner';

/** How long the pill stays up untouched. */
const SHOWN_MS = 8_000;

/**
 * The pack's unsynced changes as one notification over the page: shown once
 * per change list, never again until the list changes, so the History tab's
 * badge carries the state after it. Clicking it opens that list in History.
 */
export function UnsyncedToast({
  pack,
  ready,
  onReview,
}: {
  pack: string;
  /** The page has drawn its content, so the pill never arrives ahead of it. */
  ready: boolean;
  onReview: () => void;
}) {
  const summary = useUnsyncedSummary(pack);
  const signature = summary?.signature ?? null;
  const [seen, setSeen] = useLocalStorage<string>({
    key: `console-unsynced-seen-${pack}`,
    defaultValue: '',
  });
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!ready || signature === null || seen === signature) return;
    setSeen(signature);
    setVisible(true);
  }, [ready, signature, seen, setSeen]);

  useEffect(() => {
    if (!visible || hovered) return;
    const timer = setTimeout(() => setVisible(false), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [visible, hovered]);

  return (
    <Transition
      mounted={visible && summary !== null}
      transition="fade-down"
      duration={180}
    >
      {style => (
        <div
          className={classes.toast}
          style={style}
          role="status"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          data-testid="unsynced-toast"
        >
          <UnstyledButton
            className={classes.toastMain}
            onClick={() => {
              setVisible(false);
              onReview();
            }}
          >
            <span className={classes.toastDot} aria-hidden />
            <span className={classes.toastTitle}>
              {summary?.count} {summary?.count === 1 ? 'change' : 'changes'} not
              synced
            </span>
            <span className={classes.toastMeta}>
              {summary?.trial ? `${pack} · ${summary.trial}` : pack}
            </span>
            <span className={classes.toastReview}>
              Review
              <Icon name="chevronRight" size={12} />
            </span>
          </UnstyledButton>
          <ActionIcon
            variant="transparent"
            size="sm"
            radius="xl"
            className={classes.toastClose}
            aria-label="Dismiss"
            onClick={() => setVisible(false)}
          >
            <Icon name="close" size={12} />
          </ActionIcon>
        </div>
      )}
    </Transition>
  );
}
