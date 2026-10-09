import { describe, expect, test } from 'bun:test';

import {
  doctorFilePath,
  readDoctorStates,
  writeDoctorState,
  type DoctorState,
  type DoctorStatus,
} from '../doctor-state.ts';
import {
  reconcileStandDowns,
  STAND_DOWN_BACKGROUND_MESSAGE,
  standDownDoctor,
  standDownPane,
  waitForBackground,
  type BackgroundWatchIo,
  type DoctorStandDownDeps,
  type StandDownIo,
} from '../stand-down.ts';
import { openStateDb } from '../state/db.ts';

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

  function rows(initial: Partial<DoctorState> & { status: DoctorStatus }) {
    const db = openStateDb(':memory:');
    const path = doctorFilePath(MR);
    writeDoctorState(path, { mrUrl: MR, iid: 7, ...initial }, 1000, db);
    const releases: (() => void)[] = [];
    const watched: string[] = [];
    let n = 0;
    const deps: DoctorStandDownDeps = {
      readDoctor: url => readDoctorStates(db).get(url),
      writeDoctor: (p, patch) => {
        writeDoctorState(p, patch, Date.now(), db);
      },
      doctorPath: doctorFilePath,
      inFlight: IN_FLIGHT,
      standDown: async () => ({
        path: 'mod',
        sessionId: 'sess-1',
        background: true,
      }),
      watch: sessionId => {
        watched.push(sessionId);
        return new Promise(resolve => releases.push(() => resolve('finished')));
      },
      newToken: () => `tok-${++n}`,
      log: () => {},
    };
    const row = () => readDoctorStates(db).get(MR)!;
    const finish = async (i = 0) => {
      releases[i]!();
      await Bun.sleep(0);
    };
    return { db, path, deps, watched, row, finish };
  }

  test('a pane left finishing background work reads that way until it ends', async () => {
    const r = rows({ status: 'fixing', paneId: 'w1:p1' });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);

    expect(r.row()).toMatchObject({
      status: 'done',
      message: STAND_DOWN_BACKGROUND_MESSAGE,
      backgroundFinishing: true,
      standDownRef: { token: 'tok-1', sessionId: 'sess-1' },
    });
    expect(r.watched).toEqual(['sess-1']);

    await r.finish();
    expect(r.row().message).toBe('stood down by operator');
    expect(r.row().backgroundFinishing).toBeUndefined();
    expect(r.row().standDownRef).toBeUndefined();
  });

  test('a plain stand-down writes the row as it always has', async () => {
    const r = rows({ status: 'fixing', paneId: 'w1:p1' });
    r.deps.standDown = async () => ({ path: 'pane', background: false });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    const row = r.row();
    expect(row.status).toBe('done');
    expect(row.message).toBe('stood down by operator');
    expect('backgroundFinishing' in row).toBe(false);
    expect('standDownRef' in row).toBe(false);
    expect(r.watched).toEqual([]);
  });

  test('a failed nudge is logged and the row is still cleared', async () => {
    const r = rows({ status: 'watching', paneId: 'w1:p1' });
    const logged: string[] = [];
    r.deps.standDown = async () => {
      throw new Error('herdr exited 1');
    };
    r.deps.log = m => logged.push(m);
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    expect(logged).toEqual(['stand-down pane nudge failed: herdr exited 1']);
    expect(r.row().message).toBe('stood down by operator');
  });

  test("a relaunch ends the finishing state, and the old watcher never touches the new run's row", async () => {
    const r = rows({ status: 'fixing', paneId: 'w1:p1' });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);

    // What a launch writes: queued with the new pane, nothing about the stand-down.
    writeDoctorState(
      r.path,
      { status: 'queued', tabId: 't2', agentId: 'a2', paneId: 'w1:p2' },
      Date.now(),
      r.db
    );
    expect(r.row().backgroundFinishing).toBeUndefined();
    expect(r.row().standDownRef).toBeUndefined();

    await r.finish();
    expect(r.row().status).toBe('queued');
    expect(r.row().message).toBeUndefined();
  });

  test('a second stand-down finishes only its own', async () => {
    const r = rows({ status: 'fixing', paneId: 'w1:p1' });
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    writeDoctorState(
      r.path,
      { status: 'fixing', paneId: 'w1:p1' },
      Date.now(),
      r.db
    );
    await standDownDoctor({ webUrl: MR, iid: 7 }, r.deps);
    expect(r.row().standDownRef?.token).toBe('tok-2');

    // The first stand-down's work ending does not end the second's.
    await r.finish(0);
    expect(r.row().backgroundFinishing).toBe(true);
    await r.finish(1);
    expect(r.row().backgroundFinishing).toBeUndefined();
  });
});

describe('reconcileStandDowns', () => {
  const MR = 'https://gitlab.example.com/g/p/-/merge_requests/9';

  function finishing(state: string | null | Error) {
    const db = openStateDb(':memory:');
    const path = doctorFilePath(MR);
    writeDoctorState(
      path,
      {
        mrUrl: MR,
        iid: 9,
        status: 'done',
        message: STAND_DOWN_BACKGROUND_MESSAGE,
        backgroundFinishing: true,
        standDownRef: { token: 'tok-9', sessionId: 'sess-9' },
      },
      1000,
      db
    );
    let release!: () => void;
    const watched: string[] = [];
    const run = () =>
      reconcileStandDowns({
        doctors: () => readDoctorStates(db).values(),
        readDoctor: url => readDoctorStates(db).get(url),
        writeDoctor: (p, patch) => {
          writeDoctorState(p, patch, Date.now(), db);
        },
        doctorPath: doctorFilePath,
        watch: sessionId => {
          watched.push(sessionId);
          return new Promise(resolve => (release = () => resolve('finished')));
        },
        state: async () =>
          state instanceof Error
            ? { ok: false, error: state.message }
            : { ok: true, data: { state: state as never } },
      });
    return {
      run,
      watched,
      row: () => readDoctorStates(db).get(MR)!,
      release: () => release(),
    };
  }

  test('a session that ended, or that rt no longer knows, ends finishing at boot', async () => {
    for (const state of ['ended', null, new Error('rt daemon not reachable')]) {
      const f = finishing(state);
      await f.run();
      expect(f.row().message).toBe('stood down by operator');
      expect(f.row().backgroundFinishing).toBeUndefined();
      expect(f.watched).toEqual([]);
    }
  });

  test('a session still finishing gets its watcher back', async () => {
    const f = finishing('stood-down-background');
    await f.run();
    expect(f.row().backgroundFinishing).toBe(true);
    expect(f.watched).toEqual(['sess-9']);
    f.release();
    await Bun.sleep(0);
    expect(f.row().backgroundFinishing).toBeUndefined();
    expect(f.row().message).toBe('stood down by operator');
  });
});
