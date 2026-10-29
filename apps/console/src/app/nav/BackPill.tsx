import { Button } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';

/** One step up to a named place: the app bar's way home, Settings' way back
    to your own team, the sidebar's way back to every skill. A page that
    shows a Trail never shows one too. */
export function BackPill({
  label,
  href,
  onClick,
  ariaLabel,
  testId,
}: {
  label: string;
  /** A link when the place has its own address; otherwise `onClick`. */
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  testId?: string;
}) {
  const props = {
    size: 'compact-sm',
    radius: 'xl',
    variant: 'default',
    leftSection: <Icon name="chevronLeft" size={14} />,
    'aria-label': ariaLabel,
    'data-testid': testId,
    style: { alignSelf: 'flex-start', flex: 'none' },
  } as const;
  return href ? (
    <Button component={Link} href={href} {...props}>
      {label}
    </Button>
  ) : (
    <Button onClick={onClick} {...props}>
      {label}
    </Button>
  );
}
