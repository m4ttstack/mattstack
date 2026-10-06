import { useEffect, useMemo, useRef } from 'react';
import { Alert, Box, Skeleton, Stack, Text } from '@mattstack/app-kit/core';
import { useReducedMotion, useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { useSearchParams } from 'wouter';

import { embedMessage, postToHost } from './embedBridge';
import { useOpenRow } from './explainParam';
import { ROW_MOTION_MS } from './SettingRow';
import { SettingsSection } from './SettingsSection';
import {
  SettingsRepoContext,
  SettingsTeamContext,
  useConsoleSettings,
  type ConsoleStore,
} from './useConsoleSettings';
import { buildSections, ESCAPE_OWNERS, NO_FILTER, type Provider } from './view';

const REVEAL_GAP = 24;
const REVEAL_WATCH_MS = 1500;

/** One settings group with no console chrome, for another mattstack app to
    show in an iframe modal (`/embed/settings/<group>`). Talks to its host
    only through `embedBridge`; every write the host should react to goes
    out as `saved`. */
export function SettingsEmbed({ group }: { group: string }) {
  const { text } = useSchemeColors();
  const openRow = useOpenRow();
  const [params, setParams] = useSearchParams();
  const repo = params.get('repo');
  const raw = useConsoleSettings(repo);
  const store = useMemo(() => announceWrites(raw, group), [raw, group]);

  const section = useMemo(
    () =>
      buildSections(store.defs, NO_FILTER, openRow.open?.key ?? null).find(
        s => s.group.id === group
      ) ?? null,
    [store.defs, group, openRow.open?.key]
  );
  const agentProvider: Provider =
    store.defs.find(d => d.key === 'agent.provider')?.effective.value ===
    'codex'
      ? 'codex'
      : 'claude';

  // The host's modal is the surface: the frame paints nothing of its own.
  useEffect(() => {
    const root = document.documentElement;
    root.style.background = 'transparent';
    root.style.scrollbarWidth = 'thin';
    root.style.scrollbarColor = 'var(--tk-line-2) transparent';
    document.body.style.background = 'transparent';
  }, []);

  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const report = () =>
      postToHost(embedMessage('height', { height: el.scrollHeight }));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Escape in a field or an open dropdown belongs to that control: a
    // Combobox closes itself without marking the event handled.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(ESCAPE_OWNERS)) return;
      if (target?.getAttribute('aria-expanded') === 'true') return;
      postToHost(embedMessage('close'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A row opened near the bottom grows past the frame. Keep it whole in
  // view (its top, if it is taller than the frame) with a little room under
  // it, re-checking as it grows: its panel loads after the open motion ends.
  const reduceMotion = useReducedMotion();
  const openKey = openRow.open?.key ?? null;
  // Skeletons only before the first list: a repo switch keeps the rows.
  const loadedOnce = !store.loading || store.defs.length > 0;
  const shown = loadedOnce && section !== null;
  useEffect(() => {
    if (!openKey || !shown) return;
    const row = Array.from(
      frame.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []
    ).find(el => el.dataset.key === openKey);
    if (!row) return;
    const reveal = () => {
      const box = row.getBoundingClientRect();
      const room = window.innerHeight - REVEAL_GAP;
      const by = box.height > room ? box.top - REVEAL_GAP : box.bottom - room;
      if (by > 0)
        window.scrollBy({
          top: by,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
    };
    const timer = window.setTimeout(reveal, reduceMotion ? 0 : ROW_MOTION_MS);
    const ro = new ResizeObserver(reveal);
    ro.observe(row);
    const stop = window.setTimeout(() => ro.disconnect(), REVEAL_WATCH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(stop);
      ro.disconnect();
    };
  }, [openKey, shown, reduceMotion]);

  const setRepo = (next: string | null) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        if (next) p.set('repo', next);
        else p.delete('repo');
        return p;
      },
      { replace: true }
    );

  return (
    <SettingsRepoContext.Provider value={repo}>
      <SettingsTeamContext.Provider value={store.team}>
        {/* Right inset only: a host bleeds the frame to its edge on that
            side so the scrollbar sits there, and pads the other three. */}
        <Box ref={frame} pr={18} style={{ contain: 'inline-size' }}>
          {store.error && (
            <Alert
              color="bad"
              variant="light"
              mt="md"
              icon={<Icons.error size={14} />}
            >
              <Text fz={12}>{store.error}</Text>
            </Alert>
          )}
          {!loadedOnce ? (
            <Stack gap="md" pt={28}>
              {[220, 280, 180].map(w => (
                <Stack key={w} gap={8}>
                  <Skeleton h={12} w={w} />
                  <Skeleton h={10} w={w + 160} />
                </Stack>
              ))}
            </Stack>
          ) : section === null ? (
            <Text fz={14} c={text.muted} pt={28}>
              {`No settings in the ${group} group.`}
            </Text>
          ) : (
            <SettingsSection
              section={section}
              store={store}
              query=""
              filtering={false}
              agentProvider={agentProvider}
              bare
              open={openRow.open}
              onOpenChange={(key, next) =>
                openRow.set(next ? { key, ...next } : null)
              }
              onPickRepo={setRepo}
              onFix={(key, issue) =>
                openRow.set(
                  { key, tab: 'where', fix: issue?.scope ?? null },
                  { repo: issue?.repo }
                )
              }
            />
          )}
        </Box>
      </SettingsTeamContext.Provider>
    </SettingsRepoContext.Provider>
  );
}

export function announceWrites(
  store: ConsoleStore,
  group: string
): ConsoleStore {
  const after =
    <A extends unknown[]>(
      op: (key: string, ...rest: A) => Promise<string | null>
    ) =>
    async (key: string, ...rest: A) => {
      const err = await op(key, ...rest);
      if (err === null) postToHost(embedMessage('saved', { key, group }));
      return err;
    };
  return {
    ...store,
    set: after(store.set),
    unset: after(store.unset),
    move: after(store.move),
    prune: after(store.prune),
  };
}
