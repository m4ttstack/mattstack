import type { UserConfig } from 'vite';

export interface MattstackViteOptions {
  /** The Bun/Hono server's port; the dev proxy forwards /api and /ws to it.
      `SERVER_PORT` in the environment wins, which is how deck's live mode
      points the proxy at the app's server. */
  apiPort: number;
  /** @default true */
  proxy?: boolean;
  /** Additional `codeSplitting.groups`, matched before the kit's. */
  extraGroups?: { name: string; test: RegExp }[];
}

export function mattstackVite(opts: MattstackViteOptions): UserConfig;
