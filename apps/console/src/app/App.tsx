import { Component, type ReactNode } from 'react';
import { MattstackShell } from '@mattstack/app-kit/app';
import { GenericError, PageShell } from '@mattstack/app-kit/core';
import { RailLink } from '@mattstack/app-kit/router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Redirect, useLocation } from 'wouter';

import { SHELL_HEADER_HEIGHT } from './chrome';
import { GateRedirect } from './gates/GateRedirect';
import { NotFoundPage } from './NotFoundPage';
import { ConsolePalette } from './palette/ConsolePalette';
import { createQueryClient } from './queryClient';
import { useAppRoute, type AppRoute } from './routes';
import { RunDetail } from './runs/RunDetail';
import { RunsPage } from './runs/runs-page/RunsPage';
import { RunSearch } from './runs/RunSearch';
import { explainHref } from './settings/explainParam';
import { SettingsEmbed } from './settings/SettingsEmbed';
import { SettingsPage } from './settings/SettingsPage';
import { WiringMap } from './wiring/WiringMap';
import { WiringRailEntry } from './wiring/WiringRailEntry';

const queryClient = createQueryClient();

type ConsoleSection = 'runs' | 'search' | 'wiring' | 'settings';

function chromeSection(route: AppRoute): ConsoleSection | null {
  if (route.name === 'search') return 'search';
  if (route.name === 'wiring') return 'wiring';
  if (route.name === 'settings' || route.name === 'config') return 'settings';
  if (route.name === 'not-found') return null;
  return 'runs';
}

/**
 * Mantine has no error boundary of its own, and a suspense query (run
 * detail) throws on failure -- one boundary here keeps a bad query from
 * blanking the whole console instead of just its route.
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <GenericError
          title="This page hit a snag"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

function RouteContent({ route }: { route: AppRoute }) {
  switch (route.name) {
    case 'board':
      return <RunsPage />;
    case 'run':
      return <RunDetail repo={route.repo} runId={route.runId} />;
    case 'gate':
      return <GateRedirect id={route.id} />;
    case 'search':
      return <RunSearch />;
    case 'wiring':
      return <WiringMap />;
    case 'settings':
      return <SettingsPage />;
    case 'settings-embed':
      return <SettingsEmbed group={route.group} />;
    case 'config':
      return <Redirect to={explainHref(route.key)} replace />;
    case 'not-found':
      return (
        <PageShell>
          <NotFoundPage />
        </PageShell>
      );
  }
}

export function App() {
  const [path] = useLocation();
  const route = useAppRoute();
  const section = chromeSection(route);

  // Framed by another app: no shell, no palette, only the group itself.
  if (route.name === 'settings-embed')
    return (
      <QueryClientProvider client={queryClient}>
        <RouteErrorBoundary key={path}>
          <RouteContent route={route} />
        </RouteErrorBoundary>
      </QueryClientProvider>
    );

  return (
    <QueryClientProvider client={queryClient}>
      {/* One instance for the whole app: its own ⌘K shortcut and its own
          search input, which already owns keyboard focus while open -- the
          detail view's single-key copies never see those keys. */}
      <ConsolePalette />
      <MattstackShell
        name="console"
        headerHeight={SHELL_HEADER_HEIGHT}
        mark={
          <img
            src="/favicon.svg"
            alt=""
            width={30}
            height={30}
            style={{ display: 'block', flex: 'none' }}
          />
        }
      >
        <MattstackShell.Rail>
          <RailLink
            icon="layers"
            label="Runs"
            href="/"
            active={section === 'runs'}
          />
          <RailLink
            icon="search"
            label="Search"
            href="/search"
            active={section === 'search'}
          />
          <WiringRailEntry active={section === 'wiring'} />
          <RailLink
            icon="settings"
            label="Settings"
            href="/settings"
            active={section === 'settings'}
          />
        </MattstackShell.Rail>
        {/* Keyed on path: without a remount, an error caught on one route
            would keep showing the fallback after navigating to another. */}
        <RouteErrorBoundary key={path}>
          <RouteContent route={route} />
        </RouteErrorBoundary>
      </MattstackShell>
    </QueryClientProvider>
  );
}
