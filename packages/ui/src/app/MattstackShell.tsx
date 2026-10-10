import {
  Children,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

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
import { ShellAppBarContext, ShellRailContext } from './shell-context';

export const MATTSTACK_HEADER_HEIGHT = 48;

/** ActionIcon size for top-bar icon buttons: Mantine's `compact-sm` Button
 *  height, so an icon sits level with the header's text buttons. A number,
 *  because `--button-height-compact-sm` is scoped to Button and does not
 *  resolve on an ActionIcon. */
export const MATTSTACK_HEADER_ICON_SIZE = 26;

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

/** Read by `partition`, which only sees direct children: `MattstackShell.Header`
 *  must be written directly inside `MattstackShell`, never in a fragment or a
 *  wrapper component. Renders nothing where it is written. */
const HeaderSlot: (props: MattstackShellHeaderProps) => null = () => null;

export interface MattstackShellAppBarProps {
  /** `start` follows the page context (a scope picker); `end` sits before
   *  the header actions (who you are). @default 'start' */
  side?: 'start' | 'end';
  children: ReactNode;
}

/** Puts a page's own controls in the top bar from wherever the page renders
 *  them, so the page keeps its state and the bar shows it. Outside a
 *  `MattstackShell` they render in place. */
function AppBar({ side = 'start', children }: MattstackShellAppBarProps) {
  const targets = useContext(ShellAppBarContext);
  // Outside a shell (a test, a story, an embed) the controls render where
  // the page wrote them, so they are still there to use.
  if (targets === null) return <>{children}</>;
  const target = targets[side];
  return target ? createPortal(children, target) : null;
}

export interface MattstackShellProps {
  name: string;
  /** 30px works with the wordmark recipe; the app owns the artwork. */
  mark?: ReactNode;
  headerHeight?: number;
  /** `false` drops the rail for a single-page app: the page takes the full
   *  width and the colour-scheme control moves to the top bar's right end.
   *  @default true */
  rail?: boolean;
  railLabel?: string;
  /** This app's deck registry name. When set, the header shows the shared
   *  app launcher marking this app as current. */
  appName?: string;
  /** Override the launcher's derived deck base URL (dev, custom domain). */
  deckBase?: string;
  /** Puts `mark` in the rail's top spot, in place of the expand trigger,
   *  and leaves the top bar to the page's own controls: no mark and no app
   *  name there. Needs the rail. @default false */
  markInRail?: boolean;
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
  rail: withRail = true,
  railLabel = 'App sections',
  appName,
  deckBase,
  markInRail = false,
  children,
}: MattstackShellProps) {
  const rail = useRailState();
  const headerProps = useHeaderProps();
  const [appBarStart, setAppBarStart] = useState<HTMLElement | null>(null);
  const [appBarEnd, setAppBarEnd] = useState<HTMLElement | null>(null);
  const { rail: railSlot, railBottom, header, page } = partition(children);
  const expanded = withRail && rail.effectiveExpanded;
  const railMark = withRail && markInRail;
  const strayRailChildren =
    !withRail && (railSlot != null || railBottom != null);
  useEffect(() => {
    if (import.meta.env.DEV && strayRailChildren)
      console.warn(
        `MattstackShell "${name}": rail={false} renders no rail, so its MattstackShell.Rail and MattstackShell.RailBottom children are dropped.`
      );
  }, [name, strayRailChildren]);
  return (
    <ShellRailContext.Provider value={{ expanded, close: rail.close }}>
      <ShellAppBarContext.Provider
        value={{ start: appBarStart, end: appBarEnd }}
      >
        <RailShell
          headerHeight={headerHeight}
          headerProps={headerProps}
          header={
            <Group justify="space-between" w="100%" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" miw={0}>
                {!railMark && mark}
                {header?.children ??
                  (railMark ? null : (
                    <Text
                      fw={700}
                      fz={15}
                      lh={1}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {name}
                    </Text>
                  ))}
                <div ref={setAppBarStart} style={{ display: 'contents' }} />
              </Group>
              <Group gap="md" wrap="nowrap">
                <div ref={setAppBarEnd} style={{ display: 'contents' }} />
                {header?.actions}
                {!withRail && (
                  <ColorSchemeControl
                    variant="button"
                    size={MATTSTACK_HEADER_ICON_SIZE}
                    iconSize={16}
                  />
                )}
                {appName && (
                  <AppLauncher currentApp={appName} deckBase={deckBase} />
                )}
              </Group>
            </Group>
          }
          rail={
            withRail ? (
              <Rail
                label={railLabel}
                top={railMark ? mark : undefined}
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
            ) : null
          }
          railExpanded={expanded}
          railOpened={rail.opened}
          onToggleRail={rail.toggleOpened}
          onCloseRail={rail.close}
        >
          {page}
        </RailShell>
      </ShellAppBarContext.Provider>
    </ShellRailContext.Provider>
  );
}

export const MattstackShell = /* @__PURE__ */ Object.assign(Shell, {
  Rail: RailSlot,
  RailBottom: RailBottomSlot,
  Header: HeaderSlot,
  AppBar,
});
