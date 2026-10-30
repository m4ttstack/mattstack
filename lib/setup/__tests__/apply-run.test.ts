import { describe, expect, test } from "bun:test";
import { APPLY_RUN_LOCK_MAX_AGE_MS, applyEventsPath, applyRunLockPath, attachToRun, recordingEmit, resumePoint } from "../apply-run.ts";
import type { ApplyEvent } from "../contract.ts";
import { setupStatePath, type SetupRun } from "../state.ts";
import { fakeProbes } from "./fakes.ts";

const EVENTS = applyEventsPath("/fake-home");

function ndjson(...events: ApplyEvent[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

const PLAN: ApplyEvent = { event: "plan", steps: [{ id: "home.init", title: "home.init", kind: "rt" }, { id: "path.link", title: "path.link", kind: "rt" }] };

describe("where a run keeps its lock and its events", () => {
  test("both sit beside setup-state.json, and the lock goes stale after two hours", () => {
    expect(applyRunLockPath("/fake-home")).toBe("/fake-home/.mattstack/rt/setup-apply.lock");
    expect(applyEventsPath("/fake-home")).toBe("/fake-home/.mattstack/rt/setup-run.ndjson");
    expect(APPLY_RUN_LOCK_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("resumePoint", () => {
  test("resume starts at the first step the run had not finished", () => {
    const run: SetupRun = { startedAt: "2026-01-01T00:00:00.000Z", done: ["home.init", "path.link"] };
    expect(resumePoint(run, ["home.init", "path.link", "proxy.install", "verify"])).toBe("proxy.install");
  });

  test("an ended run has no resume point", () => {
    const ended: SetupRun = { startedAt: "2026-01-01T00:00:00.000Z", done: ["home.init"], endedAt: "2026-01-01T00:05:00.000Z", ok: false, failed: { step: "path.link", detail: "boom" } };
    expect(resumePoint(ended, ["home.init", "path.link"])).toBeUndefined();
    expect(resumePoint(undefined, ["home.init", "path.link"])).toBeUndefined();
  });
});

describe("recordingEmit", () => {
  test("events are appended one per line", () => {
    const p = fakeProbes({ files: { [EVENTS]: "left by the last run\n" } });
    const forwarded: ApplyEvent[] = [];
    const emit = recordingEmit(p, (ev) => forwarded.push(ev), { truncate: true });

    emit(PLAN);
    emit({ event: "log", id: "home.init", line: "one\ntwo" });
    emit({ event: "done", ok: true });

    expect(p.readFile(EVENTS)).toBe(ndjson(PLAN, { event: "log", id: "home.init", line: "one\ntwo" }, { event: "done", ok: true }));
    expect(forwarded).toEqual([PLAN, { event: "log", id: "home.init", line: "one\ntwo" }, { event: "done", ok: true }]);
  });

  test("without truncate the file keeps what it had", () => {
    const p = fakeProbes({ files: { [EVENTS]: ndjson(PLAN) } });
    recordingEmit(p, () => {}, { truncate: false })({ event: "done", ok: true });
    expect(p.readFile(EVENTS)).toBe(ndjson(PLAN, { event: "done", ok: true }));
  });

  test("a forward that throws still records the event", () => {
    const p = fakeProbes();
    const emit = recordingEmit(
      p,
      () => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
      { truncate: true },
    );

    expect(() => emit(PLAN)).not.toThrow();
    expect(() => emit({ event: "done", ok: true })).not.toThrow();
    expect(p.readFile(EVENTS)).toBe(ndjson(PLAN, { event: "done", ok: true }));
  });
});

describe("attachToRun", () => {
  test("attach replays then follows until done", async () => {
    const p = fakeProbes({ files: { [EVENTS]: ndjson(PLAN, { event: "step", id: "home.init", state: "running" }) } });
    const seen: ApplyEvent[] = [];
    const later: ApplyEvent[] = [
      { event: "step", id: "home.init", state: "done" },
      { event: "step", id: "path.link", state: "running" },
      { event: "step", id: "path.link", state: "done" },
      { event: "done", ok: true },
    ];
    let polls = 0;
    const result = await attachToRun(p, (ev) => seen.push(ev), {
      holderAlive: () => true,
      sleep: async () => {
        polls++;
        const next = later.shift();
        if (next) p.appendFile(EVENTS, `${JSON.stringify(next)}\n`);
      },
    });

    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([
      PLAN,
      { event: "step", id: "home.init", state: "running" },
      { event: "step", id: "home.init", state: "done" },
      { event: "step", id: "path.link", state: "running" },
      { event: "step", id: "path.link", state: "done" },
      { event: "done", ok: true },
    ]);
    expect(polls).toBe(4);
  });

  test("a line still being written waits for its newline", async () => {
    const p = fakeProbes({ files: { [EVENTS]: `${ndjson(PLAN)}{"event":"done",` } });
    const seen: ApplyEvent[] = [];
    const result = await attachToRun(p, (ev) => seen.push(ev), {
      holderAlive: () => true,
      sleep: async () => {
        p.writeFile(EVENTS, `${p.readFile(EVENTS)}"ok":true}\n`);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([PLAN, { event: "done", ok: true }]);
  });

  test("attach ends failed when the holder dies before done", async () => {
    const p = fakeProbes({ files: { [EVENTS]: ndjson(PLAN, { event: "step", id: "home.init", state: "running" }) } });
    const seen: ApplyEvent[] = [];
    let alive = true;
    const result = await attachToRun(p, (ev) => seen.push(ev), {
      holderAlive: () => alive,
      sleep: async () => {
        alive = false;
      },
    });

    expect(result).toEqual({ ok: false });
    expect(seen.at(-1)).toEqual({ event: "done", ok: false });
    expect(seen).toHaveLength(3);
  });

  // The holder writes its record's end and lets go of the lock before its
  // done event lands, so a reader can find the lock free a moment early.
  test("a holder that let go before its done landed ends as its record says", async () => {
    const record = (run: SetupRun) => JSON.stringify({ v: 2, run });
    const ended = { startedAt: "2026-01-01T00:00:00.000Z", done: ["home.init" as const], endedAt: "2026-01-01T00:05:00.000Z" };

    const okRun = fakeProbes({ files: { [EVENTS]: ndjson(PLAN), [setupStatePath("/fake-home")]: record({ ...ended, ok: true }) } });
    const okSeen: ApplyEvent[] = [];
    expect(await attachToRun(okRun, (ev) => okSeen.push(ev), { holderAlive: () => false })).toEqual({ ok: true });
    expect(okSeen.at(-1)).toEqual({ event: "done", ok: true });

    const failed = fakeProbes({ files: { [EVENTS]: ndjson(PLAN), [setupStatePath("/fake-home")]: record({ ...ended, ok: false, failed: { step: "path.link", detail: "boom" } }) } });
    const failedSeen: ApplyEvent[] = [];
    expect(await attachToRun(failed, (ev) => failedSeen.push(ev), { holderAlive: () => false })).toEqual({ ok: false });
    expect(failedSeen.at(-1)).toEqual({ event: "done", ok: false, failedStep: "path.link" });
  });

  test("a holder that died before its first event leaves the last run's record alone", async () => {
    const p = fakeProbes({ files: { [setupStatePath("/fake-home")]: JSON.stringify({ v: 2, run: { startedAt: "x", done: [], endedAt: "y", ok: true } }) } });
    const seen: ApplyEvent[] = [];
    expect(await attachToRun(p, (ev) => seen.push(ev), { holderAlive: () => false })).toEqual({ ok: false });
    expect(seen).toEqual([{ event: "done", ok: false }]);
  });

  test("attach performs only a need still waiting at the tail", async () => {
    const answered: ApplyEvent = { event: "need", id: "services.register", request: { type: "app-register-services", plists: ["a.plist"] } };
    const waiting: ApplyEvent = { event: "need", id: "proxy.install", request: { type: "app-privileged", op: "proxy-install" } };
    const p = fakeProbes({
      files: {
        [EVENTS]: ndjson(
          PLAN,
          { event: "step", id: "services.register", state: "running" },
          answered,
          { event: "step", id: "services.register", state: "done" },
          { event: "step", id: "proxy.install", state: "running" },
          waiting,
        ),
      },
    });
    const seen: ApplyEvent[] = [];
    let alive = true;
    await attachToRun(p, (ev) => seen.push(ev), {
      holderAlive: () => alive,
      sleep: async () => {
        alive = false;
      },
    });

    expect(seen.filter((e) => e.event === "need")).toEqual([waiting]);
    expect(seen).toContainEqual({ event: "step", id: "services.register", state: "done" });
  });
});
