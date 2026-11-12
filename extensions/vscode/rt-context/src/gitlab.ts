import { GitLabProvider } from '@mattstack/glance';
import { getSetting, mayOfferGitLabTokenToHost } from '@mattstack/rt-client';
import { parseRemoteUrl } from './branchParser';

/**
 * Regex to find a Linear-style identifier (TEAM-NNN) in a string.
 * Used for parsing MR titles like "[ACME-1287] Add damage photos".
 */
const LINEAR_ID_IN_TEXT = /\b([A-Za-z]+-\d+)\b/;

/** The host the person confirmed through `rt setup gitlab connect --host`, or null. Never throws: an unreadable store confirms nothing. */
export function confirmedForgeHost(): string | null {
  try {
    const host = getSetting<{ forgeHost?: unknown } | undefined>('rt.integrations').value?.forgeHost;
    return typeof host === 'string' && host !== '' ? host : null;
  } catch {
    return null;
  }
}

function hostOfRemote(remoteUrl: string): string | null {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) return null;
  return remote.host.replace(/^https?:\/\//, '').replace(/^[^@]*@/, '').toLowerCase();
}

/** Why the GitLab token may not go to this remote's host, in plain words, or null when it may. */
export function gitlabTokenRefusal(remoteUrl: string, confirmedHost: unknown): string | null {
  const host = hostOfRemote(remoteUrl);
  if (host === null) return 'the origin remote is not a URL RT Context can read, so it looks up no merge request.';
  if (mayOfferGitLabTokenToHost(host, confirmedHost)) return null;
  if (host === 'github.com') return 'github.com is not a GitLab host, so RT Context looks up no merge request there.';
  return `RT Context sends your GitLab token only to gitlab.com or the GitLab host you confirmed, and ${host} is not confirmed. To confirm it, run: rt setup gitlab connect --host ${host}`;
}

export interface MRLookupResult {
  webUrl: string | null;
  linearId: string | null;
}

/**
 * Find an open MR for the given branch using the glance-sdk GitLabProvider.
 * Returns the MR web URL and, if present, a Linear ticket ID extracted
 * from the MR title.
 */
export async function fetchMRInfo(
  gitlabToken: string,
  remoteUrl: string,
  branchName: string,
  confirmedHost: unknown,
): Promise<MRLookupResult | null> {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote || gitlabTokenRefusal(remoteUrl, confirmedHost) !== null) return null;

  try {
    const provider = new GitLabProvider(remote.host, gitlabToken);
    const mr = await provider.fetchPullRequestByBranch(remote.projectPath, branchName);

    if (!mr) return null;

    const match = LINEAR_ID_IN_TEXT.exec(mr.title);
    return {
      webUrl: mr.webUrl,
      linearId: match ? match[1]!.toUpperCase() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-fetch MR info for multiple branches in a single API call.
 * Returns a map of branch name → MRLookupResult for branches that have an open MR.
 */
export async function fetchMRInfoBatch(
  gitlabToken: string,
  remoteUrl: string,
  branches: string[],
  confirmedHost: unknown,
): Promise<Map<string, MRLookupResult>> {
  const results = new Map<string, MRLookupResult>();
  if (!branches.length) return results;

  const remote = parseRemoteUrl(remoteUrl);
  if (!remote || gitlabTokenRefusal(remoteUrl, confirmedHost) !== null) return results;

  try {
    const provider = new GitLabProvider(remote.host, gitlabToken);
    const mrMap = await provider.fetchPullRequestsByBranches(remote.projectPath, branches);

    for (const [branch, mr] of mrMap) {
      if (!mr) continue;
      const match = LINEAR_ID_IN_TEXT.exec(mr.title);
      results.set(branch, {
        webUrl: mr.webUrl,
        linearId: match ? match[1]!.toUpperCase() : null,
      });
    }
  } catch {
    // Batch fetch failed — caller falls back to cached data
  }

  return results;
}
