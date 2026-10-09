import { useContext, useState, type ReactNode } from 'react';
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
import { scopeTextColor } from './ScopeBadge';
import { SettingRow, type RowOpen } from './SettingRow';
import {
  SettingsDefsContext,
  useSettingsOrg,
  useSettingsTeam,
} from './useConsoleSettings';
import {
  agentProviders,
  providerLabel,
  providerOf,
  type Provider,
  type Section,
  type StoreScope,
} from './view';

const SUBHEAD: Record<StoreScope, { label: string; note: string }> = {
  org: {
    label: 'Org',
    note: 'shared with every team through the org repo',
  },
  team: {
    label: 'Team',
    note: 'shared with your team through the org repo',
  },
  user: {
    label: 'You',
    note: 'your home repo, follows you to every machine',
  },
  machine: {
    label: 'This machine',
    note: 'never leaves this Mac',
  },
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
  return SUBHEAD[scope].note;
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
  const loaded = useContext(SettingsDefsContext);
  const providers = agentProviders(loaded.length > 0 ? loaded : all);
  const [chosen, setChosen] = useState<Provider>(
    () => providerOf(open?.key, providers) ?? initialProvider
  );
  const shownFor = (p: Provider) =>
    all.some(d => d.key.startsWith(`agent.${p}.`));
  // Derived, never written back: clearing the filter returns to `chosen`.
  const provider = shownFor(chosen)
    ? chosen
    : (providers.find(shownFor) ?? chosen);
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
            data={providers.map(p => ({ value: p, label: providerLabel(p) }))}
          />
        }
      />
      {defs.map(def => (
        <SettingRow
          key={def.key}
          def={def}
          store={store}
          subhead={null}
          query={query}
          suggestions={def.key.endsWith('.model') ? suggestions : undefined}
          onFix={onFix}
          open={rowOpen(def.key, open)}
          onOpenChange={next => onOpenChange(def.key, next)}
          onPickRepo={onPickRepo}
        />
      ))}
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
  const { text } = useSchemeColors();
  const team = useSettingsTeam();
  const org = useSettingsOrg();
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
      {section.subsections.map((sub, i) => (
        <Box key={sub.scope ?? 'all'}>
          {sub.scope && (
            <Group
              gap={8}
              pt={bare && i === 0 ? 4 : 22}
              pb={6}
              wrap="nowrap"
              style={{ borderBottom: '1px solid var(--tk-line-2)' }}
            >
              <Text
                fz={12}
                fw={500}
                tt="uppercase"
                lts={0.6}
                c={scopeTextColor(sub.scope)}
              >
                {SUBHEAD[sub.scope].label}
              </Text>
              <Text fz={12} ff="monospace" c={text.muted}>
                {sub.defs.length}
              </Text>
              <Text fz={12} c={text.muted}>
                {`· ${subheadNote(sub.scope, team, org)}`}
              </Text>
            </Group>
          )}
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
        </Box>
      ))}
    </Box>
  );
}
