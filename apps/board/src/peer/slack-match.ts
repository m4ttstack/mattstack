/** What the board knows of its people's Slack accounts, from the face match. */
import type { SlackPerson } from '@mattstack/rt-client';
import { canonicalUsername } from './envelope.ts';

export interface SlackMatch {
  /** Picture URL by roster username. */
  faces: ReadonlyMap<string, string>;
  /** Slack user id by canonical username. */
  ids: ReadonlyMap<string, string>;
  /** The matched Slack person's own name by roster username. */
  names: ReadonlyMap<string, string>;
}

export const NO_SLACK_MATCH: SlackMatch = {
  faces: new Map(),
  ids: new Map(),
  names: new Map(),
};

/** The next match, built whole and never mutating `prev`, so a reader between
    a Slack refresh and the next poll still sees the last one. A failed lookup
    must not take a face away, so a poll adds to `prev`; pass `NO_SLACK_MATCH`
    after a refresh to drop matches the new people list no longer makes. */
export function foldSlackMatch(
  prev: SlackMatch,
  matched: Readonly<Record<string, string>>,
  people: readonly (SlackPerson & { version?: string })[]
): SlackMatch {
  const byId = new Map(people.map(p => [p.id, p]));
  const faces = new Map(prev.faces);
  const ids = new Map(prev.ids);
  const names = new Map(prev.names);
  for (const [username, id] of Object.entries(matched)) {
    const person = byId.get(id);
    faces.set(username, `/api/slack-avatar/${id}?v=${person?.version ?? ''}`);
    ids.set(canonicalUsername(username), id);
    const name = person?.displayName.trim() || person?.realName.trim();
    if (name) names.set(username, name);
  }
  return { faces, ids, names };
}

/** The /api/board fields the client reads: a face per person, and the Slack
    name the parked band's Remind says it will DM. */
export function slackMatchPayload(match: SlackMatch): {
  slackFaces: Record<string, string>;
  slackNames: Record<string, string>;
} {
  return {
    slackFaces: Object.fromEntries(match.faces),
    slackNames: Object.fromEntries(match.names),
  };
}
