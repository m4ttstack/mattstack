import {
  readInstalledEnvironment,
  readInstalledProgramArguments,
  readInstalledWorkingDirectory,
} from './launchd.ts';
import type { ServiceSpec } from './manager.ts';
import { renderedEnvironment } from './plist.ts';

function sameEnvironment(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k])
  );
}

export function installedMatches(label: string, spec: ServiceSpec): boolean {
  const installed = readInstalledProgramArguments(label);
  const installedEnv = readInstalledEnvironment(label);
  return (
    installed !== null &&
    installed.length === spec.programArguments.length &&
    installed.every((a, i) => a === spec.programArguments[i]) &&
    readInstalledWorkingDirectory(label) === spec.workingDirectory &&
    installedEnv !== null &&
    sameEnvironment(installedEnv, renderedEnvironment(spec))
  );
}
