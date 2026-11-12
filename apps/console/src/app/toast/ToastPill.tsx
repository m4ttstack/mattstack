import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Transition,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './ToastPill.module.css';

/** How long the pill stays up untouched. */
const SHOWN_MS = 8_000;

/**
 * Shows a pill once per `signature`, remembered under `storageKey`, so a
 * badge elsewhere carries the state after it. `ready` holds it back until
 * the page has drawn; it hides after a while unless hovered.
 */
export function useToastOnce({
  storageKey,
  signature,
  ready = true,
}: {
  storageKey: string;
  signature: string | null;
  ready?: boolean;
}) {
  const [seen, setSeen] = useLocalStorage<string>({
    key: storageKey,
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

  return { visible, hide: () => setVisible(false), setHovered };
}

/** The dark notification pill over the top right of a page: a warn dot, a
    title, grey meta, a Review chip and a dismiss button. */
export function ToastPill({
  mounted,
  title,
  meta,
  onReview,
  onDismiss,
  onHoverChange,
  testId,
  top,
}: {
  mounted: boolean;
  title: ReactNode;
  meta?: ReactNode;
  onReview: () => void;
  onDismiss: () => void;
  onHoverChange: (hovered: boolean) => void;
  testId: string;
  /** Distance from the page's top edge, to clear a title row the pill
      would otherwise cover. */
  top?: number;
}) {
  // The data behind the pill can empty as it hides; the fade keeps the
  // last words it showed.
  const shown = useRef({ title, meta });
  if (mounted) shown.current = { title, meta };

  return (
    <Transition mounted={mounted} transition="fade-down" duration={180}>
      {style => (
        <div
          className={classes.toast}
          style={top === undefined ? style : { ...style, top }}
          role="status"
          onMouseEnter={() => onHoverChange(true)}
          onMouseLeave={() => onHoverChange(false)}
          data-testid={testId}
        >
          <UnstyledButton className={classes.main} onClick={onReview}>
            <span className={classes.dot} aria-hidden />
            <span className={classes.title}>{shown.current.title}</span>
            {shown.current.meta ? (
              <span className={classes.meta}>{shown.current.meta}</span>
            ) : null}
            <span className={classes.review}>
              Review
              <Icon name="chevronRight" size={12} />
            </span>
          </UnstyledButton>
          <ActionIcon
            variant="transparent"
            size="sm"
            radius="xl"
            className={classes.close}
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <Icon name="close" size={12} />
          </ActionIcon>
        </div>
      )}
    </Transition>
  );
}
