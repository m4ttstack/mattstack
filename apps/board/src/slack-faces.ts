export interface SlackPerson {
  id: string;
  displayName: string;
  realName: string;
}

function comparable(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Slack user id by username. Forge accounts and Slack accounts share nothing
    but a name, so a name that fits two Slack people matches neither: a wrong
    face is worse than a sprite. */
export function slackFaces(
  people: Iterable<readonly [string, string | null | undefined]>,
  slack: readonly SlackPerson[]
): Record<string, string> {
  const byName = new Map<string, Set<string>>();
  for (const person of slack) {
    for (const name of [person.realName, person.displayName]) {
      const key = comparable(name);
      if (!key) continue;
      byName.set(key, (byName.get(key) ?? new Set()).add(person.id));
    }
  }
  const faces: Record<string, string> = {};
  for (const [username, name] of people) {
    const ids = name ? byName.get(comparable(name)) : undefined;
    if (ids?.size === 1) faces[username] = [...ids][0]!;
  }
  return faces;
}
