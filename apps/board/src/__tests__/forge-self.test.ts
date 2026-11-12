import { describe, expect, test } from 'bun:test';

import { createForgeSelf, launchIdentity } from '../forge-self.ts';
import { effectiveSeat } from '../view.ts';

function counted<T>(value: () => T) {
  const calls = { n: 0 };
  return {
    calls,
    read: () => {
      calls.n++;
      return value();
    },
  };
}

describe('createForgeSelf', () => {
  test('GitLab re-reads the memory identity on every call', () => {
    let name: string | null = 'alice';
    const memory = counted(() => name);
    const team = counted(() => 'team-user');
    const self = createForgeSelf({
      forge: () => 'gitlab',
      fixture: false,
      memoryUsername: memory.read,
      teamUsername: team.read,
    });
    expect(self.get()).toBe('alice');
    name = 'carol';
    expect(self.get()).toBe('carol');
    expect(memory.calls.n).toBe(2);
    expect(team.calls.n).toBe(0);
  });

  test('GitHub reads the team username once until reset', () => {
    let name: string | null = 'alice';
    const team = counted(() => name);
    const memory = counted(() => 'zed');
    const self = createForgeSelf({
      forge: () => 'github',
      fixture: false,
      memoryUsername: memory.read,
      teamUsername: team.read,
    });
    expect(self.get()).toBe('alice');
    name = 'bob';
    expect(self.get()).toBe('alice');
    expect(team.calls.n).toBe(1);
    self.reset();
    expect(self.get()).toBe('bob');
    expect(team.calls.n).toBe(2);
    expect(memory.calls.n).toBe(0);
  });

  test('GitHub remembers a null answer until reset', () => {
    const team = counted(() => null);
    const self = createForgeSelf({
      forge: () => 'github',
      fixture: false,
      memoryUsername: () => 'zed',
      teamUsername: team.read,
    });
    expect(self.get()).toBeNull();
    expect(self.get()).toBeNull();
    expect(team.calls.n).toBe(1);
  });

  test('an unreadable team record reads as no identity', () => {
    const self = createForgeSelf({
      forge: () => 'github',
      fixture: false,
      memoryUsername: () => 'zed',
      teamUsername: () => {
        throw new Error('unreadable team record');
      },
    });
    expect(self.get()).toBeNull();
  });

  test('fixture mode has no identity and reads neither source', () => {
    const memory = counted(() => 'alice');
    const team = counted(() => 'alice');
    for (const forge of ['gitlab', 'github'] as const) {
      const self = createForgeSelf({
        forge: () => forge,
        fixture: true,
        memoryUsername: memory.read,
        teamUsername: team.read,
      });
      expect(self.get()).toBeNull();
    }
    expect(memory.calls.n + team.calls.n).toBe(0);
  });

  test('a seat that is not the team username gets no seat', () => {
    const self = createForgeSelf({
      forge: () => 'github',
      fixture: false,
      memoryUsername: () => 'alice',
      teamUsername: () => 'bob',
    });
    expect(effectiveSeat('alice', self.get())).toBeNull();
  });
});

describe('launchIdentity', () => {
  test('GitHub answers self and never calls gitlab', async () => {
    let called = false;
    const identity = await launchIdentity(
      'github',
      () => 'alice',
      async () => {
        called = true;
        return 'bob';
      }
    );
    expect(identity).toBe('alice');
    expect(called).toBe(false);
  });

  test('GitLab answers the gitlab read', async () => {
    expect(
      await launchIdentity(
        'gitlab',
        () => 'alice',
        async () => 'bob'
      )
    ).toBe('bob');
  });
});
