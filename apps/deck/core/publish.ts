import { getRecord, isMattstackOwned } from '../src/registry/records.ts';
import { getAppSettings } from './settings.ts';

export function isPublished(app: string): boolean {
  const record = getRecord(app);
  if (record && isMattstackOwned(record)) return false;
  return getAppSettings(app).published;
}
