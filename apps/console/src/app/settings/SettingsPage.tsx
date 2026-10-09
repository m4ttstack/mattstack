import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CloseButton,
  Group,
  Kbd,
  NavLink,
  PageShell,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  usePageShellContext,
  VisuallyHidden,
} from '@mattstack/app-kit/core';
import {
  useHotkeys,
  useReducedMotion,
  useSchemeColors,
} from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { useSearchParams } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { useOpenRow } from './explainParam';
import { TIER_LABEL, type Tier } from './groups';
import { ScopeDot } from './ScopeBadge';
import { ROW_MOTION_MS } from './SettingRow';
import { SettingsContextBar } from './SettingsContextBar';
import { SettingsSection } from './SettingsSection';
import { UnregisteredNote } from './UnregisteredNote';
import {
  SettingsDefsContext,
  SettingsOrgContext,
  SettingsRepoContext,
  SettingsTeamContext,
  SettingsViewTeamContext,
  useConsoleSettings,
} from './useConsoleSettings';
import { useSectionSpy } from './useSectionSpy';
import {
  buildSections,
  needsFixing,
  type Provider,
  type ScopeFilter,
  type Section,
} from './view';

const TIERS: Tier[] = ['rt', 'apps', 'suite'];
const SCOPES = ['user', 'org', 'team', 'machine'] as const;
// Viewing another team hides this Mac's own layers, so only the shared
// scopes are left to filter by.
const SHARED_SCOPES = ['org', 'team'] as const;
const TOOLBAR_ROW = 60;
// The context row and the toolbar row, plus the header's own bottom hairline.
const HEADER_HEIGHT = PAGE_ROW_HEIGHT + TOOLBAR_ROW + 1;
const FIX_CHIP_STYLES = {
  label: { height: 34, paddingInline: 12, fontSize: 13, fontWeight: 600 },
};

function Index({
  sections,
  filtering,
  active,
  onPick,
}: {
  sections: Section[];
  filtering: boolean;
  active: string;
  onPick: (id: string) => void;
}) {
  const { text } = useSchemeColors();
  const { collapsedSidebar, toggleSidebar } = usePageShellContext();
  return (
    <Box component="nav" aria-label="settings groups" p="12px 12px 20px 16px">
      {TIERS.map((tier, i) => (
        <Box key={tier}>
          <Text
            fz={12}
            fw={500}
            c="var(--tk-text-3)"
            px={8}
            pt={i === 0 ? 8 : 20}
            pb={4}
          >
            {TIER_LABEL[tier]}
          </Text>
          {sections
            .filter(s => s.group.tier === tier)
            .map(s => {
              const empty = filtering && s.shown === 0;
              const current = active === s.group.id;
              return (
                <NavLink
                  key={s.group.id}
                  href={`#${s.group.id}`}
                  label={s.group.label}
                  active={current}
                  leftSection={
                    <Box
                      component="span"
                      aria-hidden
                      w={7}
                      h={7}
                      style={{
                        flex: 'none',
                        borderRadius: '50%',
                        border: '1.5px solid var(--tk-line-1)',
                      }}
                    />
                  }
                  disabled={empty}
                  aria-disabled={empty || undefined}
                  tabIndex={empty ? -1 : undefined}
                  rightSection={
                    <Text fz={12} ff="monospace" c={text.muted}>
                      {filtering ? s.shown : s.total}
                    </Text>
                  }
                  styles={{
                    root: {
                      height: 30,
                      padding: '0 8px 0 20px',
                      borderRadius: 4,
                      background: current ? 'var(--tk-raised)' : undefined,
                      color:
                        current || (filtering && !empty)
                          ? 'var(--tk-text-1)'
                          : 'var(--tk-text-2)',
                      opacity: empty ? 0.45 : undefined,
                      marginBottom: 2,
                    },
                    label: { fontSize: 14, fontWeight: current ? 500 : 400 },
                  }}
                  onClick={e => {
                    e.preventDefault();
                    if (empty) return;
                    window.history.replaceState(
                      null,
                      '',
                      `${window.location.pathname}${window.location.search}#${s.group.id}`
                    );
                    onPick(s.group.id);
                    if (collapsedSidebar) toggleSidebar();
                  }}
                />
              );
            })}
        </Box>
      ))}
    </Box>
  );
}

export function SettingsPage() {
  const { text } = useSchemeColors();
  const openRow = useOpenRow();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const repo = params.get('repo');
  const viewTeam = params.get('team');
  const store = useConsoleSettings(repo, '', viewTeam);
  const other = viewTeam !== null && viewTeam !== store.ownTeam;
  const [needsFixingOnly, setNeedsFixingOnly] = useState(false);
  const [pickedScope, setScope] = useState<ScopeFilter>('any');
  const scopes = other ? SHARED_SCOPES : SCOPES;
  const scope: ScopeFilter =
    pickedScope === 'any' || (scopes as readonly string[]).includes(pickedScope)
      ? pickedScope
      : 'any';
  const [scrolled, setScrolled] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  useHotkeys([['/', () => filterRef.current?.focus()]]);

  const setQuery = (q: string) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        return next;
      },
      { replace: true }
    );

  const setViewTeam = (next: string | null) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        if (next) p.set('team', next);
        else p.delete('team');
        return p;
      },
      { replace: true }
    );

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

  const openKey = openRow.open?.key ?? null;
  const sections = useMemo(
    () =>
      buildSections(
        store.defs,
        { query, needsFixing: needsFixingOnly, scope },
        openKey
      ),
    [store.defs, query, needsFixingOnly, scope, openKey]
  );
  const total = store.defs.length;
  const agentProvider: Provider =
    store.defs.find(d => d.key === 'agent.provider')?.effective.value ===
    'codex'
      ? 'codex'
      : 'claude';
  const shown = sections.reduce((n, s) => n + s.shown, 0);
  const broken = store.defs.filter(needsFixing).length;
  const filtering = query !== '' || needsFixingOnly || scope !== 'any';
  const visible = sections.filter(s => s.shown > 0);
  const frame = useRef<HTMLDivElement>(null);
  const [active, jump] = useSectionSpy(
    frame,
    visible.map(s => s.group.id),
    window.location.hash.slice(1)
  );

  // A deep link (/settings#board) can only scroll once the sections exist.
  useEffect(() => {
    if (store.loading) return;
    const id = window.location.hash.slice(1);
    if (id) jump(id);
  }, [store.loading, jump]);
  const hiddenGroups = sections.length - visible.length;
  const clearAll = () => {
    setQuery('');
    setNeedsFixingOnly(false);
    setScope('any');
  };

  // A link (read once, at mount) or a Fix scrolls its row into view, first
  // clearing a filter that hides it; a click on a row never scrolls. A Fix
  // waits `settle` ms, since a row it closes above moves its target until
  // that row's collapse ends.
  const reduceMotion = useReducedMotion();
  const [reveal, setReveal] = useState<{ key: string; settle: number } | null>(
    () => (openRow.open ? { key: openRow.open.key, settle: 0 } : null)
  );
  useEffect(() => {
    if (store.loading || reveal === null) return;
    const target = Array.from(
      frame.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []
    ).find(el => el.dataset.key === reveal.key);
    if (!target) {
      if (filtering && store.defs.some(d => d.key === reveal.key)) clearAll();
      else setReveal(null);
      return;
    }
    const scroll = () => {
      target.scrollIntoView({ block: 'start' });
      setReveal(null);
    };
    if (reveal.settle === 0) {
      scroll();
      return;
    }
    const timer = window.setTimeout(scroll, reveal.settle);
    return () => window.clearTimeout(timer);
  }, [store.loading, reveal, filtering, sections]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing =
    openRow.open &&
    !store.loading &&
    store.error === null &&
    !store.defs.some(d => d.key === openRow.open?.key)
      ? openRow.open.key
      : null;

  return (
    <SettingsRepoContext.Provider value={repo}>
      <SettingsOrgContext.Provider value={store.org}>
        <SettingsTeamContext.Provider value={store.team}>
          <SettingsViewTeamContext.Provider value={other ? viewTeam : null}>
            <SettingsDefsContext.Provider value={store.defs}>
              <PageShell
                headerHeight={HEADER_HEIGHT}
                sidebarWidth={232}
                drawerStateKey="console-settings-index"
              >
                <PageShell.Sidebar hideCollapseButton>
                  <Index
                    sections={sections}
                    filtering={filtering}
                    active={active}
                    onPick={jump}
                  />
                </PageShell.Sidebar>
                <PageShell.Main>
                  <PageShell.Header
                    px={0}
                    gap={0}
                    align="stretch"
                    style={{
                      background: 'var(--tk-panel)',
                      borderBottom: '1px solid var(--tk-border)',
                      boxShadow: scrolled
                        ? '0 2px 10px color-mix(in srgb, var(--tk-text-1) 8%, transparent)'
                        : undefined,
                      transition: 'box-shadow 120ms',
                    }}
                  >
                    <VisuallyHidden component="h1">Settings</VisuallyHidden>
                    <Stack gap={0} w="100%">
                      <Group h={PAGE_ROW_HEIGHT} px={24} wrap="nowrap">
                        <SettingsContextBar
                          org={store.org}
                          team={store.team}
                          ownTeam={store.ownTeam}
                          viewer={store.viewer}
                          other={other}
                          onPickTeam={setViewTeam}
                        />
                      </Group>
                      <Group
                        role="toolbar"
                        aria-label="settings filters"
                        gap={10}
                        px={24}
                        h={TOOLBAR_ROW}
                        pb={4}
                        wrap="nowrap"
                      >
                        <TextInput
                          ref={filterRef}
                          aria-label="filter settings"
                          style={{ flex: 1 }}
                          leftSection={<Icons.search size={16} />}
                          placeholder={`Filter ${total} settings`}
                          styles={{ input: { fontSize: 14 } }}
                          value={query}
                          onTextChange={setQuery}
                          onKeyDown={e => {
                            if (e.key === 'Escape' && query !== '') {
                              e.stopPropagation();
                              setQuery('');
                            }
                          }}
                          rightSectionWidth={query ? 110 : 36}
                          rightSection={
                            query ? (
                              <Group gap={6} wrap="nowrap">
                                <Text
                                  fz={12}
                                  c={text.muted}
                                >{`${shown} of ${total}`}</Text>
                                <CloseButton
                                  size="sm"
                                  aria-label="clear filter"
                                  onClick={() => setQuery('')}
                                />
                              </Group>
                            ) : (
                              <Kbd size="sm">/</Kbd>
                            )
                          }
                        />
                        {(broken > 0 || needsFixingOnly) && (
                          <Chip
                            checked={needsFixingOnly}
                            onChange={setNeedsFixingOnly}
                            variant="light"
                            color="warn"
                            size="sm"
                            icon={<Icons.warning size={14} />}
                            styles={FIX_CHIP_STYLES}
                          >
                            {broken === 1
                              ? '1 needs fixing'
                              : `${broken} need fixing`}
                          </Chip>
                        )}
                        <SegmentedControl
                          size="sm"
                          withItemsBorders={false}
                          value={scope}
                          onChange={v => setScope(v as ScopeFilter)}
                          data={[
                            { value: 'any', label: 'any' },
                            ...scopes.map(s => ({
                              value: s,
                              label: (
                                <Group gap={6} wrap="nowrap">
                                  <ScopeDot scope={s} />
                                  <span>{s}</span>
                                </Group>
                              ),
                            })),
                          ]}
                        />
                      </Group>
                    </Stack>
                  </PageShell.Header>
                  <PageShell.Content
                    contentContainer={false}
                    bg="var(--tk-card)"
                    scrollAreaProps={{
                      viewportRef: frame,
                      onScrollPositionChange: ({ y }) => setScrolled(y > 0),
                    }}
                  >
                    {/* The page's one overflow guard: Mantine's ScrollArea content
                wrapper is `min-width: min-content`, so without size
                containment here any unbreakable descendant (a long path, a
                JSON value, a nowrap label) widens the page and scrolls it
                sideways instead of truncating or wrapping in place. */}
                    <Box px={32} pb={32} style={{ contain: 'inline-size' }}>
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
                      {missing && (
                        <Alert color="gray" variant="light" mt="md">
                          <Text fz={12}>{`No setting named ${missing}.`}</Text>
                        </Alert>
                      )}
                      {/* Skeletons only before the first list: a repo switch keeps the
                  list it has on screen until the new one arrives. */}
                      {store.loading && store.defs.length === 0 ? (
                        <Stack gap="md" pt={28}>
                          {[220, 280, 180, 240].map(w => (
                            <Group key={w} justify="space-between">
                              <Stack gap={8}>
                                <Skeleton h={12} w={w} />
                                <Skeleton h={10} w={w + 160} />
                              </Stack>
                              <Skeleton h={30} w={200} />
                            </Group>
                          ))}
                        </Stack>
                      ) : visible.length === 0 && total > 0 ? (
                        <Stack align="center" gap={10} py={48}>
                          <Icons.search size={24} color={text.muted} />
                          <Text fz={14} fw={500}>
                            {query
                              ? `No settings match “${query}”`
                              : 'No settings match these filters'}
                          </Text>
                          <Text fz={12} c={text.muted}>
                            The filter reads key names and descriptions, not
                            values.
                          </Text>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={clearAll}
                          >
                            Clear filter
                          </Button>
                        </Stack>
                      ) : (
                        <Box
                          data-testid="settings-list"
                          inert={store.loading}
                          aria-busy={store.loading || undefined}
                          style={{
                            opacity: store.loading ? 0.55 : undefined,
                            transition: 'opacity 120ms',
                          }}
                        >
                          {visible.map(s => (
                            <SettingsSection
                              key={s.group.id}
                              section={s}
                              store={store}
                              query={query}
                              filtering={filtering}
                              agentProvider={agentProvider}
                              open={openRow.open}
                              onOpenChange={(key, next) =>
                                openRow.set(next ? { key, ...next } : null)
                              }
                              onPickRepo={setRepo}
                              onFix={(key, issue) => {
                                openRow.set(
                                  {
                                    key,
                                    tab: 'where',
                                    fix: issue?.scope ?? null,
                                  },
                                  { repo: issue?.repo }
                                );
                                setReveal({
                                  key,
                                  settle: reduceMotion ? 0 : ROW_MOTION_MS,
                                });
                              }}
                            />
                          ))}
                        </Box>
                      )}
                      {filtering && visible.length > 0 && hiddenGroups > 0 && (
                        <Group gap={8} pt={20}>
                          <Icons.eyeOff size={14} color={text.muted} />
                          <Text fz={12} c={text.muted}>
                            {hiddenGroups === 1
                              ? '1 group has no match.'
                              : `${hiddenGroups} groups have no match.`}
                          </Text>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={clearAll}
                          >
                            Clear filter
                          </Button>
                        </Group>
                      )}
                      {!store.loading && (
                        <UnregisteredNote entries={store.unregistered} />
                      )}
                    </Box>
                  </PageShell.Content>
                </PageShell.Main>
              </PageShell>
            </SettingsDefsContext.Provider>
          </SettingsViewTeamContext.Provider>
        </SettingsTeamContext.Provider>
      </SettingsOrgContext.Provider>
    </SettingsRepoContext.Provider>
  );
}
