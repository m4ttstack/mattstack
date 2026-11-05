import { readFile } from 'node:fs/promises';

import {
  chatSlackAvatarFile,
  chatSlackAvatars,
  matchSlackFaces,
} from '@mattstack/rt-client';

const PEOPLE_FRESH_MS = 60 * 60_000;

type SlackPeople = NonNullable<
  Awaited<ReturnType<typeof chatSlackAvatars>>['data']
>['people'];

let people: SlackPeople = [];
let fetchedAt = 0;

async function slackPeople(): Promise<SlackPeople> {
  if (fetchedAt && Date.now() - fetchedAt < PEOPLE_FRESH_MS) return people;
  const res = await chatSlackAvatars();
  if (res.ok && res.data?.people.length) {
    people = res.data.people;
    fetchedAt = Date.now();
  }
  return people;
}

/** The URL of a person's Slack picture, when exactly one Slack person has their name. */
export async function slackFaceUrl(name: string): Promise<string | null> {
  const known = await slackPeople();
  const id = matchSlackFaces([['person', name]], known).person;
  if (!id) return null;
  const version = known.find(p => p.id === id)?.version ?? '';
  return `/api/slack-avatar/${id}?v=${version}`;
}

export async function slackPicture(person: string) {
  const res = await chatSlackAvatarFile({ person });
  const file = res.ok ? res.data?.file : undefined;
  if (!file) return null;
  const bytes = await readFile(file.path).catch(() => null);
  return bytes && { bytes, contentType: file.contentType };
}
