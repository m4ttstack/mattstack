export type Forge = 'gitlab' | 'github';

/** GitHub is supported only on github.com; this is the one base URL it ever takes. */
export const GITHUB_BASE_URL = 'https://github.com';

export function changeUrl(
  forge: Forge | undefined,
  baseUrl: string,
  projectPath: string,
  iid: number
): string {
  return forge === 'github'
    ? `${baseUrl}/${projectPath}/pull/${iid}`
    : `${baseUrl}/${projectPath}/-/merge_requests/${iid}`;
}

export function changeRef(forge: Forge | undefined, iid: number): string {
  return `${forge === 'github' ? '#' : '!'}${iid}`;
}
