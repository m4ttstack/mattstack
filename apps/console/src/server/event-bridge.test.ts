// @vitest-environment node
import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  agentAdopt: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
  agentResume: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
  paneList: vi.fn(async () => ({ ok: true, data: { panes: [] } })),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

const { consoleBridgeRule, installConsoleBridgeRule, slackBridgeRule } =
  await import('./event-bridge');
const rt = await import('@mattstack/rt-client');

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeIo(initial: EventBridgeRule[]): {
  read: () => EventBridgeRule[];
  write: (next: EventBridgeRule[]) => void;
  writes: EventBridgeRule[][];
} {
  let current = initial;
  const writes: EventBridgeRule[][] = [];
  return {
    read: () => current,
    write: next => {
      writes.push(next);
      current = next;
    },
    writes,
  };
}

describe('consoleBridgeRule', () => {
  it('matches the console contract: pattern, subjectPrefix, templates, click-through url, and human owner', () => {
    expect(consoleBridgeRule('https://console.mattstack')).toEqual({
      pattern: 'gate/opened/*',
      subjectPrefix: 'run:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: 'https://console.mattstack/gates/{id}',
      owner: 'human',
    });
  });
});

describe('slackBridgeRule', () => {
  it('notifies a slack-open gate and opens it at /gates/{id}', () => {
    expect(slackBridgeRule('https://console.mattstack')).toEqual({
      pattern: 'gate/opened/*',
      subjectPrefix: 'slack:',
      category: 'gate',
      title: 'Slack chat request',
      message: 'Approve or decline in console',
      url: 'https://console.mattstack/gates/{id}',
      owner: 'human',
    });
  });

  it('never templates the question, whose label ends in the slack-open marker', () => {
    const rule = slackBridgeRule('https://console.mattstack');
    expect(`${rule.title} ${rule.message}`).not.toMatch(
      /\{question\}|\{label\}/
    );
  });
});

describe('installConsoleBridgeRule', () => {
  const rule = consoleBridgeRule('https://console.mattstack');

  it('upserts both rules with the url deck resolved into an empty list', async () => {
    const io = fakeIo([]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.local.test',
    });
    expect(io.writes.at(-1)).toEqual([
      consoleBridgeRule('https://console.local.test'),
      slackBridgeRule('https://console.local.test'),
    ]);
  });

  it('keeps an existing rule exactly as it is when deck does not answer', async () => {
    const io = fakeIo([
      consoleBridgeRule('http://localhost:11011'),
      slackBridgeRule('http://localhost:11011'),
    ]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => null,
    });
    expect(io.writes).toHaveLength(0);
  });

  it('seeds a missing rule with the https console domain when deck does not answer', async () => {
    const io = fakeIo([]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => null,
    });
    expect(io.writes.at(-1)).toEqual([
      rule,
      slackBridgeRule('https://console.mattstack'),
    ]);
  });

  it('leaves identical rules already present untouched, no duplicate written', async () => {
    const io = fakeIo([rule, slackBridgeRule('https://console.mattstack')]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(io.writes).toHaveLength(0);
  });

  it('replaces a stale same-identity rule in place, leaving other entries untouched', async () => {
    const board: EventBridgeRule = {
      pattern: 'gate/opened/*',
      subjectPrefix: 'mr:',
      category: 'gate',
      title: '{label}',
      message: '{question}',
      url: 'https://board.mattstack/?gate={id}',
    };
    const stale: EventBridgeRule = {
      pattern: 'gate/opened/*',
      subjectPrefix: 'run:',
      category: 'gate',
      title: '{label}',
      message: '{subject}',
    };
    const io = fakeIo([board, stale]);
    await installConsoleBridgeRule({
      read: io.read,
      write: io.write,
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(io.writes.at(-1)).toEqual([
      board,
      rule,
      slackBridgeRule('https://console.mattstack'),
    ]);
  });

  it('wires the default read/write through getSetting/setSetting when no overrides are given', async () => {
    let stored: EventBridgeRule[] = [];
    vi.mocked(rt.getSetting).mockImplementation(
      () => ({ value: stored, provenance: [] }) as never
    );
    vi.mocked(rt.setSetting).mockImplementation(((
      _key: string,
      next: EventBridgeRule[]
    ) => {
      stored = next;
    }) as never);
    await installConsoleBridgeRule({
      resolveUrl: async () => 'https://console.mattstack',
    });
    expect(rt.getSetting).toHaveBeenCalledWith('rt.notify.eventBridges');
    expect(rt.setSetting).toHaveBeenLastCalledWith(
      'rt.notify.eventBridges',
      [rule, slackBridgeRule('https://console.mattstack')],
      'user'
    );
  });
});
