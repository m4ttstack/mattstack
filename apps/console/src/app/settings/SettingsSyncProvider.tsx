import { createContext, useContext, type ReactNode } from 'react';

import type { OrgSync } from '../../shared/settings-sync';
import { useRunEvents } from '../runs/useRuns';
import { usePushSettings, useSettingsSync } from './useSettingsSync';

export interface SettingsSyncValue {
  orgs: OrgSync[];
  push: (org: string) => Promise<string | null>;
}

/** Null outside a page that provides it: a row there saves without pushing or following up. */
export const SettingsSyncContext = createContext<SettingsSyncValue | null>(
  null
);

export function useSettingsSyncContext(): SettingsSyncValue | null {
  return useContext(SettingsSyncContext);
}

/** One sync query and one socket for the whole page, however many rows read it. */
export function SettingsSyncProvider({ children }: { children: ReactNode }) {
  useRunEvents();
  const { orgs } = useSettingsSync();
  const { push } = usePushSettings();
  return (
    <SettingsSyncContext.Provider value={{ orgs, push }}>
      {children}
    </SettingsSyncContext.Provider>
  );
}
