import { useEffect, useRef, useState } from 'react';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsSyncContext } from './SettingsSyncProvider';
import {
  useSettingsOrg,
  useSettingsRepo,
  useSettingsTeam,
  useSettingsViewTeam,
  type ConsoleStore,
} from './useConsoleSettings';
import { followUpFor, type FollowUp, type SaveRecord } from './useSettingsSync';
import { targetAt, writeTarget, type WriteTarget } from './view';

export type RowStore = Pick<ConsoleStore, 'set' | 'unset' | 'move'>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

const SAVED_FLASH_MS = 1400;

/** Save-on-commit, no staging: `undefined` means "clear this layer". A
    write with no repo passes no repo argument at all. */
export function useRowSave(store: RowStore, def: SettingDefWire) {
  const repo = useSettingsRepo();
  const viewTeam = useSettingsViewTeam();
  const ownTeam = useSettingsTeam();
  const org = useSettingsOrg();
  const sync = useSettingsSyncContext();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveRecord | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const storeOf = (t: WriteTarget | null): string | null => {
    if (t?.scope === 'org') return 'org';
    const team = viewTeam ?? ownTeam;
    if (t?.scope === 'team' && team) return `team:${team}`;
    return null;
  };

  // Org and team saves go out at once instead of after the daemon's push delay.
  const pushAfter = async (t: WriteTarget | null) => {
    const shared = storeOf(t);
    if (shared === null || org === null || sync === null) {
      setSaved(null);
      return;
    }
    setSaved({
      key: def.key,
      store: shared,
      at: Date.now(),
      ...(t?.repo ? { repo: t.repo } : {}),
    });
    setPushError(null);
    setPushing(true);
    const err = await sync.push(org);
    setPushing(false);
    setPushError(err);
  };

  const run = async (
    op: () => Promise<string | null>,
    t: WriteTarget | null
  ) => {
    setStatus('saving');
    setError(null);
    const err = await op();
    if (err) {
      setStatus('idle');
      setError(err);
      return false;
    }
    setStatus('saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), SAVED_FLASH_MS);
    void pushAfter(t);
    return true;
  };

  const setTo = (t: WriteTarget, value: unknown) =>
    t.repo === undefined
      ? store.set(def.key, t.scope, value)
      : store.set(def.key, t.scope, value, t.repo);
  const unsetAt = (t: WriteTarget) =>
    t.repo === undefined
      ? store.unset(def.key, t.scope)
      : store.unset(def.key, t.scope, t.repo);
  const at = (layer: string) => {
    const t = targetAt(layer, repo);
    return t ?? `${layer} is not a writable layer here`;
  };

  const sharedOf = (...layers: string[]): WriteTarget | null =>
    layers.map(layer => targetAt(layer, repo)).find(t => storeOf(t) !== null) ??
    null;

  let followUp: FollowUp | null = null;
  if (saved !== null) {
    const later = followUpFor(
      sync?.orgs.find(o => o.org === org),
      saved
    );
    if (pushing) followUp = 'pushing';
    else if (pushError !== null && (later === 'saved' || later === 'pushing'))
      followUp = { stuck: 'push-failed', detail: pushError };
    else followUp = later;
  }

  // Another team's view takes writes only on the shared layers.
  const target = writeTarget(def, repo, viewTeam !== null);
  return {
    status,
    error,
    target,
    followUp,
    save: (value: unknown) =>
      run(
        () => (value === undefined ? unsetAt(target) : setTo(target, value)),
        target
      ),
    setAt: (layer: string, value: unknown) =>
      run(
        async () => {
          const t = at(layer);
          return typeof t === 'string' ? t : setTo(t, value);
        },
        targetAt(layer, repo)
      ),
    clear: (layer: string) =>
      run(
        async () => {
          const t = at(layer);
          return typeof t === 'string' ? t : unsetAt(t);
        },
        targetAt(layer, repo)
      ),
    move: (from: string, to: string) =>
      run(() => store.move(def.key, from, to), sharedOf(to, from)),
  };
}
