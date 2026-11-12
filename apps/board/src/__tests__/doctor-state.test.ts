import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  doctorFilePath,
  doctorResumeDispatchFields,
  failOrphanedSyncs,
  NO_SYNC_CARRY,
  parseDoctorRequestBody,
  planStandDown,
  readDoctorStates,
  writeDoctorState,
} from '../doctor-state.ts';
import { dispatchPrompt } from '../herdr.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('doctor state origin', () => {
  test('origin persists across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      { mrUrl: 'https://x/mr/1', iid: 1, status: 'queued', origin: 'auto' },
      1000,
      db
    );
    const next = writeDoctorState(path, { status: 'diagnosing' }, 2000, db);
    expect(next.origin).toBe('auto');
  });
});

describe('doctor state boardTabId', () => {
  test('the launch write keeps the board tab, and a launch with none clears it', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'queued',
        origin: 'manual',
        boardTabId: 'gadgets-tab',
      },
      1000,
      db
    );
    writeDoctorState(path, { status: 'fixing', tabId: 'w1:t1' }, 2000, db);
    expect(readDoctorStates(db).get('https://x/mr/1')?.boardTabId).toBe(
      'gadgets-tab'
    );
    writeDoctorState(
      path,
      { status: 'queued', origin: 'auto', boardTabId: '' },
      3000,
      db
    );
    expect(readDoctorStates(db).get('https://x/mr/1')?.boardTabId).toBe('');
  });
});

describe('writeDoctorState identity', () => {
  test('a write with no prior row and no identity throws loudly', () => {
    expect(() =>
      writeDoctorState(
        doctorFilePath('https://x/mr/1'),
        { status: 'diagnosing' },
        1000,
        db
      )
    ).toThrow(/no prior row and no identity/);
  });
});

describe('doctor state gate fields (merge-list widening)', () => {
  test('gateId, gateKind, and resumedGateId all persist across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'fixing',
        gateId: 'gate-1',
        gateKind: 'doctor-escalation',
      },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.gateId).toBe('gate-1');
    expect(next.gateKind).toBe('doctor-escalation');

    const answered = writeDoctorState(
      path,
      { status: 'fixing', resumedGateId: 'gate-1' },
      3000,
      db
    );
    expect(answered.resumedGateId).toBe('gate-1');
  });
});

describe('doctor state tier/fixClasses fields (merge-list widening)', () => {
  test('tier and fixClasses persist across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'queued',
        origin: 'auto',
        tier: 'api',
        fixClasses: ['lint', 'types'],
      },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.tier).toBe('api');
    expect(next.fixClasses).toEqual(['lint', 'types']);
  });

  test('a manual doctor with no tier stays untiered across patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      { mrUrl: 'https://x/mr/1', iid: 1, status: 'queued', origin: 'manual' },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.tier).toBeUndefined();
    expect(next.fixClasses).toBeUndefined();
  });
});

describe('resumed doctor dispatch carries its original tier/fixClasses', () => {
  test('an api-tier doctor with fix classes resumes with --tier, --fix-classes, and --draft-bin', async () => {
    const state = { tier: 'api', fixClasses: ['lint', 'types'] };
    const prompt = await dispatchPrompt('board:doctor', {
      mrUrl: 'https://x/mr/1',
      statePath: '/state/doctors/x.json',
      statusBin: '/bin/board',
      resumedGate: 'gate-1',
      ...doctorResumeDispatchFields(state),
    });
    expect(prompt).toContain('--tier api');
    expect(prompt).toContain('--fix-classes lint,types');
    expect(prompt).toContain('--draft-bin');
  });

  test('a manual checkout-tier doctor (no tier on file) resumes without --tier or --fix-classes', async () => {
    const prompt = await dispatchPrompt('board:doctor', {
      mrUrl: 'https://x/mr/1',
      statePath: '/state/doctors/x.json',
      statusBin: '/bin/board',
      resumedGate: 'gate-1',
      ...doctorResumeDispatchFields(undefined),
    });
    expect(prompt).not.toContain('--tier');
    expect(prompt).not.toContain('--fix-classes');
    expect(prompt).toContain('--draft-bin');
  });
});

describe('parseDoctorRequestBody', () => {
  const base = { mrUrl: 'https://gitlab.com/o/r/-/merge_requests/3', iid: 3 };

  test('plain launch body parses without a mode', () => {
    expect(parseDoctorRequestBody(base)).toEqual({ ...base, mode: undefined });
  });

  test('mode rebase is carried through', () => {
    expect(parseDoctorRequestBody({ ...base, mode: 'rebase' })).toEqual({
      ...base,
      mode: 'rebase',
    });
  });

  test('an unknown mode is rejected', () => {
    expect(parseDoctorRequestBody({ ...base, mode: 'fix-all' })).toBeNull();
  });

  test('parseDoctorRequestBody accepts ring: true and rejects other ring values', () => {
    expect(parseDoctorRequestBody({ ...base, ring: true })).toEqual({
      ...base,
      ring: true,
    });
    expect(
      parseDoctorRequestBody({ ...base, mode: 'rebase', ring: true })
    ).toEqual({ ...base, mode: 'rebase', ring: true });
    expect(parseDoctorRequestBody({ ...base, ring: false })).toBeNull();
    expect(parseDoctorRequestBody({ ...base, ring: 'yes' })).toBeNull();
    expect(parseDoctorRequestBody(base)?.ring).toBeUndefined();
  });
});

describe('planStandDown', () => {
  const IN_FLIGHT = new Set(['queued', 'diagnosing', 'fixing']);

  test('no existing doctor row: nothing to nudge or clear', () => {
    expect(planStandDown(undefined, IN_FLIGHT)).toEqual({
      paneToNudge: null,
      clearDoctorState: false,
    });
  });

  test('a terminal doctor row (already done/error): clear it, nothing to nudge', () => {
    const state = {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'error' as const,
      paneId: 'p1',
      startedAt: 0,
      updatedAt: 0,
    };
    expect(planStandDown(state, IN_FLIGHT)).toEqual({
      paneToNudge: null,
      clearDoctorState: true,
    });
  });

  test('an in-flight doctor with a live pane: nudge it and clear the row', () => {
    const state = {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'fixing' as const,
      paneId: 'p1',
      startedAt: 0,
      updatedAt: 0,
    };
    expect(planStandDown(state, IN_FLIGHT)).toEqual({
      paneToNudge: 'p1',
      clearDoctorState: true,
    });
  });

  test('an in-flight doctor with no paneId yet (launch still resolving): clear it, nothing to nudge', () => {
    const state = {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'queued' as const,
      startedAt: 0,
      updatedAt: 0,
    };
    expect(planStandDown(state, IN_FLIGHT)).toEqual({
      paneToNudge: null,
      clearDoctorState: true,
    });
  });
});

describe('failOrphanedSyncs', () => {
  const syncing = (mrUrl: string) =>
    writeDoctorState(
      doctorFilePath(mrUrl),
      { mrUrl, iid: 1, status: 'syncing' },
      1,
      db
    );

  test('a sync no request is running ends in an error', () => {
    syncing('u/1');
    failOrphanedSyncs(new Set(), 2, db);
    expect(readDoctorStates(db).get('u/1')).toMatchObject({
      status: 'sync-stopped',
      message: 'the board restarted during the sync',
    });
  });

  test('a running sync is left alone', () => {
    syncing('u/2');
    failOrphanedSyncs(new Set(['u/2']), 2, db);
    expect(readDoctorStates(db).get('u/2')?.status).toBe('syncing');
  });

  test('failOrphanedSyncs fails a forge-rebasing row', () => {
    writeDoctorState(
      doctorFilePath('u/4'),
      { mrUrl: 'u/4', iid: 1, status: 'forge-rebasing' },
      1,
      db
    );
    failOrphanedSyncs(new Set(), 2, db);
    expect(readDoctorStates(db).get('u/4')).toMatchObject({
      status: 'sync-stopped',
      message: 'the board restarted during the rebase',
    });
  });

  test('a forge wait a request is running is left alone', () => {
    writeDoctorState(
      doctorFilePath('u/5'),
      { mrUrl: 'u/5', iid: 1, status: 'forge-rebasing' },
      1,
      db
    );
    failOrphanedSyncs(new Set(['u/5']), 2, db);
    expect(readDoctorStates(db).get('u/5')?.status).toBe('forge-rebasing');
  });
});

test('a launch with NO_SYNC_CARRY drops an earlier forge step', () => {
  const path = doctorFilePath('u/6');
  writeDoctorState(
    path,
    {
      mrUrl: 'u/6',
      iid: 1,
      status: 'sync-stopped',
      forge: { forge: 'gitlab', state: 'failed', detail: 'x' },
    },
    1,
    db
  );
  const next = writeDoctorState(
    path,
    { status: 'queued', ...NO_SYNC_CARRY },
    2,
    db
  );
  expect(next.forge).toBeUndefined();
});

test('dispatchPrompt carries the paused tree', async () => {
  const prompt = await dispatchPrompt(
    'board:doctor',
    {
      mrUrl: 'u/3',
      statePath: 'state',
      statusBin: 'bin',
      pausedTree: '/trees/elrond',
    },
    async () => ({ ok: true as const, path: '/unused' })
  );
  expect(prompt).toContain('--paused-tree /trees/elrond');
});
