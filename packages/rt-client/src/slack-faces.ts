export interface SlackPerson {
  id: string;
  displayName: string;
  realName: string;
}

function comparable(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** "George C. Norris" and "George Norris" are one name to a person. */
function firstAndLast(name: string): string | undefined {
  const words = comparable(name).split(' ');
  return words.length > 1 ? `${words[0]} ${words.at(-1)}` : undefined;
}

/** Slack user id by username. Forge accounts and Slack accounts share nothing
    but a name, so a name that fits two Slack people matches neither: a wrong
    face is worse than a sprite. An exact name wins over a looser one. */
export function matchSlackFaces(
  people: Iterable<readonly [string, string | null | undefined]>,
  slack: readonly SlackPerson[]
): Record<string, string> {
  const byName = new Map<string, Set<string>>();
  const byFirstLast = new Map<string, Set<string>>();
  for (const person of slack) {
    for (const name of [person.realName, person.displayName]) {
      const key = comparable(name);
      if (!key) continue;
      byName.set(key, (byName.get(key) ?? new Set()).add(person.id));
      const loose = firstAndLast(name);
      if (loose) {
        byFirstLast.set(loose, (byFirstLast.get(loose) ?? new Set()).add(person.id));
      }
    }
  }
  const faces: Record<string, string> = {};
  for (const [username, name] of people) {
    if (!name) continue;
    const loose = firstAndLast(name);
    const ids =
      byName.get(comparable(name)) ?? (loose ? byFirstLast.get(loose) : undefined);
    if (ids?.size === 1) faces[username] = [...ids][0]!;
  }
  return faces;
}
