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

const SANDBOX_SHAPE = /^([^\s!/]+(?:\/[^\s!/]+)+)(?:!(\d+))?$/;

/**
 * `raw` is `group/project` or `group/project!<iid>`. `needs: 'mr'` is for a
 * step that writes onto an existing MR rather than creating its own.
 */
export function mutationTarget(
  envName: string,
  raw: string | undefined,
  needs: 'project' | 'mr'
): MutationTarget {
  const example = needs === 'mr' ? 'group/project!<iid>' : 'group/project';
  const value = raw?.trim() ?? '';
  if (value === '') {
    return {
      ok: false,
      refusal: `refused: ${envName} is unset. Set it to the sandbox (${example}); mutations never fall back to the token user's own MRs.`,
    };
  }
  const match = SANDBOX_SHAPE.exec(value);
  if (!match) {
    return { ok: false, refusal: `refused: ${envName}="${value}" is not ${example}.` };
  }
  const iid = match[2] ? Number(match[2]) : null;
  if (needs === 'mr' && iid === null) {
    return {
      ok: false,
      refusal: `refused: this step writes onto an existing MR, so ${envName} must name one (${example}).`,
    };
  }
  return { ok: true, projectPath: match[1]!, iid };
}

export function readOnlyProjectPath(
  fromOwnList: string | null,
  fromEnv: string | undefined
): string | null {
  return fromOwnList ?? fromEnv ?? null;
}
