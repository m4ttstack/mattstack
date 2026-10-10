import { LABEL_PREFIX } from '../services/manager.ts';

const LIVE_SEGMENT = '.live.';

export function liveLabelPrefix(name: string): string {
  return `${LABEL_PREFIX}${name}${LIVE_SEGMENT}`;
}

export function liveLabel(name: string, id: string): string {
  return `${liveLabelPrefix(name)}${id}`;
}

export function isLiveLabel(label: string): boolean {
  return label.startsWith(LABEL_PREFIX) && label.includes(LIVE_SEGMENT);
}
