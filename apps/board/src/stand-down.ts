import {
  boardStandDown as rtBoardStandDown,
  boardStandDownState as rtBoardStandDownState,
} from '@mattstack/rt-client';
import { integrationsOn } from './caller-session.ts';
import {
  planStandDown,
  STAND_DOWN_PANE_MESSAGE,
  type DoctorState,
  type DoctorStatus,
} from './doctor-state.ts';
import { sendPaneText } from './herdr.ts';

/** The doctor row's message while a stood-down pane's background work is still running. */
export const STAND_DOWN_BACKGROUND_MESSAGE =
  'stood down; background work finishing';

const STOOD_DOWN_MESSAGE = 'stood down by operator';

export interface StandDownIo {
  switchOn(): boolean;
  push: (a: { pane: string }) => ReturnType<typeof rtBoardStandDown>;
  sendPaneText(paneId: string, text: string): Promise<void>;
}

export const defaultStandDownIo: StandDownIo = {
  switchOn: () => integrationsOn(),
  push: a => rtBoardStandDown(a),
  sendPaneText: (paneId, text) => sendPaneText(paneId, text),
};

export interface StandDownResult {
  /** `mod`: the session's own mod ended its turn; `pane`: the text was typed into the pane. */
  path: 'mod' | 'pane';
  sessionId?: string;
  /** The mod ended the turn, but work it started is still finishing. */
  background: boolean;
}

/** Stands down the agent in `paneId`: through its Claude mod when the
    integrations switch is on and the mod acks (the mod tells the session
    STAND_DOWN_PANE_MESSAGE itself), else, and only once, by typing `text`
    into the pane as before. A failed pane nudge throws, as it always has. */
export async function standDownPane(
  paneId: string,
  text: string,
  io: StandDownIo = defaultStandDownIo
): Promise<StandDownResult> {
  if (io.switchOn()) {
    let acked: Awaited<ReturnType<StandDownIo['push']>> | null = null;
    try {
      acked = await io.push({ pane: paneId });
    } catch {
      acked = null;
    }
    if (acked?.ok && acked.data?.acked) {
      return {
        path: 'mod',
        ...(acked.data.sessionId ? { sessionId: acked.data.sessionId } : {}),
        background: acked.data.state === 'stood-down-background',
      };
    }
  }
  await io.sendPaneText(paneId, text);
  return { path: 'pane', background: false };
}

export interface BackgroundWatchIo {
  state: (sessionId: string) => ReturnType<typeof rtBoardStandDownState>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const defaultBackgroundWatchIo: BackgroundWatchIo = {
  state: sessionId => rtBoardStandDownState({ sessionId }),
  sleep: ms => Bun.sleep(ms),
  now: () => Date.now(),
};

export const BACKGROUND_POLL_MS = 5_000;
export const BACKGROUND_LIMIT_MS = 30 * 60_000;

/** Waits until the stood-down session's background work has finished or the
    session has ended; `timeout` after BACKGROUND_LIMIT_MS, so a row never
    reads "finishing" forever. */
export async function waitForBackground(
  sessionId: string,
  io: BackgroundWatchIo = defaultBackgroundWatchIo
): Promise<'finished' | 'ended' | 'timeout'> {
  const deadline = io.now() + BACKGROUND_LIMIT_MS;
  for (;;) {
    const res = await io.state(sessionId).catch(() => null);
    const state = res?.ok ? res.data?.state : undefined;
    if (state === 'background-finished') return 'finished';
    if (state === 'ended') return 'ended';
    if (io.now() >= deadline) return 'timeout';
    await io.sleep(BACKGROUND_POLL_MS);
  }
}

export interface DoctorStandDownDeps {
  readDoctor(mrUrl: string): DoctorState | undefined;
  writeDoctor(
    path: string,
    patch: Partial<DoctorState> & { status: DoctorStatus }
  ): void;
  doctorPath(mrUrl: string): string;
  inFlight: ReadonlySet<string>;
  standDown(paneId: string, text: string): Promise<StandDownResult>;
  watch(sessionId: string): Promise<'finished' | 'ended' | 'timeout'>;
  newToken(): string;
  log(message: string): void;
}

/** Ends "finishing" on `mrUrl`'s row, but only while the row still carries
    the stand-down `token` wrote: any later write has already ended it. */
function finishStandDown(
  mrUrl: string,
  token: string,
  deps: Pick<DoctorStandDownDeps, 'readDoctor' | 'writeDoctor' | 'doctorPath'>
): void {
  const row = deps.readDoctor(mrUrl);
  if (!row?.backgroundFinishing || row.standDownRef?.token !== token) return;
  deps.writeDoctor(deps.doctorPath(mrUrl), {
    status: row.status,
    message: STOOD_DOWN_MESSAGE,
  });
}

/** One MR's share of an operator stand-down: tell a live doctor pane to
    stop, then close its row out. A pane whose mod stood down with
    background work still running reads "finishing" until that work ends. */
export async function standDownDoctor(
  target: { webUrl: string; iid: number },
  deps: DoctorStandDownDeps
): Promise<void> {
  const plan = planStandDown(deps.readDoctor(target.webUrl), deps.inFlight);
  let result: StandDownResult | null = null;
  if (plan.paneToNudge) {
    try {
      result = await deps.standDown(plan.paneToNudge, STAND_DOWN_PANE_MESSAGE);
    } catch (err) {
      deps.log(
        `stand-down pane nudge failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  if (!plan.clearDoctorState) return;
  const sessionId = result?.background ? result.sessionId : undefined;
  const token = sessionId ? deps.newToken() : undefined;
  deps.writeDoctor(deps.doctorPath(target.webUrl), {
    mrUrl: target.webUrl,
    iid: target.iid,
    status: 'done',
    message: sessionId ? STAND_DOWN_BACKGROUND_MESSAGE : STOOD_DOWN_MESSAGE,
    ...(sessionId && token
      ? { backgroundFinishing: true, standDownRef: { token, sessionId } }
      : {}),
  });
  if (!sessionId || !token) return;
  void deps
    .watch(sessionId)
    .then(() => finishStandDown(target.webUrl, token, deps));
}

/** Board boot: a row left "finishing" by a stand-down this process no
    longer watches. One whose session ended or that rt no longer knows ends
    now; one still finishing gets its watcher back. */
export async function reconcileStandDowns(
  deps: Pick<
    DoctorStandDownDeps,
    'readDoctor' | 'writeDoctor' | 'doctorPath' | 'watch'
  > & {
    doctors(): Iterable<DoctorState>;
    state: BackgroundWatchIo['state'];
  }
): Promise<void> {
  for (const row of deps.doctors()) {
    const ref = row.standDownRef;
    if (!row.backgroundFinishing) continue;
    const res = ref ? await deps.state(ref.sessionId).catch(() => null) : null;
    const state = res?.ok ? res.data?.state : undefined;
    if (ref && state === 'stood-down-background') {
      void deps
        .watch(ref.sessionId)
        .then(() => finishStandDown(row.mrUrl, ref.token, deps));
      continue;
    }
    deps.writeDoctor(deps.doctorPath(row.mrUrl), {
      status: row.status,
      message: STOOD_DOWN_MESSAGE,
    });
  }
}
