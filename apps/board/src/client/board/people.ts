import { createContext, useContext } from 'react';

import type { BoardData } from '../types.ts';

/** One sighting of a person: a roster row, an MR author, a reviewer, an
    asker. The same username may be seen many times. */
export interface KnownPerson {
  username: string;
  name?: string | null;
}

/** Everyone the board knows, by username. */
export interface People {
  /** The full name, else the handle: for lists people pick from. */
  full(username: string): string;
  /** The first name, "Sam K." when someone else shares it, the full name
      when that still clashes, else the handle: for a person named inline. */
  short(username: string): string;
}

const words = (name: string): string[] => name.trim().split(/\s+/);
const fold = (s: string): string => s.toLocaleLowerCase();

function initialed(name: string): string {
  const w = words(name);
  return w.length > 1
    ? `${w[0]} ${w[w.length - 1]!.charAt(0).toUpperCase()}.`
    : name;
}

/** Each step is tried until no one sharing the first name reads the same. */
const LADDER = [
  (name: string) => words(name)[0]!,
  initialed,
  (name: string) => name,
];

export function people(known: Iterable<KnownPerson>): People {
  const names = new Map<string, string>();
  for (const { username, name } of known) {
    const trimmed = name?.trim();
    if (trimmed && !names.has(username)) names.set(username, trimmed);
  }

  const byFirst = new Map<string, string[]>();
  for (const [username, name] of names) {
    const key = fold(words(name)[0]!);
    byFirst.set(key, [...(byFirst.get(key) ?? []), username]);
  }

  const shorts = new Map<string, string>();
  for (const group of byFirst.values()) {
    for (const username of group) {
      const pick = LADDER.map(form =>
        fold(form(names.get(username)!))
      ).findIndex((label, level) =>
        group.every(
          other =>
            other === username ||
            fold(LADDER[level]!(names.get(other)!)) !== label
        )
      );
      shorts.set(
        username,
        pick < 0 ? username : LADDER[pick]!(names.get(username)!)
      );
    }
  }

  return {
    full: username => names.get(username) ?? username,
    short: username => shorts.get(username) ?? username,
  };
}

export const NO_PEOPLE: People = people([]);

/** Everyone the board's data names, roster first so its spelling wins. */
export function boardPeople(data: {
  allMembers: readonly KnownPerson[];
  mrs: readonly BoardData['mrs'][number][];
  teams?: BoardData['teams'];
  asks?: BoardData['asks'];
}): People {
  function* sightings(): Generator<KnownPerson> {
    yield* data.allMembers;
    for (const team of data.teams ?? []) yield* team.members;
    for (const mr of data.mrs) {
      // Hand-built snapshots (stories, tests) leave any of these off.
      if (mr.author) yield mr.author;
      yield* mr.reviews?.reviewers ?? [];
      yield* mr.reviews?.approvedBy ?? [];
      yield* mr.respondTargets ?? [];
      if (mr.sentNudge)
        yield {
          username: mr.sentNudge.reviewer,
          name: mr.sentNudge.reviewerName,
        };
    }
    for (const ask of [
      ...(data.asks?.pending ?? []),
      ...(data.asks?.history ?? []),
    ])
      yield { username: ask.from, name: ask.fromName };
  }
  return people(sightings());
}

/** The people one MR names, for a row read without the board around it. */
export const mrPeople = (mr: BoardData['mrs'][number]): People =>
  boardPeople({ allMembers: [], mrs: [mr] });

const PeopleContext = createContext<People | null>(null);

export const PeopleProvider = PeopleContext.Provider;

/** The board's people; undefined outside a board (a story, a test). */
export const useBoardPeople = (): People | undefined =>
  useContext(PeopleContext) ?? undefined;

/** The board's people; outside a board, the people the given MR names. */
export function usePeople(mr?: BoardData['mrs'][number]): People {
  return useBoardPeople() ?? (mr ? mrPeople(mr) : NO_PEOPLE);
}
