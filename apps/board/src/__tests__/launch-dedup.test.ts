import { expect, test } from 'bun:test';

import { DOCTOR_QUIET_MS } from '../doctor-quiet.ts';
import {
  dedupInFlight,
  DOCTOR_IN_FLIGHT,
  doctorDedupLane,
  quietDoctorRedo,
  REVIEW_IN_FLIGHT,
} from '../launch-dedup.ts';

const live = { status: 'reviewing', tabId: 't1', paneId: 'p1' };
const focusOk = { focusPane: async () => ({ focused: true }) };
const focusGone = {
  focusPane: async () => {
    throw new Error('tab not found');
  },
};

test('a live in-flight lane is focused, whatever the click asked for', async () => {
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, false, focusOk)).toEqual({
    kind: 'focused',
  });
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, true, focusOk)).toEqual({
    kind: 'focused',
  });
});

test('a launch click falls through to a fresh launch when nothing is running or the pane is gone', async () => {
  expect(
    await dedupInFlight(undefined, REVIEW_IN_FLIGHT, false, focusOk)
  ).toEqual({ kind: 'launch' });
  expect(
    await dedupInFlight(
      { status: 'done', tabId: 't1' },
      REVIEW_IN_FLIGHT,
      false,
      focusOk
    )
  ).toEqual({ kind: 'launch' });
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, false, focusGone)).toEqual(
    { kind: 'launch' }
  );
});

test('a focus click never launches: it refuses with the reason', async () => {
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, true, focusGone)).toEqual({
    kind: 'refused',
    reason: 'pane is gone',
  });
  expect(
    await dedupInFlight(undefined, REVIEW_IN_FLIGHT, true, focusOk)
  ).toEqual({ kind: 'refused', reason: 'nothing running to focus' });
  expect(
    await dedupInFlight(
      { status: 'reviewing' },
      REVIEW_IN_FLIGHT,
      true,
      focusOk
    )
  ).toEqual({ kind: 'refused', reason: 'nothing running to focus' });
});

test('a rebase waiting on the forge is a doctor in flight', () => {
  expect(DOCTOR_IN_FLIGHT.has('forge-rebasing')).toBe(true);
});

test('redo on a quiet doctor launches fresh even with its pane still open; a focus click still focuses', async () => {
  const now = 10 * 60 * 60_000;
  const quiet = {
    status: 'watching',
    tabId: 't1',
    paneId: 'p1',
    updatedAt: now - DOCTOR_QUIET_MS - 60_000,
  };
  const redo = await dedupInFlight(
    doctorDedupLane(quiet, false, now),
    DOCTOR_IN_FLIGHT,
    false,
    focusOk
  );
  expect(redo).toEqual({ kind: 'launch' });
  const focus = await dedupInFlight(
    doctorDedupLane(quiet, true, now),
    DOCTOR_IN_FLIGHT,
    true,
    focusOk
  );
  expect(focus).toEqual({ kind: 'focused' });
  const working = await dedupInFlight(
    doctorDedupLane({ ...quiet, updatedAt: now - 60_000 }, false, now),
    DOCTOR_IN_FLIGHT,
    false,
    focusOk
  );
  expect(working).toEqual({ kind: 'focused' });
});

test('only a launch click on a quiet doctor is a redo; a focus click or a working doctor is not', () => {
  const now = 10 * 60 * 60_000;
  const quiet = {
    status: 'fixing',
    tabId: 't9',
    updatedAt: now - DOCTOR_QUIET_MS - 60_000,
  };
  expect(quietDoctorRedo(quiet, false, now)).toBe(true);
  expect(quietDoctorRedo(quiet, true, now)).toBe(false);
  expect(
    quietDoctorRedo({ ...quiet, updatedAt: now - 60_000 }, false, now)
  ).toBe(false);
  expect(quietDoctorRedo(undefined, false, now)).toBe(false);
});
