import { getDef, getSetting } from '@mattstack/rt-client';
import { warnStoreFallback } from './settings-fallback-warn.ts';

type GetSettingFn = typeof getSetting;

/**
 * Which forge a repo's remote points at, and where that forge lives.
 *
 * gitq used to answer both questions with a constant: `createProvider('gitlab',
 * 'https://gitlab.com', ...)`. That made it not merely GitLab-only but
 * gitlab.com-only, since the base URL the SDK accepts was thrown away too.
 * Reading the host off the remote answers both, and self-hosted instances of
 * either forge come along with it.
 */

export const FORGE_SLUGS = ['gitlab', 'github'] as const;
export type ForgeSlug = (typeof FORGE_SLUGS)[number];

/** A `gitq.forges` entry, keyed by remote host. */
export interface ForgeOverride {
  provider: ForgeSlug;
  /** Where the instance lives. Defaults to `https://<host>`. */
  baseUrl?: string;
  /** Env var holding this instance's token, for a host whose credential is not the forge default. */
  tokenEnv?: string;
}

export type ForgeOverrides = Record<string, ForgeOverride>;

export interface ResolvedForge {
  slug: ForgeSlug;
  /** The user-facing instance URL, which is what the SDK's providers take. */
  baseUrl: string;
  /** The remote host this was resolved from, for error messages and token lookup. */
  host: string;
  tokenEnv: string | null;
}

/** The hosts that identify a forge on their own, with nothing configured. */
const KNOWN_HOSTS: Record<string, ForgeSlug> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
};

/**
 * The forge at `host`, or null when nothing identifies one.
 *
 * Null is not a failure to be defaulted away: an unrecognised host that
 * silently became GitLab would send an enterprise GitHub instance down the
 * GitLab API and fail somewhere far from the cause. Callers turn it into an
 * error naming the host and pointing at the override.
 *
 * @throws when an override entry is present but unusable, which is a
 * configuration mistake worth reporting rather than skipping into "unknown".
 */
export function resolveForge(host: string, overrides: ForgeOverrides = {}): ResolvedForge | null {
  const wanted = host.toLowerCase();
  const entry = Object.entries(overrides).find(([key]) => key.toLowerCase() === wanted);

  if (entry) {
    const [key, override] = entry;
    if (!isForgeSlug(override.provider)) {
      throw new Error(
        `forges["${key}"].provider is "${override.provider}"; it must be one of ${FORGE_SLUGS.join(', ')}`,
      );
    }
    // A single-label host is an ssh alias, and "https://work" is not an
    // instance. Only a real domain can stand in for its own base URL.
    if (!override.baseUrl && !wanted.includes('.')) {
      throw new Error(`forges["${key}"] needs a baseUrl: "${key}" is an ssh alias, not a host the forge answers on`);
    }
    return {
      slug: override.provider,
      baseUrl: (override.baseUrl ?? `https://${wanted}`).replace(/\/+$/, ''),
      host: wanted,
      tokenEnv: override.tokenEnv ?? null,
    };
  }

  const known = KNOWN_HOSTS[wanted];
  return known ? { slug: known, baseUrl: `https://${wanted}`, host: wanted, tokenEnv: null } : null;
}

function isForgeSlug(value: unknown): value is ForgeSlug {
  return typeof value === 'string' && (FORGE_SLUGS as readonly string[]).includes(value);
}

/**
 * The `gitq.forges` map. Every entry is validated lazily, in resolveForge. A
 * resolver throw (an unreadable store file, never the daemon) reads the empty
 * default after one warning.
 */
export async function readForgeOverrides(resolve: GetSettingFn = getSetting): Promise<ForgeOverrides> {
  try {
    return resolve<ForgeOverrides>('gitq.forges').value as ForgeOverrides;
  } catch (err) {
    warnStoreFallback('gitq.forges', 'no overrides', err);
    return structuredClone(getDef('gitq.forges')!.default) as ForgeOverrides;
  }
}
