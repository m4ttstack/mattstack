import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface CableCommand {
  command: string;
  identifier: string;
}

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  sent: CableCommand[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as CableCommand);
  }
  close(): void {
    this.closed = true;
  }
  deliver(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const realWebSocket = globalThis.WebSocket;
afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  FakeSocket.instances = [];
});

function recorder() {
  const counts = { connected: 0, disconnected: 0, events: 0 };
  return {
    counts,
    callbacks: {
      onConnected: () => counts.connected++,
      onDisconnected: () => counts.disconnected++,
      onEvent: () => counts.events++,
    },
  };
}

const identifiersFor = (sock: FakeSocket, command: string, gid: string) =>
  sock.sent.filter((c) => c.command === command && c.identifier.includes(`"${gid}\\"`)).map((c) => c.identifier);

describe('GitLabProvider.subscribePullRequestEvents', () => {
  test('subscribes every MR by its GID and routes one cable message to one onEvent', () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    const { counts, callbacks } = recorder();

    const dispose = gitlab.subscribePullRequestEvents!(
      'g/p',
      [
        { id: 'gitlab:mr:101', iid: 1 },
        { id: 'gitlab:mr:202', iid: 2 },
      ],
      callbacks
    );
    try {
      expect(FakeSocket.instances).toHaveLength(1);
      const sock = FakeSocket.instances[0]!;

      sock.deliver({ type: 'welcome' });
      expect(counts.connected).toBe(1);
      const mr101 = identifiersFor(sock, 'subscribe', 'gid://gitlab/MergeRequest/101');
      const mr202 = identifiersFor(sock, 'subscribe', 'gid://gitlab/MergeRequest/202');
      expect(mr101).toHaveLength(3);
      expect(mr202).toHaveLength(3);

      sock.deliver({ identifier: mr202[1], message: { result: { data: {} } } });
      expect(counts.events).toBe(1);

      sock.deliver({ identifier: 'not-ours', message: { result: { data: {} } } });
      expect(counts.events).toBe(1);

      sock.onclose?.({ code: 1006, reason: '' });
      expect(counts.disconnected).toBe(1);
    } finally {
      dispose();
    }
  });

  test('a watcher attached before the first welcome is not told it is connected until the welcome', () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    const first = recorder();
    const second = recorder();

    const disposeFirst = gitlab.subscribePullRequestEvents!('g/p', [{ id: 'gitlab:mr:101', iid: 1 }], first.callbacks);
    const disposeSecond = gitlab.subscribePullRequestEvents!('g/p', [{ id: 'gitlab:mr:202', iid: 2 }], second.callbacks);
    try {
      expect(second.counts.connected).toBe(0);

      FakeSocket.instances[0]!.deliver({ type: 'welcome' });
      expect(first.counts.connected).toBe(1);
      expect(second.counts.connected).toBe(1);
    } finally {
      disposeSecond();
      disposeFirst();
    }
  });

  test('a watcher attached while the cable is down waits for the next welcome', () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    const first = recorder();
    const late = recorder();

    const disposeFirst = gitlab.subscribePullRequestEvents!('g/p', [{ id: 'gitlab:mr:101', iid: 1 }], first.callbacks);
    const sock = FakeSocket.instances[0]!;
    sock.deliver({ type: 'welcome' });
    sock.onclose?.({ code: 1006, reason: '' });

    const disposeLate = gitlab.subscribePullRequestEvents!('g/p', [{ id: 'gitlab:mr:202', iid: 2 }], late.callbacks);
    try {
      expect(late.counts.connected).toBe(0);

      sock.deliver({ type: 'welcome' });
      expect(late.counts.connected).toBe(1);
      expect(identifiersFor(sock, 'subscribe', 'gid://gitlab/MergeRequest/202')).toHaveLength(3);
    } finally {
      disposeLate();
      disposeFirst();
    }
  });

  test('dispose unsubscribes every channel and closes the last shared socket', () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    const { callbacks } = recorder();

    const dispose = gitlab.subscribePullRequestEvents!('g/p', [{ id: 'gitlab:mr:101', iid: 1 }], callbacks);
    const sock = FakeSocket.instances[0]!;
    sock.deliver({ type: 'welcome' });
    dispose();

    expect(identifiersFor(sock, 'unsubscribe', 'gid://gitlab/MergeRequest/101')).toHaveLength(3);
    expect(sock.closed).toBe(true);
  });
});

describe('GitLabProvider.watchMR over the shared cable', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test('subscribes after its first fetch, refetches on an event, resubscribes on reconnect, unsubscribes on dispose', async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    let fetches = 0;
    (gitlab as unknown as { fetchSingleMRWithRetry: () => Promise<unknown> }).fetchSingleMRWithRetry = async () => {
      fetches++;
      return { id: 'gitlab:mr:777', iid: 7 };
    };
    const statuses: string[] = [];

    const dispose = gitlab.watchMR('g/p', 7, null, () => {}, {
      onStatusChange: (s) => statuses.push(s.connection),
    });
    await settle();
    await settle();
    try {
      expect(FakeSocket.instances).toHaveLength(1);
      const sock = FakeSocket.instances[0]!;

      sock.deliver({ type: 'welcome' });
      const subscribed = identifiersFor(sock, 'subscribe', 'gid://gitlab/MergeRequest/777');
      expect(subscribed).toHaveLength(3);
      expect(statuses.at(-1)).toBe('connected');

      const before = fetches;
      sock.deliver({ identifier: subscribed[0], message: {} });
      await new Promise((r) => setTimeout(r, 200));
      expect(fetches - before).toBe(1);

      sock.onclose?.({ code: 1006, reason: '' });
      expect(statuses.at(-1)).toBe('disconnected');
      sock.deliver({ type: 'welcome' });
      expect(identifiersFor(sock, 'subscribe', 'gid://gitlab/MergeRequest/777')).toHaveLength(6);
      expect(statuses.at(-1)).toBe('connected');
    } finally {
      dispose();
    }
    const sock = FakeSocket.instances[0]!;
    expect(identifiersFor(sock, 'unsubscribe', 'gid://gitlab/MergeRequest/777')).toHaveLength(3);
    expect(sock.closed).toBe(true);
  });
});
