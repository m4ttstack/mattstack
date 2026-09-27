/**
 * Target selection for integration.live.ts.
 *
 * Mutating steps take their target only from a GLANCE_HARNESS_*_SANDBOX
 * variable, never from the token user's own PR list: that list holds real,
 * unrelated work, and a hand run with real credentials must not write to it.
 * Read-only probes keep the own-list fallback.
 */

export type MutationTarget =
  | { ok: true; projectPath: string; iid: number | null }
  | { ok: false; refusal: string };

/**
 * `repo` is a GitHub `owner/repo`. `project` is a GitLab `group/project`
 * (subgroups allowed); `mr` is the same with `!<iid>`, for a step that writes
 * onto an existing MR rather than creating its own.
 */
export type SandboxKind = 'repo' | 'project' | 'mr';

const SEGMENT = /^[\w.-]+$/;
const IID = /^[1-9]\d{0,9}$/;

const SHAPE: Record<SandboxKind, string> = {
  repo: 'owner/repo',
  project: 'group/project',
  mr: 'group/project!<iid>',
};

export function mutationTarget(
  envName: string,
  raw: string | undefined,
  kind: SandboxKind
): MutationTarget {
  const shape = SHAPE[kind];
  const value = raw?.trim() ?? '';
  if (value === '') {
    return {
      ok: false,
      refusal: `refused: ${envName} is unset. Set it to the sandbox (${shape}); mutations never fall back to the token user's own MRs.`,
    };
  }
  const malformed: MutationTarget = { ok: false, refusal: `refused: ${envName}="${value}" is not ${shape}.` };

  const bang = value.indexOf('!');
  const path = bang === -1 ? value : value.slice(0, bang);
  const iidText = bang === -1 ? null : value.slice(bang + 1);

  const segments = path.split('/');
  const validSegments = segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
  const segmentCountOk = kind === 'repo' ? segments.length === 2 : segments.length >= 2;
  if (!validSegments || !segmentCountOk) return malformed;

  if (iidText !== null && (kind === 'repo' || !IID.test(iidText))) return malformed;
  if (kind === 'mr' && iidText === null) {
    return {
      ok: false,
      refusal: `refused: this step writes onto an existing MR, so ${envName} must name one (${shape}).`,
    };
  }
  return { ok: true, projectPath: path, iid: iidText === null ? null : Number(iidText) };
}

export function readOnlyProjectPath(
  fromOwnList: string | null,
  fromEnv: string | undefined
): string | null {
  return fromOwnList ?? fromEnv ?? null;
}
