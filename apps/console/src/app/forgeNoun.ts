import { parseIdentity } from '@mattstack/rt-client/identity';

export type Forge = 'github' | 'gitlab';

/** A remote identity's first segment is a host only when it has a dot;
    `remote:acme%2Fweb` names no host. */
function hostOf(hint: string): string | null {
  const raw = hint.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname.toLowerCase() || null;
    } catch {
      return null;
    }
  }
  const bang = raw.lastIndexOf('!');
  const identity = parseIdentity(bang === -1 ? raw : raw.slice(0, bang));
  if (identity?.kind !== 'remote') return null;
  const head = identity.id.split('/')[0]?.toLowerCase() ?? '';
  return head.includes('.') ? head : null;
}

/** The forge the first hint with a host names: a URL, a serialized repo
    identity, or an mrKey. Null when none of them names one. */
export function forgeOf(...hints: (string | null | undefined)[]): Forge | null {
  for (const hint of hints) {
    const host = hint ? hostOf(hint) : null;
    if (host) return host === 'github.com' ? 'github' : 'gitlab';
  }
  return null;
}

export const mrNoun = (forge: Forge | null): 'PR' | 'MR' =>
  forge === 'github' ? 'PR' : 'MR';

export const mrNouns = (forge: Forge | null): 'PRs' | 'MRs' =>
  forge === 'github' ? 'PRs' : 'MRs';

export const mrLongNoun = (
  forge: Forge | null
): 'pull request' | 'merge request' =>
  forge === 'github' ? 'pull request' : 'merge request';

/** "#12" on GitHub, "!12" on GitLab. */
export const mrRefText = (forge: Forge | null, iid: number | string) =>
  `${forge === 'github' ? '#' : '!'}${iid}`;

export const noMrYet = (forge: Forge | null) => `no ${eitherNoun(forge)} yet`;

/** For copy over a list that may mix forges: the forge's noun when the
    list is narrowed to one, else wording right for both. */
export const eitherNoun = (forge: Forge | null) =>
  forge ? mrNoun(forge) : 'MR or PR';

export const mixedNouns = (forge: Forge | null) =>
  forge ? mrNouns(forge) : 'MRs and PRs';
