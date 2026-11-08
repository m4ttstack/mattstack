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
import { useIsMobile } from '@mattstack/app-kit/hooks';
import { AppLauncher } from './AppLauncher';
import { ColorSchemeControl } from './ColorSchemeControl';
import { HueControl, useAppHue, type AppHue } from './HueControl';
import { ShellAppBarContext, ShellRailContext } from './shell-context';

export const MATTSTACK_HEADER_HEIGHT = 48;

/** The gap the bar keeps around the page sheet. */
export const MATTSTACK_SHEET_INSET = 8;

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
   *  the header actions (a page's own switches); `viewer` (who you are)
   *  comes after `end`, so it holds its place whichever page is open,
   *  however late it mounts. @default 'start' */
  side?: 'start' | 'end' | 'viewer';
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
  /** The app's own colour for the bar, the sheet's tint and menu washes.
   *  The viewer can pick another per browser from the bar's palette menu.
   *  @default 'blue' */
  hue?: AppHue;
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

const HEADER_PROPS = { style: { borderBottom: 'none' } } as const;

function Shell({
  name,
  mark,
  headerHeight = MATTSTACK_HEADER_HEIGHT,
  rail: withRail = true,
  railLabel = 'App sections',
  appName,
  deckBase,
  markInRail = false,
  hue: appHue = 'blue',
  children,
}: MattstackShellProps) {
  const rail = useRailState();
  const isMobile = useIsMobile();
  const [hue, setHue] = useAppHue(name, appHue);
  const [appBarStart, setAppBarStart] = useState<HTMLElement | null>(null);
  const [appBarEnd, setAppBarEnd] = useState<HTMLElement | null>(null);
  const [appBarViewer, setAppBarViewer] = useState<HTMLElement | null>(null);
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
        value={{ start: appBarStart, end: appBarEnd, viewer: appBarViewer }}
      >
        <RailShell
          headerHeight={headerHeight}
          headerProps={HEADER_PROPS}
          headerPx={20}
          sheet={
            isMobile
              ? undefined
              : {
                  inset: MATTSTACK_SHEET_INSET,
                  left: withRail ? 0 : MATTSTACK_SHEET_INSET,
                }
          }
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
                      style={{ whiteSpace: 'nowrap', marginRight: 5 }}
                    >
                      {name}
                    </Text>
                  ))}
                <div ref={setAppBarStart} style={{ display: 'contents' }} />
              </Group>
              <Group gap="md" wrap="nowrap">
                <div ref={setAppBarEnd} style={{ display: 'contents' }} />
                <div ref={setAppBarViewer} style={{ display: 'contents' }} />
                {header?.actions}
                <HueControl
                  value={hue}
                  onChange={setHue}
                  size={MATTSTACK_HEADER_ICON_SIZE}
                  iconSize={16}
                />
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
