import { useState } from 'react';

import { useColorScheme } from '@mattstack/app-kit/hooks';
import { Link } from '@mattstack/app-kit/router';
import { Glyph } from '../ui/Glyph';
import classes from './shell.module.css';
import { useLinks } from './useLinks';

export function Rail({ active }: { active: 'leaderboard' | null }) {
  const { console: consoleUrl } = useLinks();
  const { toggle } = useColorScheme();
  const [tipOpen, setTipOpen] = useState(false);
  const isLeaderboard = active === 'leaderboard';

  return (
    <nav className={classes.rail} data-parity="Rail" aria-label="boxscore">
      <span className={classes.mark} data-parity="Mark">
        <Glyph
          name="chartNoAxesColumn"
          size={18}
          color="var(--tk-on-fill-bad)"
          parity="Mark Icon"
        />
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
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
          onFocus={() => setTipOpen(true)}
          onBlur={() => setTipOpen(false)}
        >
          <Glyph
            name="settings"
            size={19}
            color="var(--tk-text-3)"
            parity="Nav Settings (console) Icon"
          />
        </a>
        {tipOpen && (
          <span
            className={classes.tooltip}
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
          </span>
        )}
      </span>
      <button
        type="button"
        className={classes.navItem}
        aria-label="Toggle colour scheme"
        onClick={toggle}
      >
        <Glyph
          name="moon"
          size={19}
          color="var(--tk-text-3)"
          parity="Nav Scheme Icon"
        />
      </button>
    </nav>
  );
}
