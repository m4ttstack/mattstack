import { UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

export interface NewPillProps {
  /** Live arrivals since the viewer scrolled away; 0 reads as a quiet jump. */
  count: number;
  onClick: () => void;
}

/** The follow control, with the one fact a reader who scrolled up wants: how
    much arrived meanwhile. It takes the bar's colour only when there is news. */
export function NewPill({ count, onClick }: NewPillProps) {
  const news = count > 0;
  return (
    <UnstyledButton
      data-testid="new-pill"
      aria-label={
        news
          ? `${count} new ${count === 1 ? 'message' : 'messages'}, jump to latest`
          : 'Jump to latest'
      }
      onClick={onClick}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 12,
        transform: 'translateX(-50%)',
        zIndex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 14px',
        borderRadius: 16,
        fontSize: 'var(--mantine-font-size-sm)',
        fontWeight: 600,
        color: news ? 'white' : 'var(--tk-text-1)',
        background: news ? 'var(--tk-app-bar)' : 'var(--tk-card)',
        border: news ? 0 : '1px solid var(--tk-border-soft)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
      }}
    >
      <Icon name="arrowDown" size={14} />
      {news ? `${count} new ${count === 1 ? 'message' : 'messages'}` : 'Latest'}
    </UnstyledButton>
  );
}
