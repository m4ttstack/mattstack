/** Holds one support wait open on the relay and pulls on every wake and timeout. */
import type { Logger } from "pino";
import type { SupportKind } from "../../packages/rt-client/src/support.ts";
import { nextBackoffMs } from "../daemon/peer-waker.ts";
import type { SupportRelay } from "./relay.ts";

const IDLE_MS = 15_000;
const NO_RELAY_MS = 60_000;

export interface SupportLoopDeps {
  kind: SupportKind;
  /** While false the loop makes no relay call. */
  active(): boolean;
  relay(): Promise<SupportRelay | null>;
  pull(): Promise<unknown>;
  log: Pick<Logger, "warn" | "info">;
  sleep?: (ms: number) => Promise<void>;
}

export interface SupportLoopHandle {
  stop(): void;
  /** Ends an idle sleep, so a change takes effect now. */
  poke(): void;
  done: Promise<void>;
}

export function startSupportLoop(deps: SupportLoopDeps): SupportLoopHandle {
  const stopping = new AbortController();
  let wake: () => void = () => {};
  let poked = false;
  const pokeable = (ms: number) =>
    new Promise<void>((resolve) => {
      if (poked) return resolve();
      const end = () => {
        clearTimeout(timer);
        stopping.signal.removeEventListener("abort", end);
        resolve();
      };
      const timer = setTimeout(end, ms);
      wake = end;
      if (stopping.signal.aborted) end();
      else stopping.signal.addEventListener("abort", end, { once: true });
    });
  const sleep = deps.sleep ?? pokeable;

  async function pull(): Promise<void> {
    try {
      await deps.pull();
    } catch (err) {
      deps.log.warn({ err, kind: deps.kind }, "support: a pull failed");
    }
  }

  async function relayOrPause(): Promise<SupportRelay | number> {
    try {
      if (!deps.active()) return IDLE_MS;
      return (await deps.relay()) ?? NO_RELAY_MS;
    } catch (err) {
      deps.log.warn({ err, kind: deps.kind }, "support: the loop could not read its settings");
      return IDLE_MS;
    }
  }

  const done = (async () => {
    let cursor = 0;
    let failures = 0;
    let fresh = true;
    while (!stopping.signal.aborted) {
      poked = false;
      const relay = await relayOrPause();
      if (typeof relay === "number") {
        fresh = true;
        await sleep(relay);
        continue;
      }
      if (fresh) await pull();
      fresh = false;
      if (stopping.signal.aborted) break;
      const outcome = await relay.wait(deps.kind, cursor, stopping.signal);
      if (stopping.signal.aborted) break;
      if (outcome === null) {
        if (failures === 0) deps.log.warn({ kind: deps.kind }, "support: the relay is not answering");
        await sleep(nextBackoffMs(failures++));
        continue;
      }
      if (failures > 0) deps.log.info({ kind: deps.kind }, "support: the relay is answering again");
      failures = 0;
      if (outcome.woke) cursor = Math.max(cursor, outcome.cursor);
      // A timed-out wait pulls too: a relay restarted with its clock behind the cursor never wakes it.
      await pull();
    }
  })();

  return {
    stop: () => stopping.abort(),
    poke() {
      poked = true;
      wake();
    },
    done,
  };
}
