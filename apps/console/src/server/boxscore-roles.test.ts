// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { rolesInfo } from './boxscore-roles';

const deps = (
  teams: string[],
  joined: string[],
  roster: unknown,
  whoami: () => Promise<string | null> = async () => null
) => ({
  teams: () => teams,
  isJoined: (t: string) => joined.includes(t),
  roster: () => roster,
  whoami,
});

const roster = [{ username: 'ada', name: 'Ada' }, { username: 'Bob' }];

describe('rolesInfo', () => {
  it('lists the roster and marks the owner', async () => {
    expect(await rolesInfo(deps(['acme'], [], roster))).toEqual({
      members: [
        { username: 'ada', name: 'Ada' },
        { username: 'Bob', name: null },
      ],
      access: 'owner',
      self: null,
    });
  });
  it('marks a joined Mac as a member', async () => {
    expect((await rolesInfo(deps(['acme'], ['acme'], []))).access).toBe(
      'member'
    );
  });
  it('marks a Mac with no team', async () => {
    expect((await rolesInfo(deps([], [], []))).access).toBe('no-team');
  });
  it('drops roster entries with no username', async () => {
    expect(
      (await rolesInfo(deps(['acme'], [], [{ name: 'x' }, 'junk']))).members
    ).toEqual([]);
  });
  it("names the owner's own roster row, case-insensitively", async () => {
    const info = await rolesInfo(deps(['acme'], [], roster, async () => 'bob'));
    expect(info.self).toBe('Bob');
  });
  it('leaves self null when the GitLab user is not on the roster', async () => {
    const info = await rolesInfo(deps(['acme'], [], roster, async () => 'zed'));
    expect(info.self).toBeNull();
  });
  it('asks GitLab only on the owner Mac', async () => {
    const whoami = vi.fn(async () => 'ada');
    const info = await rolesInfo(deps(['acme'], ['acme'], roster, whoami));
    expect(info.self).toBeNull();
    expect(whoami).not.toHaveBeenCalled();
  });
});
