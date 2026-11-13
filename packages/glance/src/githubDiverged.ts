export const DIVERGED_BATCH_SIZE = 25;

export interface GHDivergedNode {
  baseRef: { compare: { behindBy: number } | null } | null;
}

export function buildDivergedQuery(_owner: string, _repo: string, numbers: number[]): string {
  const aliases = numbers.map(n => {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`fetchDivergedCounts: iids must be positive integers, got ${n}`);
    }
    return `p${n}: pullRequest(number: ${n}) { baseRef { compare(headRef: "refs/pull/${n}/head") { behindBy } } }`;
  });
  return `query GlanceDiverged($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    ${aliases.join('\n    ')}
  }
}`;
}
