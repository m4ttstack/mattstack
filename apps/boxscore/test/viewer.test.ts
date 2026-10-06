import { describe, expect, it } from 'vitest';

import { resolveViewer } from '../src/server/config/viewer.js';

const roster = [{ username: 'alice' }, { username: 'bob', name: 'Bob B' }];
const member = { joined: true };
const owner = { joined: false };

describe('resolveViewer', () => {
  it('gives a Mac with no team Team view', () => {
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: {}, team: null })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it("gives the owner's Mac Team view whatever the roles say", () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'self' },
        team: owner,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('gives the owner Team view even when the lookup failed', () => {
    expect(
      resolveViewer({ currentUser: null, roster, roles: {}, team: owner })
    ).toEqual({ username: null, role: 'team' });
  });

  it('defaults an unlisted member to Self view', () => {
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: {}, team: member })
    ).toEqual({ username: 'bob', role: 'self' });
  });

  it('grants Team view to a member listed as team', () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'team' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('locks a member whose lookup failed', () => {
    expect(
      resolveViewer({
        currentUser: null,
        roster,
        roles: { bob: 'team' },
        team: member,
      })
    ).toEqual({ username: null, role: 'self' });
  });

  it('locks a viewer who is not on the roster', () => {
    expect(
      resolveViewer({
        currentUser: 'mallory',
        roster,
        roles: { mallory: 'team' },
        team: member,
      })
    ).toEqual({ username: null, role: 'self' });
  });

  it("matches the roster and roles case-insensitively, answering the roster's spelling", () => {
    expect(
      resolveViewer({
        currentUser: 'Bob',
        roster,
        roles: { BOB: 'team' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'team' });
  });

  it('fails closed when case-variant role keys disagree', () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { Bob: 'team', bob: 'self' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'self' });
  });

  it('treats an invalid role value as Self view', () => {
    expect(
      resolveViewer({
        currentUser: 'bob',
        roster,
        roles: { bob: 'admin' },
        team: member,
      })
    ).toEqual({ username: 'bob', role: 'self' });
    expect(
      resolveViewer({ currentUser: 'bob', roster, roles: 'team', team: member })
    ).toEqual({ username: 'bob', role: 'self' });
  });
});
