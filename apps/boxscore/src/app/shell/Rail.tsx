import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { HybridMenu } from '@mattstack/app-kit/core';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import { Link } from '@mattstack/app-kit/router';
import { Glyph } from '../ui/Glyph';
import classes from './shell.module.css';
import { useLinks } from './useLinks';

const SCHEME_OPTIONS = [
  { label: 'System', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export function Rail({ active }: { active: 'leaderboard' | null }) {
  const { console: consoleUrl } = useLinks();
  const { colorScheme, computedColorScheme, setColorScheme } =
    useColorScheme();
  const navRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const tipOpen = tip !== null;
  const openTip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ top: r.top + 2, left: r.left + 52 });
  };
  const closeTip = () => setTip(null);
  // The tooltip floats over the page, so it mounts beside the rail, not inside its painted box.
  const tipHost = navRef.current?.parentElement ?? null;
  const isLeaderboard = active === 'leaderboard';

  return (
    <nav
      ref={navRef}
      className={classes.rail}
      data-parity="Rail"
      aria-label="boxscore"
    >
      <span className={classes.mark} data-parity="Mark">
        <img src="/favicon.svg" alt="" width={32} height={32} />
      </span>
      <span className={classes.railGap} />
      <Link
        href="/"
        aria-label="Leaderboard"
        aria-current={isLeaderboard ? 'page' : undefined}
        className={classes.navItem}
        data-parity={isLeaderboard ? 'Nav Leaderboard' : undefined}
        style={
          isLeaderboard
            ? { background: 'var(--mantine-color-accent-light)' }
            : undefined
        }
      >
        <Glyph
          name="trophy"
          size={19}
          color={isLeaderboard ? 'var(--tk-text-accent)' : 'var(--tk-text-3)'}
          parity="Nav Leaderboard Icon"
        />
      </Link>
      <span className={classes.railSpacer} />
      <span className={classes.navAnchor}>
        <a
          href={`${consoleUrl}/settings#boxscore`}
          target="_blank"
          rel="noreferrer"
          aria-label="Settings (opens console)"
          className={classes.navItem}
          data-parity={tipOpen ? 'Nav Settings (console)' : undefined}
          onMouseEnter={e => openTip(e.currentTarget)}
          onMouseLeave={closeTip}
          onFocus={e => openTip(e.currentTarget)}
          onBlur={closeTip}
        >
          <Glyph
            name="settings"
            size={19}
            color="var(--tk-text-3)"
            parity="Nav Settings (console) Icon"
          />
        </a>
        {tip &&
          tipHost &&
          createPortal(
            <span
              className={classes.tooltip}
              style={{ top: tip.top, left: tip.left }}
              data-parity="Settings Tooltip"
              role="tooltip"
            >
              <span className={classes.tipTitle}>
                <span className={classes.tipLabel} data-parity="Tip Label">
                  Settings
                </span>
                <Glyph
                  name="arrowUpRight"
                  size={13}
                  color="var(--tk-text-2)"
                  parity="External"
                />
              </span>
              <span className={classes.tipSub} data-parity="Tip Sub">
                Opens console › boxscore
              </span>
            </span>,
            tipHost
          )}
      </span>
      <HybridMenu
        options={SCHEME_OPTIONS}
        value={colorScheme}
        onChange={value => setColorScheme(value as typeof colorScheme)}
        target={
          <button
            type="button"
            className={classes.navItem}
            aria-label="Color scheme"
          >
            <Glyph
              name={computedColorScheme === 'dark' ? 'sun' : 'moon'}
              size={19}
              color="var(--tk-text-3)"
              parity="Nav Scheme Icon"
            />
          </button>
        }
      />
    </nav>
  );
}
