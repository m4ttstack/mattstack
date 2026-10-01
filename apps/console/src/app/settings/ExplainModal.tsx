import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Divider,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import classes from './ExplainModal.module.css';
import {
  KeyPanel,
  Suggested,
  type PanelStore,
  type PanelTab,
} from './KeyPanel';
import { useRowParts, ValueContent } from './rowParts';
import { ScopeBadge } from './ScopeBadge';
import {
  SettingsTeamContext,
  useConsoleSettings,
  type ConsoleStore,
} from './useConsoleSettings';
import { useRowSave } from './useRowSave';
import { badgeScope, ESCAPE_OWNERS, splitKey } from './view';

export type ExplainStore = Pick<
  ConsoleStore,
  'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move' | 'prune'
>;

const MODAL_WIDTH = 760;

function notifying(store: PanelStore, onChanged?: () => void): PanelStore {
  if (!onChanged) return store;
  const then = (err: string | null) => {
    onChanged();
    return err;
  };
  return {
    set: (...a: Parameters<PanelStore['set']>) => store.set(...a).then(then),
    unset: (...a: Parameters<PanelStore['unset']>) =>
      store.unset(...a).then(then),
    move: (...a: Parameters<PanelStore['move']>) => store.move(...a).then(then),
    prune: (...a: Parameters<PanelStore['prune']>) =>
      store.prune(...a).then(then),
  };
}

function Header({
  settingKey,
  def,
}: {
  settingKey: string;
  def?: SettingDefWire;
}) {
  const { text } = useSchemeColors();
  const [ns, name] = splitKey(settingKey);
  const scope = def ? badgeScope(def, null) : null;
  return (
    <Modal.Header>
      <Stack gap={4} className={classes.head}>
        <Group gap={8} wrap="nowrap">
          <Modal.Title>
            <Text span fz={15} ff="monospace">
              <Text span inherit c={text.muted}>
                {ns}
              </Text>
              <Text span inherit fw={500}>
                {name}
              </Text>
            </Text>
          </Modal.Title>
          {scope && <ScopeBadge scope={scope} />}
          <Tooltip label="Close">
            <Modal.CloseButton ml="auto" aria-label="Close modal" />
          </Tooltip>
        </Group>
        {def && (
          <Text fz={12} c={text.muted}>
            {def.description}
          </Text>
        )}
      </Stack>
    </Modal.Header>
  );
}

function WriteState({ row }: { row: ReturnType<typeof useRowSave> }) {
  const { text } = useSchemeColors();
  if (row.status === 'idle' && !row.error) return null;
  return (
    <Stack gap={4} px={8}>
      {row.status === 'saving' && (
        <Text fz={12} c={text.muted}>
          saving…
        </Text>
      )}
      {row.status === 'saved' && (
        <Group gap={4} wrap="nowrap">
          <Text fz={12} c="var(--tk-text-ok-small)">
            saved
          </Text>
          <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
        </Group>
      )}
      {row.error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
          {row.error}
        </Text>
      )}
    </Stack>
  );
}

function Detail({
  def,
  store,
  suggestions,
  fix,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  suggestions?: string[];
  fix?: string | null;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const writes = useMemo(() => notifying(store, onChanged), [store, onChanged]);
  const row = useRowSave(writes, def);
  const [asJson, setAsJson] = useState(false);
  const [tab, setTab] = useState<PanelTab>('where');
  const parts = useRowParts(def, row, {
    suggestions,
    open: true,
    onToggle: () => {},
    asJson,
    setAsJson,
  });
  return (
    <KeyPanel
      def={def}
      store={store}
      tab={tab}
      onTab={setTab}
      value={
        <Stack gap={10}>
          <ValueContent def={def} parts={parts} />
          <WriteState row={row} />
        </Stack>
      }
      fix={fix}
      onChanged={onChanged}
      onPickRepo={onPickRepo}
    />
  );
}

function Resolved({
  settingKey,
  store,
  fix,
  onChanged,
  onPickRepo,
}: {
  settingKey: string;
  store: ExplainStore;
  fix?: string | null;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const def = store.defs.find(d => d.key === settingKey);
  return (
    <>
      <Header settingKey={settingKey} def={def} />
      <Divider />
      <Modal.Body pt="md">
        {def ? (
          <Suggested settingKey={def.key}>
            {suggestions => (
              <Detail
                key={def.key}
                def={def}
                store={store}
                suggestions={suggestions}
                fix={fix}
                onChanged={onChanged}
                onPickRepo={onPickRepo}
              />
            )}
          </Suggested>
        ) : store.error ? (
          <Alert color="bad" variant="light">
            <Text fz={12}>{store.error}</Text>
          </Alert>
        ) : store.loading ? (
          <Stack gap={10}>
            <Skeleton h={36} />
            <Skeleton h={36} />
            <Skeleton h={36} />
          </Stack>
        ) : (
          <Text fz={14} c={text.muted}>
            {`No setting named ${settingKey} is registered.`}
          </Text>
        )}
      </Modal.Body>
    </>
  );
}

/** Loads just this key, for pages with no settings store of their own. */
function OwnStore(props: {
  settingKey: string;
  fix?: string | null;
  onChanged?: () => void;
}) {
  const store = useConsoleSettings(null, props.settingKey);
  return (
    <SettingsTeamContext.Provider value={store.team}>
      <Resolved {...props} store={store} />
    </SettingsTeamContext.Provider>
  );
}

/** Keeps the last open key through the close transition, so the modal
    fades out with its content instead of emptying first. */
function useLastKey(key: string | null): string | null {
  const last = useRef(key);
  if (key !== null) last.current = key;
  return last.current;
}

/** One key's panel over another page (run detail). With a `store`, writes
    land in the caller's store; without one it loads the key itself and
    reports writes through `onChanged`. */
export function ExplainModal({
  settingKey,
  store,
  fix,
  onClose,
  onChanged,
  onPickRepo,
}: {
  settingKey: string | null;
  store?: ExplainStore;
  fix?: string | null;
  onClose: () => void;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const key = useLastKey(settingKey);
  const opened = settingKey !== null;
  // Mantine's own Escape fires first, from any focused field or open menu;
  // there Escape abandons the edit or closes the menu, not the modal.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(ESCAPE_OWNERS)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, onClose]);

  return (
    <Modal.Root
      opened={opened}
      onClose={onClose}
      closeOnEscape={false}
      size={MODAL_WIDTH}
      centered
      padding="lg"
    >
      <Modal.Overlay />
      <Modal.Content>
        {key !== null &&
          (store ? (
            <Resolved
              settingKey={key}
              store={store}
              fix={fix}
              onChanged={onChanged}
              onPickRepo={onPickRepo}
            />
          ) : (
            <OwnStore settingKey={key} fix={fix} onChanged={onChanged} />
          ))}
      </Modal.Content>
    </Modal.Root>
  );
}
