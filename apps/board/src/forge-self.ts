export interface ForgeSelfDeps {
  forge: () => 'gitlab' | 'github';
  fixture: boolean;
  memoryUsername: () => string | null;
  teamUsername: () => string | null;
}

/** Who the board acts as. A GitLab board keeps the token's memory identity,
    re-read each call. A GitHub board has no token of its own, so it is the
    team record's forge username, read once until a config reload. */
export function createForgeSelf(deps: ForgeSelfDeps): {
  get(): string | null;
  reset(): void;
} {
  let team: { value: string | null } | null = null;
  return {
    get() {
      if (deps.fixture) return null;
      if (deps.forge() === 'gitlab') return deps.memoryUsername();
      if (team === null) {
        let value: string | null;
        try {
          value = deps.teamUsername();
        } catch (err) {
          console.error(
            `board: team identity read failed: ${err instanceof Error ? err.message : String(err)}`
          );
          value = null;
        }
        team = { value };
      }
      return team.value;
    },
    reset() {
      team = null;
    },
  };
}

/** The manual doctor launch's identity: GitHub answers self() and never calls gitlab(). */
export function launchIdentity(
  forge: 'gitlab' | 'github',
  self: () => string | null,
  gitlab: () => Promise<string | null>
): Promise<string | null> {
  return forge === 'github' ? Promise.resolve(self()) : gitlab();
}
