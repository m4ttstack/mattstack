import { useShellRail } from '@mattstack/app-kit/app';
import { RailEntry } from '@mattstack/app-kit/core';
import { useLinks } from './useLinks';

/** `RailLink` routes through wouter, so an entry that leaves the app is a bare `RailEntry` anchor. */
export function SettingsRailEntry() {
  const { console: consoleUrl } = useLinks();
  const rail = useShellRail();
  return (
    <RailEntry
      component="a"
      href={`${consoleUrl}/settings#boxscore`}
      target="_blank"
      rel="noreferrer"
      icon="settings"
      label="Settings"
      expanded={rail.expanded}
      onClick={rail.close}
    />
  );
}
