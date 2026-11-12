import type { BoardConfig } from '../config.ts';

/** The line a GitHub team's triage run logs in place of the GitLab-only
    passes it skips, or null on a GitLab team. */
export function triageForgeSkip(
  config: Pick<BoardConfig, 'forge'>
): string | null {
  return config.forge.kind === 'github'
    ? 'triage: auto-doctor, respond asks and the re-review latch skip GitHub teams for now'
    : null;
}
