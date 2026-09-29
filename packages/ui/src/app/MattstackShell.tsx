import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  Group,
  Rail,
  RailShell,
  Text,
  useRailState,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { AppLauncher } from './AppLauncher';
import { ColorSchemeControl } from './ColorSchemeControl';
import { ShellRailContext } from './shell-context';

export const MATTSTACK_HEADER_HEIGHT = 48;

function RailSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
function RailBottomSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export interface MattstackShellHeaderProps {
  /** Page context (a breadcrumb, say), shown after the mark in place of the app name. */
  children?: ReactNode;
  /** Right-aligned header actions, placed before the app launcher. */
  actions?: ReactNode;
}

/** Read by `partition`; renders nothing where it is written. */
const HeaderSlot: (props: MattstackShellHeaderProps) => null = () => null;

export interface MattstackShellProps {
  name: string;
  /** 30px works with the wordmark recipe; the app owns the artwork. */
  mark?: ReactNode;
  headerHeight?: number;
  railLabel?: string;
  /** This app's deck registry name. When set, the header shows the shared
   *  app launcher marking this app as current. */
  appName?: string;
  /** Override the launcher's derived deck base URL (dev, custom domain). */
  deckBase?: string;
  children: ReactNode;
}

function partition(children: ReactNode) {
  let rail: ReactElement | undefined;
  let railBottom: ReactElement | undefined;
  let header: MattstackShellHeaderProps | undefined;
  const page: ReactNode[] = [];
  Children.forEach(children, child => {
    if (isValidElement(child) && child.type === RailSlot) rail = child;
    else if (isValidElement(child) && child.type === RailBottomSlot)
      railBottom = child;
    else if (isValidElement(child) && child.type === HeaderSlot)
      header = child.props as MattstackShellHeaderProps;
    else page.push(child);
  });
  return { rail, railBottom, header, page };
}

/**
 * The header surface: a translucent take on bg.level2 so the backdrop blur
 * reads as depth while staying scheme-aware.
 */
function useHeaderProps() {
  const { bg } = useSchemeColors();
  return {
    style: {
      backgroundColor: `color-mix(in srgb, ${bg.level2} 88%, transparent)`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    },
  } as const;
}

function Shell({
  name,
  mark,
  headerHeight = MATTSTACK_HEADER_HEIGHT,
  railLabel = 'App sections',
  appName,
  deckBase,
  children,
}: MattstackShellProps) {
  const rail = useRailState();
  const headerProps = useHeaderProps();
  const { rail: railSlot, railBottom, header, page } = partition(children);
  const expanded = rail.effectiveExpanded;
  return (
    <ShellRailContext.Provider value={{ expanded, close: rail.close }}>
      <RailShell
        headerHeight={headerHeight}
        headerProps={headerProps}
        header={
          <Group justify="space-between" w="100%" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" miw={0}>
              {mark}
              {header?.children ?? (
                <Text fw={700} fz={22} lh={1} style={{ whiteSpace: 'nowrap' }}>
                  {name}
                </Text>
              )}
            </Group>
            <Group gap="md" wrap="nowrap">
              {header?.actions}
              {appName && (
                <AppLauncher currentApp={appName} deckBase={deckBase} />
              )}
            </Group>
          </Group>
        }
        rail={
          <Rail
            label={railLabel}
            expanded={expanded}
            onToggleExpanded={rail.toggleExpanded}
            pinBottom={
              <>
                {railBottom}
                <ColorSchemeControl expanded={expanded} />
              </>
            }
          >
            {railSlot}
          </Rail>
        }
        railExpanded={expanded}
        railOpened={rail.opened}
        onToggleRail={rail.toggleOpened}
        onCloseRail={rail.close}
      >
        {page}
      </RailShell>
    </ShellRailContext.Provider>
  );
}

export const MattstackShell = /* @__PURE__ */ Object.assign(Shell, {
  Rail: RailSlot,
  RailBottom: RailBottomSlot,
  Header: HeaderSlot,
});
