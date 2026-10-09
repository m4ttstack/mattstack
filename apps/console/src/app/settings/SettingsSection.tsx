import { useState, type ReactNode } from 'react';
import {
  Box,
  Group,
  SegmentedControl,
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
import { useSettingsOrg, useSettingsTeam } from './useConsoleSettings';
import {
  providerOf,
  type Provider,
  type Section,
  type StoreScope,
} from './view';

const NOTE: Record<StoreScope, string> = {
  org: 'shared with every team through the org repo',
  team: 'shared with your team through the org repo',
  user: 'your home repo, follows you to every machine',
  machine: 'never leaves this Mac',
};

function subheadNote(
  scope: StoreScope,
  team: string | null,
  org: string | null
): string {
  if (scope === 'org' && org)
    return `shared with every team through the ${org} org repo`;
  if (scope === 'team' && team)
    return `shared with the ${team} team through the org repo`;
  return NOTE[scope];
}

/** One scope's rows on a wash of the scope's colour, led by its badge. */
function ScopeBlock({
  scope,
  count,
  children,
}: {
  scope: StoreScope;
  count: number;
  children: ReactNode;
}) {
  const { text } = useSchemeColors();
  const team = useSettingsTeam();
  const org = useSettingsOrg();
  return (
    <Box
      className={classes.block}
      data-scope={scope}
      __vars={{ '--block-hue': `var(--tk-fill-${SCOPE_COLOR[scope]})` }}
    >
      <Group gap={8} wrap="nowrap" className={classes.head}>
        <ScopeBadge scope={scope} />
        <Text fz={12} ff="monospace" c={text.muted}>
          {count}
        </Text>
        <Text fz={12} c={text.muted}>
          {`· ${subheadNote(scope, team, org)}`}
        </Text>
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
  return (
    <Stack gap={4} pt={28} pb={8}>
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

function AgentsSection({
  section,
  store,
  filtering,
  initialProvider,
  query,
  open,
  onOpenChange,
  onPickRepo,
  onFix,
}: {
  section: Section;
  store: PanelStore;
  filtering: boolean;
  initialProvider: Provider;
} & RowWiring) {
  const all = section.subsections.flatMap(s => s.defs);
  const [chosen, setChosen] = useState<Provider>(
    () => providerOf(open?.key) ?? initialProvider
  );
  const shownFor = (p: Provider) =>
    all.some(d => d.key.startsWith(`agent.${p}.`));
  const other: Provider = chosen === 'claude' ? 'codex' : 'claude';
  // Derived, never written back: clearing the filter returns to `chosen`.
  const provider = !shownFor(chosen) && shownFor(other) ? other : chosen;
  const models = useAgentModels(provider);
  const suggestions = (models.data?.models ?? []).map(m => m.value);
  const defs = all.filter(
    d => d.key === 'agent.provider' || d.key.startsWith(`agent.${provider}.`)
  );
  return (
    <Box component="section" id="settings-agents">
      <Header
        section={section}
        count={countText(filtering, defs.length, section.total)}
        right={
          <SegmentedControl
            size="sm"
            withItemsBorders={false}
            value={provider}
            onChange={v => setChosen(v as Provider)}
            data={[
              { value: 'claude', label: 'Claude' },
              { value: 'codex', label: 'Codex' },
            ]}
          />
        }
      />
      {section.subsections.map(sub => {
        const rows = sub.defs.filter(d => defs.includes(d));
        if (rows.length === 0) return null;
        return (
          <ScopeBlock key={sub.scope} scope={sub.scope} count={rows.length}>
            {rows.map(def => (
              <SettingRow
                key={def.key}
                def={def}
                store={store}
                subhead={sub.scope}
                query={query}
                suggestions={
                  def.key.endsWith('.model') ? suggestions : undefined
                }
                onFix={onFix}
                open={rowOpen(def.key, open)}
                onOpenChange={next => onOpenChange(def.key, next)}
                onPickRepo={onPickRepo}
              />
            ))}
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
  agentProvider,
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
  agentProvider: Provider;
  /** Drops the group's title row, for a host that already titles it. */
  bare?: boolean;
} & RowWiring) {
  if (section.group.id === 'agents')
    return (
      <AgentsSection
        section={section}
        store={store}
        filtering={filtering}
        initialProvider={agentProvider}
        query={query}
        open={open}
        onOpenChange={onOpenChange}
        onPickRepo={onPickRepo}
        onFix={onFix}
      />
    );
  return (
    <Box component="section" id={`settings-${section.group.id}`}>
      {!bare && (
        <Header
          section={section}
          count={countText(filtering, section.shown, section.total)}
        />
      )}
      {section.subsections.map(sub => (
        <ScopeBlock key={sub.scope} scope={sub.scope} count={sub.defs.length}>
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
