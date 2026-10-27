import type { ReactNode } from 'react';
import { notifications as mantineNotifications } from '@mantine/notifications';
import type { NotificationData } from '@mantine/notifications';

import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';
import { TimedRingProgress } from './TimedRingProgress';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export type ShowNotificationProps = Omit<NotificationData, 'message'> & {
  /** Picks the color + icon defaults. @default 'info' */
  type?: NotificationType;
  message?: ReactNode;
  /**
   * Turns the icon into a countdown ring of this length (ms) that dismisses
   * the notification when it completes. Sets `autoClose: false` (the ring
   * owns the timing).
   */
  countdown?: number;
};

const ICON_SIZE = 13;
/** Heavier than the registry's default, so the mark holds on the dark card. */
const ICON_STROKE = 2.75;

// Per-type icon (registry name) and color:
//  - success -> check / green
//  - error   -> close (an "x") / red
//  - warning -> warning (triangle) / orange
//  - info    -> info / blue
const TYPE_ICON_NAME: Record<NotificationType, IconName> = {
  success: 'check',
  error: 'close',
  warning: 'warning',
  info: 'info',
};

const TYPE_COLOR: Record<NotificationType, string> = {
  success: 'green',
  error: 'red',
  warning: 'orange',
  info: 'blue',
};

// Thin typed wrapper over @mantine/notifications' `notifications.show`: a
// `type` picks the color/icon defaults above. `autoClose` follows
// Mantine's provider default unless overridden (or unless `countdown` is
// set, which forces the ring to own the timing). `color`/`icon` can still
// be overridden per call.
/** The icon's colour on the dark card: a palette name takes its bright
    step, `name.N` that shade, and any other CSS colour stands as given. */
function brightOf(color: string): string {
  if (/^[a-z][a-z0-9-]*$/i.test(color))
    return `var(--mantine-color-${color}-4)`;
  const shade = /^([a-z][a-z0-9-]*)\.(\d)$/i.exec(color);
  if (shade) return `var(--mantine-color-${shade[1]}-${shade[2]})`;
  return color;
}

function show(props: ShowNotificationProps) {
  const {
    type = 'info',
    color,
    icon,
    countdown,
    autoClose,
    message = '',
    id,
    ...rest
  } = props;

  // Stable id so the countdown ring can hide this exact notification.
  const notificationId = id ?? `notification-${notificationCounter++}`;
  const resolvedColor = color ?? TYPE_COLOR[type];
  const baseIcon = icon ?? (
    <Icon
      name={TYPE_ICON_NAME[type]}
      size={ICON_SIZE}
      strokeWidth={ICON_STROKE}
      // The card is dark in both schemes, so the mark takes the hue's bright
      // step rather than its filled one.
      color={brightOf(resolvedColor)}
      // A triangle's weight sits low in its box; lift it to the optical
      // centre of the disc.
      style={type === 'warning' ? { marginTop: -1.5 } : undefined}
    />
  );

  return mantineNotifications.show({
    ...rest,
    id: notificationId,
    message,
    color: resolvedColor,
    autoClose: countdown ? false : autoClose,
    icon: countdown ? (
      <TimedRingProgress
        duration={countdown}
        color={resolvedColor}
        icon={baseIcon}
        onFinish={() => mantineNotifications.hide(notificationId)}
      />
    ) : (
      baseIcon
    ),
  });
}

let notificationCounter = 0;

// Each type helper accepts either a plain string (used as the message) or a
// full props object -- `notifications.success('Saved')` and
// `notifications.success({ title: 'Saved', message: '...' })` both work.
type MessageOrProps = string | Omit<ShowNotificationProps, 'type'>;

function normalize(input: MessageOrProps): Omit<ShowNotificationProps, 'type'> {
  return typeof input === 'string' ? { message: input } : input;
}

function typed(typeName: NotificationType) {
  return (input: MessageOrProps) =>
    show({ ...normalize(input), type: typeName });
}

// The kit's notifications facade: same shape as @mantine/notifications' own
// `notifications` object (show/hide/update/clean/...), but `show` is the
// typed wrapper above and `success`/`error`/`warning`/`info` are added as
// per-type shorthands.
export const notifications = {
  ...mantineNotifications,
  show,
  success: typed('success'),
  error: typed('error'),
  warning: typed('warning'),
  info: typed('info'),
};
