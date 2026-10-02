import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Drawer,
  Loader,
  Modal,
  SegmentedControl,
  Switch,
  Tabs,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { modals, useModals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { useDrawerSurface } from '../../drawerSurface';
import type { SkillsCheck, SkillsComposition } from '../../outline';
import {
  guardedWrite,
  useSkillsApply,
  useSkillSource,
  type SkillsAnatomy,
} from '../../useWiring';
import {
  drawerContent,
  parseTarget,
  type DrawerContent,
  type DrawerTab,
  type DrawerTarget,
} from '../model/drawerContent';
import type { FocusGroups, FocusItem } from '../model/focusModel';
import type { TemplateView } from '../model/templateModel';
import { StatusDot } from '../StatusDot';
import type { WiringUrl, WiringView } from '../useWiringUrl';
import classes from './drawer.module.css';
import { DrawerMenu } from './DrawerMenu';
import { HistoryTab } from './HistoryTab';
import { RebindPanel } from './RebindPanel';
import { TextTab } from './TextTab';
import { UsedByTab } from './UsedByTab';
import { useDrawerMode } from './useDrawerMode';
import { useDrawerWrap } from './useDrawerWrap';

export const DRAWER_WIDTH = 760;

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';

/** Where a key belongs to what it was pressed in, not to the drawer. */
const OWN_KEYS = '[role="menu"], [data-own-keys]';

const VIEW_LABEL: Record<WiringView, string> = {
  template: 'Template',
  rendered: 'Rendered',
};

/** A skill's own file over its template, where the toggle says which face
    it shows, takes the boards' compiled-skill layout: a range chip and a
    source line, no kind badge and no tabs. */
function layersOf(content: DrawerContent) {
  return content.badge === null
    ? { root: 'Drawer · compiled skill', chip: 'range', sentence: 'd' }
    : { root: 'Drawer', chip: 'chip', sentence: 't' };
}

function tabLabel(tab: DrawerTab, usedBy: number | null): string {
  switch (tab) {
    case 'text':
      return 'Text';
    case 'used-by':
      return usedBy === null ? 'Used by' : `Used by · ${usedBy}`;
    case 'history':
      return 'History';
  }
}

/** The template row before or after the selected one, for the arrow keys. */
function steppedRow(
  target: DrawerTarget | null,
  view: TemplateView | null,
  step: -1 | 1
): string | null {
  if (!view || target?.kind !== 'row') return null;
  const at = view.rows.findIndex(row => row.line === target.line);
  const next = at === -1 ? undefined : view.rows[at + step];
  return next ? `row:${next.line}` : null;
}

/** Asks before a verb goes public or internal, then applies it. Going
    internal removes the skill's public copy, so that confirm is destructive.
    Results come from the promise, which settles after an unmount too. */
function usePublicSwitch(pack: string) {
  const { surfaceApply, writing } = useSkillsApply(pack);
  const queryClient = useQueryClient();
  const toggle = (skill: string, toPublic: boolean) => {
    if (writing) return;
    const next = toPublic ? 'public' : 'internal';
    modals.confirm({
      title: `Make ${skill} ${next}?`,
      destructive: !toPublic,
      message: toPublic
        ? `${skill} is compiled into skills/${skill}/, so it runs as a skill of its own. Nothing is shared until you sync.`
        : `skills/${skill}/ stops being compiled and is removed, so ${skill} no longer runs as a skill of its own. Nothing is shared until you sync.`,
      labels: { confirm: `Make ${next}` },
      onConfirm: () =>
        guardedWrite(queryClient, pack, () => {
          surfaceApply
            .mutateAsync(
              toPublic
                ? { toPublic: [skill], toInternal: [] }
                : { toPublic: [], toInternal: [skill] }
            )
            .then(result => {
              const failed = result.steps.find(step => !step.ok);
              if (failed) {
                notifications.error(failed.error ?? 'rt skills surface failed');
                return;
              }
              notifications.success(`${skill} is ${next}`);
            })
            .catch((error: Error) => notifications.error(error.message));
        }),
    });
  };
  return { toggle, writing };
}

/** What the drawer shows for the URL's selection; null keeps it shut. */
export function selectedContent(
  url: WiringUrl,
  view: TemplateView | null,
  anatomy: SkillsAnatomy | undefined
): DrawerContent | null {
  const target = parseTarget(url.select);
  return target && view && anatomy
    ? drawerContent(target, view, anatomy, url.view)
    : null;
}

/** Keeps the last value that was not null, so a closing drawer still shows
    what it held while it slides away. */
function useLastPresent<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value !== null) last.current = value;
  return value ?? last.current;
}

/**
 * The compiled-skill drawer: whatever the URL's `select` names on the
 * focused skill's canvas, read from its file. Closed when `select` names
 * nothing the view holds.
 */
export function SkillDrawer({
  pack,
  view,
  anatomy,
  composition,
  check,
  groups,
  pipeline,
  url,
  setUrl,
}: {
  pack: string;
  view: TemplateView | null;
  anatomy: SkillsAnatomy | undefined;
  composition: SkillsComposition | undefined;
  check: SkillsCheck | undefined;
  groups: FocusGroups | null;
  /** The pipeline the focused skill runs in, or leads. */
  pipeline: FocusItem | null;
  url: WiringUrl;
  setUrl: (patch: Partial<WiringUrl>) => void;
}) {
  const surface = useDrawerSurface();
  const [mode, setMode] = useDrawerMode();
  const [wrap, setWrap] = useDrawerWrap();
  const target = useMemo(() => parseTarget(url.select), [url.select]);
  const current = useMemo(
    () => selectedContent(url, view, anatomy),
    [url, view, anatomy]
  );
  const content = useLastPresent(current);
  const opened = current !== null;
  const close = () => setUrl({ select: null, rebind: false });
  const [menuOpened, setMenuOpened] = useState(false);
  // A confirm shuts on its own Escape, which then reaches the document too.
  const confirming = useModals().modals.length > 0;
  // A drawer shut by any route (Back, a new focus) unmounts the menu without
  // telling it, so it would come back open with the drawer's keys still off.
  useEffect(() => {
    if (!opened) setMenuOpened(false);
  }, [opened]);

  const step = (by: -1 | 1) => {
    const select = steppedRow(target, view, by);
    if (select) setUrl({ select });
  };
  // The menu closes on its own Escape before that key reaches the document,
  // so a key from inside the menu is the menu's even once it has shut.
  const drawerKey = (run: () => void) => (event: KeyboardEvent) => {
    if (!(event.target instanceof Element && event.target.closest(OWN_KEYS)))
      run();
  };
  useHotkeys(
    opened && !menuOpened && !confirming
      ? [
          ['Escape', drawerKey(close)],
          ['ArrowUp', drawerKey(() => step(-1))],
          ['ArrowDown', drawerKey(() => step(1))],
        ]
      : []
  );

  const source = useSkillSource(pack, content?.filePath ?? null);
  const publicSwitch = usePublicSwitch(pack);
  if (!content || !anatomy || !view) return null;

  const layers = layersOf(content);
  const tab: DrawerTab = content.tabs.includes(url.drawerTab)
    ? url.drawerTab
    : 'text';
  const card =
    target?.kind === 'input'
      ? view.inputs.find(input => input.id === target.id)
      : undefined;
  const meta =
    content.meta && card && source.data
      ? `${content.meta} · ${source.data.lines} lines`
      : content.meta;
  const slot = target?.kind === 'input' ? null : content.slot;
  const rebinding = slot !== null && url.rebind && composition !== undefined;
  const ownFile =
    content.filePath === anatomy.template.path ||
    content.filePath === anatomy.rendered.path;
  const verb = ownFile
    ? composition?.verbs.find(v => v.name === anatomy.skill)
    : undefined;

  const full = mode === 'full';
  const panel = (
    <>
      <Box
        className={classes.header}
        data-tabs={content.tabs.length > 1 || undefined}
        data-parity="header"
      >
        <div className={classes.row}>
          <Icon name="fileCode" size={16} color={MUTED} data-parity="i" />
          <Text
            ff="monospace"
            fz={14}
            lh="normal"
            c={BODY}
            truncate
            data-parity="file"
            data-testid="drawer-file"
          >
            {content.fileLabel}
          </Text>
          {content.badge && (
            <Badge
              variant="quiet"
              classNames={{ root: classes.kind }}
              data-parity="kind"
              attributes={{ label: { 'data-parity': 'l' } }}
            >
              {content.badge}
            </Badge>
          )}
          {verb && (
            <Switch
              size="xs"
              variant="contrast"
              label="public"
              checked={verb.public}
              disabled={publicSwitch.writing}
              thumbIcon={publicSwitch.writing ? <Loader size={8} /> : undefined}
              onChange={event =>
                publicSwitch.toggle(verb.name, event.currentTarget.checked)
              }
              classNames={{ root: classes.publicSwitch }}
            />
          )}
          <span className={classes.spacer} />
          {content.canToggle && tab === 'text' && (
            <SegmentedControl
              variant="quiet"
              radius={7}
              value={content.view}
              onChange={value => setUrl({ view: value as WiringView })}
              data={(['template', 'rendered'] as const).map(face => ({
                value: face,
                // The active label sits beside Mantine's indicator, not in it,
                // so only the indicator stands for the board's active segment.
                label:
                  face === content.view ? (
                    VIEW_LABEL[face]
                  ) : (
                    <span data-parity="l">{VIEW_LABEL[face]}</span>
                  ),
                disabled: face === 'rendered' && !anatomy.rendered.exists,
              }))}
              classNames={{
                root: classes.segmented,
                control: classes.segment,
                label: classes.segmentLabel,
              }}
              attributes={{
                indicator: {
                  'data-parity': `seg · ${VIEW_LABEL[content.view]}`,
                },
              }}
              data-parity="SegmentedControl"
              data-testid="drawer-view"
            />
          )}
          {tab === 'text' && (
            <Tooltip label="Wrap lines">
              <ActionIcon
                variant={wrap ? 'light' : 'soft-outline'}
                color={wrap ? 'accent' : undefined}
                radius={6}
                className={classes.more}
                aria-label="Wrap lines"
                aria-pressed={wrap}
                onClick={() => setWrap(!wrap)}
                data-testid="drawer-wrap"
              >
                <Icon name="wrapText" size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={full ? 'Back to the side panel' : 'Open full screen'}>
            <ActionIcon
              variant="soft-outline"
              radius={6}
              className={classes.more}
              aria-label={full ? 'Back to the side panel' : 'Open full screen'}
              onClick={() => setMode(full ? 'side' : 'full')}
              data-testid="drawer-mode"
            >
              <Icon name={full ? 'minimize' : 'maximize'} size={14} />
            </ActionIcon>
          </Tooltip>
          <DrawerMenu
            pack={pack}
            skill={anatomy.skill}
            filePath={content.filePath}
            opened={menuOpened}
            onChange={setMenuOpened}
          />
          <CloseButton
            onClick={close}
            aria-label="Close"
            className={classes.close}
            icon={<Icon name="close" size={16} data-parity="close" />}
          />
        </div>
        <div className={classes.row}>
          {content.dot && (
            <StatusDot
              tone={content.dot}
              size="md"
              data-parity="dot"
              data-testid="drawer-dot"
            />
          )}
          {content.chip && (
            <Badge
              variant="wash"
              color="accent"
              classNames={{ root: classes.chip }}
              data-parity={layers.chip}
              attributes={{ label: { 'data-parity': 'l' } }}
              data-testid="drawer-chip"
            >
              {content.chip}
            </Badge>
          )}
          <Text
            fz={12}
            lh="normal"
            c={MUTED}
            className={classes.sentence}
            data-parity={layers.sentence}
            data-testid="drawer-sentence"
          >
            {content.sentence}
          </Text>
          {slot && !rebinding && (
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<Icon name="replace" size={12} />}
              className={classes.change}
              onClick={() => setUrl({ rebind: true })}
            >
              {slot.bound ? 'Change' : 'Bind'}
            </Button>
          )}
        </div>
        {content.error && (
          <Alert variant="light" color="bad">
            <Text
              ff="monospace"
              fz={11}
              lh="normal"
              className={classes.errorText}
              data-testid="drawer-error"
            >
              {content.error}
            </Text>
          </Alert>
        )}
        {meta && (
          <Text
            ff="monospace"
            fz={10}
            lh="normal"
            c={MUTED}
            data-parity="src"
            data-testid="drawer-meta"
          >
            {meta}
          </Text>
        )}
        {content.tabs.length > 1 && (
          <Tabs
            value={tab}
            onChange={value =>
              value && setUrl({ drawerTab: value as DrawerTab })
            }
            color="accent"
          >
            <Tabs.List className={classes.tabs}>
              {content.tabs.map(name => {
                const label = tabLabel(name, card?.usedBy ?? null);
                const active = name === tab;
                return (
                  <Tabs.Tab
                    key={name}
                    value={name}
                    className={classes.tab}
                    data-parity={active ? `tab · ${label}` : undefined}
                  >
                    <Text
                      span
                      fz={12}
                      fw={500}
                      lh="normal"
                      c={active ? BODY : MUTED}
                      data-parity="l"
                    >
                      {label}
                    </Text>
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs>
        )}
      </Box>
      {rebinding && slot && (
        <RebindPanel
          key={`${anatomy.skill}:${slot.name}`}
          pack={pack}
          skill={anatomy.skill}
          skillRef={anatomy.template.ref}
          slot={slot.name}
          composition={composition}
          onDone={() => setUrl({ rebind: false })}
        />
      )}
      {tab === 'text' && (
        <TextTab
          pack={pack}
          content={content}
          beneathPanel={rebinding}
          wrap={wrap}
        />
      )}
      {tab === 'used-by' && content.usedBy && composition && groups && (
        <UsedByTab
          pack={pack}
          skill={anatomy.skill}
          slot={content.slot?.name ?? null}
          usedBy={content.usedBy}
          composition={composition}
          groups={groups}
          onFocus={focus => setUrl({ focus })}
        />
      )}
      {tab === 'history' && composition && (
        <HistoryTab
          file={content.usedBy ? content.filePath : null}
          pack={pack}
          anatomy={anatomy}
          composition={composition}
          check={check}
          pipeline={pipeline}
          onOpen={focus =>
            setUrl({ focus, select: 'output', drawerTab: 'history' })
          }
        />
      )}
    </>
  );
  const attributes = {
    content: {
      'data-parity': layers.root,
      'data-testid': 'skill-drawer',
      'data-mode': mode,
    },
  };

  return full ? (
    <Modal
      opened={opened}
      onClose={close}
      fullScreen
      closeOnEscape={false}
      withCloseButton={false}
      padding={0}
      transitionProps={{ transition: 'fade', duration: 150 }}
      styles={{ content: surface.panel }}
      classNames={{ content: classes.fullScreen, body: classes.body }}
      attributes={attributes}
    >
      {panel}
    </Modal>
  ) : (
    <Drawer
      opened={opened}
      onClose={close}
      position="right"
      size={DRAWER_WIDTH}
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      closeOnEscape={false}
      withCloseButton={false}
      padding={0}
      styles={surface}
      classNames={{ body: classes.body }}
      attributes={attributes}
    >
      {panel}
    </Drawer>
  );
}
