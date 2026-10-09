import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Divider,
  Group,
  Stack,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';

import { useAgentModels } from '../config/useSettings';
import type { OpenRow } from './explainParam';
import type { WireIssue } from './issues';
import type { PanelStore } from './KeyPanel';
import { SCOPE_COLOR, ScopeBadge } from './ScopeBadge';
import { SettingRow, type RowOpen } from './SettingRow';
import classes from './SettingsSection.module.css';
import {
  providerOf,
  type Provider,
  type Section,
  type StoreScope,
} from './view';

/** One scope's rows on a wash of the scope's colour, led by its badge. */
function ScopeBlock({
  scope,
  children,
}: {
  scope: StoreScope;
  children: ReactNode;
}) {
  return (
    <Box
      className={classes.block}
      data-scope={scope}
      __vars={{ '--block-hue': `var(--tk-fill-${SCOPE_COLOR[scope]})` }}
    >
      <Group gap={8} wrap="nowrap" className={classes.head}>
        <ScopeBadge scope={scope} />
      </Group>
      {children}
    </Box>
  );
}

interface RowWiring {
  query: string;
  open: OpenRow | null;
  onOpenChange: (key: string, next: RowOpen | null) => void;
  onPickRepo?: (repo: string) => void;
  onFix?: (key: string, issue: WireIssue | null) => void;
}

function rowOpen(key: string, open: OpenRow | null): RowOpen | null {
  return open?.key === key ? { tab: open.tab, fix: open.fix } : null;
}

/** Whether a sticky element is pinned to the top of its scroll frame: it
    then sits a pixel past the frame's top edge the observer watches. */
function useStuck<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const frame = el.closest<HTMLElement>('.mantine-ScrollArea-viewport');
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return;
        setStuck(
          entry.intersectionRatio < 1 &&
            entry.boundingClientRect.top <= entry.rootBounds.top
        );
      },
      { root: frame, rootMargin: '-1px 0px 0px 0px', threshold: [1] }
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return [ref, stuck] as const;
}

function Header({
  section,
  count,
  right,
}: {
  section: Section;
  count: string;
  right?: ReactNode;
}) {
  const { text } = useSchemeColors();
  const [ref, stuck] = useStuck<HTMLDivElement>();
  return (
    <Stack ref={ref} gap={4} className={classes.header} mod={{ stuck }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap={8}>
          <Title order={2} size={16} fw={700}>
            {section.group.label}
          </Title>
          <Text fz={12} ff="monospace" c={text.muted}>
            {count}
          </Text>
        </Group>
        {right}
      </Group>
      {section.group.blurb && (
        <Text fz={12} c={text.muted}>
          {section.group.blurb}
        </Text>
      )}
    </Stack>
  );
}

function countText(filtering: boolean, shown: number, total: number) {
  return filtering ? `${shown} of ${total}` : String(total);
}

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** Which run of the Agents group a key belongs to: the provider switch
    itself, then each provider's own keys. */
function agentRun(key: string): Provider | null {
  return providerOf(key);
}

/** The Agents group lists every key like any other group, with each
    provider's keys as a labelled run after `agent.provider`. */
function AgentsSection({
  section,
  store,
  filtering,
  query,
  open,
  onOpenChange,
  onPickRepo,
  onFix,
}: {
  section: Section;
  store: PanelStore;
  filtering: boolean;
} & RowWiring) {
  const claude = useAgentModels('claude');
  const codex = useAgentModels('codex');
  const suggestions: Record<Provider, string[]> = {
    claude: (claude.data?.models ?? []).map(m => m.value),
    codex: (codex.data?.models ?? []).map(m => m.value),
  };
  const shown = section.subsections.reduce((n, s) => n + s.defs.length, 0);
  const row = (
    def: Section['subsections'][number]['defs'][number],
    scope: StoreScope
  ) => {
    const run = agentRun(def.key);
    return (
      <SettingRow
        key={def.key}
        def={def}
        store={store}
        subhead={scope}
        query={query}
        suggestions={
          run && def.key.endsWith('.model') ? suggestions[run] : undefined
        }
        onFix={onFix}
        open={rowOpen(def.key, open)}
        onOpenChange={next => onOpenChange(def.key, next)}
        onPickRepo={onPickRepo}
      />
    );
  };
  return (
    <Box component="section" id="settings-agents" className={classes.section}>
      <Header
        section={section}
        count={countText(filtering, shown, section.total)}
      />
      {section.subsections.map(sub => {
        const general = sub.defs.filter(d => agentRun(d.key) === null);
        const runs = (['claude', 'codex'] as const)
          .map(p => ({ p, defs: sub.defs.filter(d => agentRun(d.key) === p) }))
          .filter(r => r.defs.length > 0);
        return (
          <ScopeBlock key={sub.scope} scope={sub.scope}>
            {general.map(def => row(def, sub.scope))}
            {runs.map(({ p, defs }) => [
              <Divider
                key={`run-${p}`}
                className={classes.run}
                label={PROVIDER_LABEL[p]}
                labelPosition="left"
                styles={{
                  label: {
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--tk-text-1)',
                  },
                }}
              />,
              ...defs.map(def => row(def, sub.scope)),
            ])}
          </ScopeBlock>
        );
      })}
    </Box>
  );
}

export function SettingsSection({
  section,
  store,
  filtering,
  bare = false,
  query,
  open,
  onOpenChange,
  onPickRepo,
  onFix,
}: {
  section: Section;
  store: PanelStore;
  filtering: boolean;
  /** Drops the group's title row, for a host that already titles it. */
  bare?: boolean;
} & RowWiring) {
  if (section.group.id === 'agents')
    return (
      <AgentsSection
        section={section}
        store={store}
        filtering={filtering}
        query={query}
        open={open}
        onOpenChange={onOpenChange}
        onPickRepo={onPickRepo}
        onFix={onFix}
      />
    );
  return (
    <Box
      component="section"
      id={`settings-${section.group.id}`}
      className={bare ? undefined : classes.section}
    >
      {!bare && (
        <Header
          section={section}
          count={countText(filtering, section.shown, section.total)}
        />
      )}
      {section.subsections.map(sub => (
        <ScopeBlock key={sub.scope} scope={sub.scope}>
          {sub.defs.map(def => (
            <SettingRow
              key={def.key}
              def={def}
              store={store}
              subhead={sub.scope}
              query={query}
              onFix={onFix}
              open={rowOpen(def.key, open)}
              onOpenChange={next => onOpenChange(def.key, next)}
              onPickRepo={onPickRepo}
            />
          ))}
        </ScopeBlock>
      ))}
    </Box>
  );
}
