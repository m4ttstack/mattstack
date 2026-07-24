const LINEAR_API_URL = 'https://api.linear.app/graphql';

/** Matches identifiers like ENG-123, ACME-4567 (case-insensitive). */
const LINEAR_ID_RE = /^[A-Za-z]+-\d+$/;

export interface LinearIssueInfo {
  title: string;
  url: string;
  identifier: string;
}

/**
 * Extract a Linear issue identifier from a branch name.
 *
 * Supports the `<category>/<TEAM-NNN>` convention (e.g. `feat/ENG-123`).
 * Also handles bare identifiers and deeper paths like `user/feat/ENG-123`.
 * Returns the uppercased identifier or null if none found.
 */
export function extractLinearId(branch: string): string | null {
  const segments = branch.split('/');

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (LINEAR_ID_RE.test(seg)) {
      return seg.toUpperCase();
    }
  }
  return null;
}

/**
 * Batch-fetch issue titles from Linear's GraphQL API.
 *
 * Uses aliased `issue(id:)` queries in a single request since the bulk
 * `issues` filter doesn't support `identifier`. Each identifier gets
 * its own aliased field (e.g. `i0: issue(id: "ENG-123") { ... }`).
 */
export async function fetchIssueTitles(
  apiKey: string,
  identifiers: string[],
): Promise<Map<string, LinearIssueInfo>> {
  if (identifiers.length === 0) return new Map();

  const fragment = '{ identifier title url }';
  const aliases = identifiers.map((id, i) => `i${i}: issue(id: "${id}") ${fragment}`);
  const query = `query { ${aliases.join('\n')} }`;

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}: ${response.statusText}`);
  }

  const json: any = await response.json();

  const result = new Map<string, LinearIssueInfo>();
  const data = json.data ?? {};
  for (let i = 0; i < identifiers.length; i++) {
    const node = data[`i${i}`];
    if (node?.identifier) {
      result.set(node.identifier, {
        identifier: node.identifier,
        title: node.title || '',
        url: node.url || '',
      });
    }
  }
  return result;
}

/**
 * Validate a Linear API key by querying the viewer identity.
 * Returns true if the key is valid.
 */
export async function validateLinearApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve Linear titles for a list of branch names.
 *
 * Extracts identifiers, batch-fetches from Linear, and returns
 * a map of branch name → LinearIssueInfo.
 */
export async function enrichBranches(
  apiKey: string,
  branches: string[],
): Promise<Record<string, LinearIssueInfo>> {
  const branchToId = new Map<string, string>();
  const ids = new Set<string>();

  for (const branch of branches) {
    const id = extractLinearId(branch);
    if (id) {
      branchToId.set(branch, id);
      ids.add(id);
    }
  }

  if (ids.size === 0) return {};

  const titleMap = await fetchIssueTitles(apiKey, [...ids]);
  const result: Record<string, LinearIssueInfo> = {};

  for (const [branch, id] of branchToId) {
    const info = titleMap.get(id);
    if (info) {
      result[branch] = info;
    }
  }

  return result;
}
