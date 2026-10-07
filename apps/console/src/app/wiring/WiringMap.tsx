import {
  Badge,
  Box,
  Button,
  GenericError,
  Group,
  PageShell,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import type { PageShellTab } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { useEditorHref } from '../editorHref';
import { CommandProvenance } from '../runs/CommandProvenance';
import { GraphSidebar } from './graph/FocusList';
import { GraphTab } from './graph/GraphTab';
import { MissingPackNotice } from './graph/MissingPackNotice';
import { UnsyncedBanner, useUnsyncedBanner } from './graph/UnsyncedBanner';
import { useWiringUrl, type WiringTab } from './graph/useWiringUrl';
import { HealthTab } from './HealthTab';
import { SurfaceTab } from './SurfaceTab';
import {
  useAttentionCount,
  useCompositionSnapshot,
  usePacks,
} from './useWiring';

export function WiringMap() {
  const { text } = useSchemeColors();
  const editorHref = useEditorHref();
  const packsQuery = usePacks();
  const [url, patch] = useWiringUrl();
  const attentionCount = useAttentionCount();

  const packs = packsQuery.data?.packs ?? [];
  // Never written back: turning an absent pack into an explicit one counts as
  // a pack change, which would drop a deep link's focus.
  const pack = packs.some(p => p.name === url.pack)
    ? url.pack
    : (packs[0]?.name ?? null);
  const packDir = packs.find(p => p.name === pack)?.dir ?? null;
  const missing =
    url.pack !== null && pack !== null && pack !== url.pack ? url.pack : null;

  const snapshot = useCompositionSnapshot(pack);
  const base = snapshot.data?.extends ?? null;
  const unsynced = useUnsyncedBanner(pack);
  const showTab = (tab: WiringTab) => patch({ tab });
  const notch = pack
    ? {
        content: (
          <Stack gap={0} w="100%">
            {missing !== null && (
              <MissingPackNotice asked={missing} shown={pack} />
            )}
            <UnsyncedBanner key={pack} pack={pack} />
          </Stack>
        ),
        opened: unsynced || missing !== null,
      }
    : undefined;

  // No pack means nothing for a tab to show yet -- the same gate the pack
  // picker and Surface action already used.
  const tabs: PageShellTab[] = pack
    ? [
        {
          id: 'graph',
          label: 'Graph',
          icon: 'workflow',
          active: url.tab === 'graph',
          onClick: () => showTab('graph'),
        },
        {
          id: 'surface',
          label: 'Surface',
          icon: 'layers',
          active: url.tab === 'surface',
          onClick: () => showTab('surface'),
        },
        {
          id: 'health',
          label: 'Health',
          labelComponent: (
            <Group gap={4} wrap="nowrap">
              <span>Health</span>
              {attentionCount > 0 && (
                <Badge
                  size="xs"
                  variant="light"
                  // Main.dc.html `.tab.active .cnt.warn`: the amber tint is
                  // scoped to the active tab -- an inactive tab's count
                  // stays neutral so warn-orange doesn't bleed onto chrome
                  // that isn't Health.
                  color={url.tab === 'health' ? 'warn' : 'gray'}
                  radius="xl"
                  data-testid="health-tab-count"
                >
                  {attentionCount}
                </Badge>
              )}
            </Group>
          ),
          icon: 'checkCircle',
          active: url.tab === 'health',
          onClick: () => showTab('health'),
        },
      ]
    : [];

  const graphPack = url.tab === 'graph' ? pack : null;

  const actions = (
    <>
      <Box visibleFrom="lg">
        <CommandProvenance
          command="rt skills composition"
          asOf={snapshot.dataUpdatedAt || undefined}
        />
      </Box>
      {packDir && (
        <Button
          size="xs"
          variant="default"
          component="a"
          href={editorHref(packDir)}
          leftSection={<Icons.package size={14} />}
          data-testid="open-pack"
        >
          Open pack
        </Button>
      )}
      {pack && base && (
        <Badge
          size="sm"
          variant="quiet"
          title={`This pack's fills and shared attachments come partly from the org's ${base.name} base pack.`}
          data-testid="pack-extends"
        >
          {`extends ${base.name}`}
        </Badge>
      )}
      {packs.length > 1 && pack && (
        <Select
          size="xs"
          w={168}
          data={packs.map(p => ({ value: p.name, label: p.name }))}
          value={pack}
          onChange={value => patch({ pack: value })}
          data-testid="pack-select"
        />
      )}
      {packs.length === 1 && pack && (
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c={text.dimmed}>
            pack
          </Text>
          <Text
            size="sm"
            fw={500}
            maw={168}
            truncate
            title={pack}
            data-testid="pack-name"
          >
            {pack}
          </Text>
        </Group>
      )}
    </>
  );

  return (
    <PageShell
      tabBarHeight={PAGE_ROW_HEIGHT}
      sidebarWidth={216}
      drawerStateKey="console-wiring-focus"
      tabs={tabs}
      tabBar={{ title: 'Wiring', actions }}
      topNotch={notch}
    >
      {graphPack && (
        <PageShell.Sidebar hideCollapseButton bg="var(--tk-panel)">
          <GraphSidebar pack={graphPack} />
        </PageShell.Sidebar>
      )}
      <PageShell.Main>
        {graphPack ? (
          <PageShell.Content bg="var(--tk-bg)" contentContainer={false}>
            {height => <GraphTab pack={graphPack} height={height} />}
          </PageShell.Content>
        ) : (
          <PageShell.Content>
            {packsQuery.isError ? (
              <GenericError
                title="Couldn't load skills packs"
                message={(packsQuery.error as Error).message}
                onRetry={() => void packsQuery.refetch()}
              />
            ) : !pack ? (
              packsQuery.isPending ? (
                <Skeleton height={200} data-testid="packs-loading" />
              ) : (
                <Text size="sm" c={text.dimmed} data-testid="no-packs">
                  No skills packs found.
                </Text>
              )
            ) : url.tab === 'surface' ? (
              <SurfaceTab pack={pack} />
            ) : (
              <HealthTab
                pack={pack}
                onOpenSkill={verb => patch({ tab: 'graph', focus: verb })}
              />
            )}
          </PageShell.Content>
        )}
      </PageShell.Main>
    </PageShell>
  );
}
