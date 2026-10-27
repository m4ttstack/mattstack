import { useCallback, useState } from 'react';
import {
  MattstackShell,
  OrgPill,
  ScopeSlash,
  TeamMenu,
  useViewer,
} from '@mattstack/app-kit/app';
import {
  Badge,
  Button,
  GenericError,
  Group,
  PageShell,
  Text,
} from '@mattstack/app-kit/core';
import type { PageShellTab } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { useEditorHref } from '../editorHref';
import { PaneResizer, usePaneWidth } from '../PaneResizer';
import { StepLoader } from '../StepLoader';
import { ConfigTab } from './ConfigTab';
import { ContentReadyContext } from './contentReady';
import { DevPackSwitch } from './DevPackSwitch';
import toastClasses from './graph/graph.module.css';
import { GraphTab, GraphTabSidebar } from './graph/GraphTab';
import { MissingPackNotice } from './graph/MissingPackNotice';
import { useUnsyncedBanner, useUnsyncedSummary } from './graph/UnsyncedBanner';
import { UnsyncedToast } from './graph/UnsyncedToast';
import { useWiringUrl, type WiringTab } from './graph/useWiringUrl';
import {
  COMMITS_PANE,
  HistoryMain,
  HistorySidebar,
  WORKING,
  writeHistoryUrl,
} from './PackHistory';
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
    : (packs.find(p => p.team !== null)?.name ?? packs[0]?.name ?? null);
  const packDir = packs.find(p => p.name === pack)?.dir ?? null;
  // An rt without the team field leaves it undefined: every pack is a team's.
  const teamPacks = packs.filter(p => p.team !== null).map(p => p.name);
  const devPacks = packs.filter(p => p.team === null).map(p => p.name);
  const missing =
    url.pack !== null && pack !== null && pack !== url.pack ? url.pack : null;

  const snapshot = useCompositionSnapshot(pack);
  const base = snapshot.data?.extends ?? null;
  const who = useViewer();
  const org = who?.org ?? null;
  const viewer = who?.viewer ?? null;
  const unsynced = useUnsyncedBanner(pack);
  const unsyncedCount = useUnsyncedSummary(pack)?.count ?? 0;
  // The notification waits for the tab's content and the changes read, so it
  // never arrives ahead of the page.
  const [readyPack, setReadyPack] = useState<string | null>(null);
  const markReady = useCallback(() => setReadyPack(pack), [pack]);
  const contentReady = readyPack !== null && readyPack === pack;
  const reviewChanges = () => {
    patch({ tab: 'history' });
    writeHistoryUrl({ commits: [WORKING] });
  };
  const showTab = (tab: WiringTab) => patch({ tab });
  const [commitsWidth, setCommitsWidth] = usePaneWidth(
    'console-history-commits-width',
    COMMITS_PANE
  );
  const notch = pack
    ? {
        content:
          missing !== null ? (
            <MissingPackNotice asked={missing} shown={pack} />
          ) : null,
        opened: missing !== null,
      }
    : undefined;

  // No pack means nothing for a tab to show yet -- the same gate the pack
  // picker and Surface action already used.
  const tabs: PageShellTab[] = pack
    ? [
        {
          id: 'graph',
          label: 'Overview',
          icon: 'boxes',
          active: url.tab === 'graph',
          onClick: () => showTab('graph'),
        },
        {
          id: 'config',
          label: 'Config',
          labelComponent: (
            <Group gap={6} wrap="nowrap">
              <span>Config</span>
              {attentionCount > 0 && (
                <Badge
                  size="xs"
                  variant="tint"
                  color="warn"
                  radius="xl"
                  leftSection={<span className={toastClasses.tabDot} />}
                  title={`${attentionCount} need attention`}
                  data-testid="config-tab-count"
                >
                  {attentionCount}
                </Badge>
              )}
            </Group>
          ),
          icon: 'sliders',
          active: url.tab === 'config',
          onClick: () => showTab('config'),
        },
        {
          id: 'history',
          label: 'Changes',
          labelComponent: (
            <Group gap={6} wrap="nowrap">
              <span>Changes</span>
              {unsynced.show && unsyncedCount > 0 && (
                <Badge
                  size="xs"
                  variant="tint"
                  color="warn"
                  radius="xl"
                  leftSection={<span className={toastClasses.tabDot} />}
                  title={`${unsyncedCount} unsynced`}
                  data-testid="history-tab-unsynced"
                >
                  {unsyncedCount}
                </Badge>
              )}
            </Group>
          ),
          icon: 'clock',
          active: url.tab === 'history',
          onClick: () => showTab('history'),
        },
      ]
    : [];

  const graphPack = url.tab === 'graph' ? pack : null;
  const historyPack = url.tab === 'history' ? pack : null;
  // A pack whose skills failed to load has nothing to list; the stage says why.
  const packFailed = snapshot.isError && !snapshot.data;

  // The pack this page reads, in the app's top bar beside the page's
  // other context.
  const packScope = (
    <MattstackShell.AppBar>
      {org && (
        <>
          <OrgPill org={org} />
          {pack && <ScopeSlash />}
        </>
      )}
      {packs.length > 1 && pack && teamPacks.length > 0 && (
        // A team's pack carries the team's name, so this is settings' own
        // team menu over the team packs: picking your team (null) reads yours.
        <TeamMenu
          teams={teamPacks}
          owners={viewer?.owners ?? {}}
          ownTeam={viewer?.team ?? null}
          team={teamPacks.includes(pack) ? pack : null}
          onPick={team =>
            patch({ pack: team ?? viewer?.team ?? teamPacks[0] ?? pack })
          }
        />
      )}
      {packs.length === 1 && pack && (
        <Group gap={7} wrap="nowrap" data-testid="pack-name">
          <Icons.package size={14} />
          <Text fz={14} fw={500} maw={168} truncate title={pack}>
            {pack}
          </Text>
        </Group>
      )}
      {pack && base && (
        <Badge
          size="sm"
          variant="card-outline"
          title={`This pack's fills and shared attachments come partly from the org's ${base.name} base pack.`}
          data-testid="pack-extends"
        >
          {`extends ${base.name}`}
        </Badge>
      )}
    </MattstackShell.AppBar>
  );

  const devSwitch = packs.length > 1 && devPacks.length > 0 && (
    <MattstackShell.AppBar side="end">
      <DevPackSwitch
        packs={devPacks}
        pack={pack}
        onPick={dev =>
          patch({
            pack: dev ?? viewer?.team ?? teamPacks[0] ?? pack,
          })
        }
      />
    </MattstackShell.AppBar>
  );

  const actions = packDir && (
    <Button
      size="compact-sm"
      variant="default"
      component="a"
      href={editorHref(packDir)}
      leftSection={<Icons.package size={13} />}
      data-testid="open-pack"
    >
      Open pack
    </Button>
  );

  return (
    <>
      {packScope}
      {devSwitch}
      <ContentReadyContext.Provider value={markReady}>
        <PageShell
          tabBarHeight={PAGE_ROW_HEIGHT}
          sidebarWidth={historyPack && !packFailed ? commitsWidth : 296}
          drawerStateKey="console-wiring-focus"
          tabs={tabs}
          tabBar={{ title: 'Packs', actions }}
        >
          {graphPack && !packFailed && (
            <PageShell.Sidebar hideCollapseButton bg="var(--tk-panel)">
              <GraphTabSidebar pack={graphPack} />
            </PageShell.Sidebar>
          )}
          {historyPack && !packFailed && (
            <PageShell.Sidebar hideCollapseButton bg="var(--tk-card)">
              <div style={{ position: 'relative', minHeight: '100%' }}>
                <HistorySidebar pack={historyPack} />
                <PaneResizer
                  width={commitsWidth}
                  onWidth={setCommitsWidth}
                  bounds={COMMITS_PANE}
                  label="Resize the commit list"
                  style={{ right: 0 }}
                  testId="commits-resizer"
                />
              </div>
            </PageShell.Sidebar>
          )}
          <PageShell.Main>
            {pack && url.tab !== 'history' && (
              <UnsyncedToast
                key={pack}
                pack={pack}
                ready={contentReady && unsynced.known}
                onReview={reviewChanges}
              />
            )}
            {graphPack ? (
              <PageShell.Content
                bg="var(--tk-card)"
                contentContainer={false}
                topNotch={notch}
              >
                {height => <GraphTab pack={graphPack} height={height} />}
              </PageShell.Content>
            ) : historyPack && !packFailed ? (
              <PageShell.Content bg="var(--tk-card)" contentContainer={false}>
                {height => <HistoryMain pack={historyPack} height={height} />}
              </PageShell.Content>
            ) : (
              <PageShell.Content topNotch={notch}>
                {packsQuery.isError ? (
                  <GenericError
                    title="Couldn't load skills packs"
                    message={(packsQuery.error as Error).message}
                    onRetry={() => void packsQuery.refetch()}
                  />
                ) : !pack ? (
                  packsQuery.isPending ? (
                    <StepLoader
                      testId="packs-loading"
                      steps={['rt skills packs']}
                    />
                  ) : (
                    <Text size="sm" c={text.dimmed} data-testid="no-packs">
                      No skills packs found.
                    </Text>
                  )
                ) : (
                  <ConfigTab pack={pack} onReview={reviewChanges} />
                )}
              </PageShell.Content>
            )}
          </PageShell.Main>
        </PageShell>
      </ContentReadyContext.Provider>
    </>
  );
}
