import { useEffect, useRef, useState } from 'react';

import {
  ActionIcon,
  Group,
  HybridMenu,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
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

const NAV_SIZE = 40;
const NAV_RADIUS = 10;

export function Rail({ active }: { active: 'leaderboard' | null }) {
  const { console: consoleUrl } = useLinks();
  const { colorScheme, computedColorScheme, setColorScheme } = useColorScheme();
  const navRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  useEffect(() => setFrame(navRef.current?.parentElement ?? null), []);
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
      <ActionIcon
        component={Link}
        href="/"
        size={NAV_SIZE}
        radius={NAV_RADIUS}
        variant={isLeaderboard ? 'light' : 'subtle'}
        color={isLeaderboard ? 'accent' : 'gray'}
        aria-label="Leaderboard"
        aria-current={isLeaderboard ? 'page' : undefined}
        data-parity={isLeaderboard ? 'Nav Leaderboard' : undefined}
      >
        <Glyph
          name="trophy"
          size={19}
          color={isLeaderboard ? 'var(--tk-text-accent)' : 'var(--tk-text-3)'}
          parity="Nav Leaderboard Icon"
        />
      </ActionIcon>
      <span className={classes.railSpacer} />
      {/* Portalled into the page frame rather than body so it sits inside the parity root. */}
      <Tooltip
        position="right"
        offset={16}
        transitionProps={{ transition: 'fade', duration: 200 }}
        portalProps={{ target: frame ?? undefined }}
        data-parity="Settings Tooltip"
        label={
          <Stack gap={2}>
            <Group gap={6}>
              <Text size="sm" fw={500} data-parity="Tip Label">
                Settings
              </Text>
              <Glyph
                name="arrowUpRight"
                size={13}
                color="currentColor"
                parity="External"
              />
            </Group>
            <Text size="xs" opacity={0.75} data-parity="Tip Sub">
              Opens console › boxscore
            </Text>
          </Stack>
        }
      >
        <ActionIcon
          component="a"
          href={`${consoleUrl}/settings#boxscore`}
          target="_blank"
          rel="noreferrer"
          size={NAV_SIZE}
          radius={NAV_RADIUS}
          variant="subtle"
          color="gray"
          aria-label="Settings (opens console)"
          data-parity={hovered ? 'Nav Settings (console)' : undefined}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Glyph
            name="settings"
            size={19}
            color="var(--tk-text-3)"
            parity="Nav Settings (console) Icon"
          />
        </ActionIcon>
      </Tooltip>
      <HybridMenu
        options={SCHEME_OPTIONS}
        value={colorScheme}
        onChange={value => setColorScheme(value as typeof colorScheme)}
        target={
          <ActionIcon
            size={NAV_SIZE}
            radius={NAV_RADIUS}
            variant="subtle"
            color="gray"
            aria-label="Color scheme"
          >
            <Glyph
              name={computedColorScheme === 'dark' ? 'sun' : 'moon'}
              size={19}
              color="var(--tk-text-3)"
              parity="Nav Scheme Icon"
            />
          </ActionIcon>
        }
      />
    </nav>
  );
}
