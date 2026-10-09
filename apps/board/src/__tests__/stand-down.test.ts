import { describe, expect, test } from 'bun:test';

import {
  STAND_DOWN_BACKGROUND_MESSAGE,
  standDownDoctor,
  standDownPane,
  waitForBackground,
  type BackgroundWatchIo,
  type DoctorStandDownDeps,
  type StandDownIo,
} from '../stand-down.ts';

const NOTICE =
  'Operator stood down auto-doctor on this MR/stack. Stop and exit -- this pane will not be resumed automatically.';

function io(over: Partial<StandDownIo> = {}) {
  const calls: string[] = [];
  const seam: StandDownIo = {
    switchOn: () => true,
    push: async a => {
      calls.push(`push ${a.pane}`);
      return {
        ok: true,
        data: { acked: true, sessionId: 'sess-1', state: 'stood-down' },
      };
    },
    sendPaneText: async pane => {
      calls.push(`pane ${pane}`);
    },
    ...over,
  };
  return { seam, calls };
}

describe('standDownPane', () => {
  test('an acked stand-down goes through the mod and never types into the pane', async () => {
    const { seam, calls } = io();
    expect(await standDownPane('w1:p1', NOTICE, seam)).toEqual({
      path: 'mod',
      sessionId: 'sess-1',
      background: false,
    });
    expect(calls).toEqual(['push w1:p1']);
  });

  test('a mod reporting background work says so', async () => {
    const { seam } = io({
      push: async () => ({
        ok: true,
        data: {
          acked: true,
          sessionId: 'sess-1',
          state: 'stood-down-background',
        },
      }),
    });
    expect(await standDownPane('w1:p1', NOTICE, seam)).toEqual({
      path: 'mod',
      sessionId: 'sess-1',
      background: true,
    });
  });

  test("an unacked stand-down falls back once to today's stand-down path", async () => {
    for (const push of [
      async () => ({ ok: true as const, data: { acked: false } }),
      async () => ({ ok: false as const, error: 'rt daemon not reachable' }),
      async () => {
        throw new Error('socket closed');
      },
    ]) {
      const sent: [string, string][] = [];
      const { seam, calls } = io({
        push: async a => {
          calls.push(`push ${a.pane}`);
          return push();
        },
        sendPaneText: async (pane, text) => {
          calls.push(`pane ${pane}`);
          sent.push([pane, text]);
        },
      });
      expect(await standDownPane('w1:p1', NOTICE, seam)).toEqual({
        path: 'pane',
        background: false,
      });
      expect(calls).toEqual(['push w1:p1', 'pane w1:p1']);
      expect(sent).toEqual([['w1:p1', NOTICE]]);
    }
  });

  test('with the switch off it is exactly the pane nudge, with no daemon call', async () => {
    const { seam, calls } = io({ switchOn: () => false });
    expect(await standDownPane('w1:p1', NOTICE, seam)).toEqual({
      path: 'pane',
      background: false,
    });
    expect(calls).toEqual(['pane w1:p1']);
  });

  test("a pane nudge that fails still fails, as today's path does", async () => {
    const { seam } = io({
      switchOn: () => false,
      sendPaneText: async () => {
        throw new Error('herdr exited 1');
      },
    });
    await expect(standDownPane('w1:p1', NOTICE, seam)).rejects.toThrow(
      'herdr exited 1'
    );
  });
});

describe('waitForBackground', () => {
  function watch(states: (string | null | Error)[]) {
    let now = 0;
    const seen: number[] = [];
    const seam: BackgroundWatchIo = {
      now: () => now,
      sleep: async ms => {
        now += ms;
      },
      state: async () => {
        seen.push(now);
        const next = states.length > 1 ? states.shift()! : states[0]!;
        if (next instanceof Error) return { ok: false, error: next.message };
        return { ok: true, data: { state: next as never } };
      },
    };
    return { seam, seen };
  }

  test('ends once the session reports its background work finished', async () => {
    const { seam, seen } = watch([
      'stood-down-background',
      'stood-down-background',
      'background-finished',
    ]);
    expect(await waitForBackground('sess-1', seam)).toBe('finished');
    expect(seen).toHaveLength(3);
  });

  test('ends when the session itself has ended', async () => {
    const { seam } = watch(['stood-down-background', 'ended']);
    expect(await waitForBackground('sess-1', seam)).toBe('ended');
  });

  test('gives up after its limit, and rides out a daemon that does not answer', async () => {
    const { seam } = watch([new Error('rt daemon not reachable')]);
    expect(await waitForBackground('sess-1', seam)).toBe('timeout');
  });
});

describe('standDownDoctor', () => {
  const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';
  const IN_FLIGHT = new Set([
    'queued',
    'diagnosing',
    'rebasing',
    'fixing',
    'watching',
  ]);

  function rows(initial: Record<string, unknown>) {
    const store = new Map<string, Record<string, unknown>>([[MR, initial]]);
    const writes: Record<string, unknown>[] = [];
    let release!: (v: 'finished') => void;
    const watched: string[] = [];
    const deps: DoctorStandDownDeps = {
      readDoctor: url => store.get(url) as never,
      writeDoctor: (path, patch) => {
        writes.push({ path, ...patch });
        store.set(MR, { ...store.get(MR), ...patch });
      },
      doctorPath: url => `doctors/${url.split('/').at(-1)}.json`,
      inFlight: IN_FLIGHT,
      standDown: async () => ({
        path: 'mod',
        sessionId: 'sess-1',
        background: true,
      }),
      watch: sessionId => {
        watched.push(sessionId);
        return new Promise(resolve => (release = resolve));
      },
      log: () => {},
    };
    return { deps, writes, watched, finish: () => release('finished') };
  }

  test('a pane left finishing background work reads that way until it ends', async () => {
    const r = rows({ mrUrl: MR, iid: 7, status: 'fixing', paneId: 'w1:p1' });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);

    expect(r.writes).toEqual([
      {
        path: 'doctors/7.json',
        mrUrl: MR,
        iid: 7,
        status: 'done',
        message: STAND_DOWN_BACKGROUND_MESSAGE,
        backgroundFinishing: true,
      },
    ]);
    expect(r.watched).toEqual(['sess-1']);

    r.finish();
    await Bun.sleep(0);
    expect(r.writes.at(-1)).toEqual({
      path: 'doctors/7.json',
      status: 'done',
      message: 'stood down by operator',
      backgroundFinishing: false,
    });
  });

  test('a plain stand-down writes the row as it always has', async () => {
    const r = rows({ mrUrl: MR, iid: 7, status: 'fixing', paneId: 'w1:p1' });
    r.deps.standDown = async () => ({ path: 'pane', background: false });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    expect(r.writes).toEqual([
      {
        path: 'doctors/7.json',
        mrUrl: MR,
        iid: 7,
        status: 'done',
        message: 'stood down by operator',
      },
    ]);
    expect(r.watched).toEqual([]);
  });

  test('a failed nudge is logged and the row is still cleared', async () => {
    const r = rows({ mrUrl: MR, iid: 7, status: 'watching', paneId: 'w1:p1' });
    const logged: string[] = [];
    r.deps.standDown = async () => {
      throw new Error('herdr exited 1');
    };
    r.deps.log = m => logged.push(m);
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    expect(logged).toEqual(['stand-down pane nudge failed: herdr exited 1']);
    expect(r.writes).toHaveLength(1);
  });

  test('a later write the row took is never overwritten when the work ends', async () => {
    const r = rows({ mrUrl: MR, iid: 7, status: 'fixing', paneId: 'w1:p1' });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    r.deps.writeDoctor('doctors/7.json', {
      status: 'queued',
      backgroundFinishing: false,
    });
    const before = r.writes.length;
    r.finish();
    await Bun.sleep(0);
    expect(r.writes).toHaveLength(before);
  });
});
