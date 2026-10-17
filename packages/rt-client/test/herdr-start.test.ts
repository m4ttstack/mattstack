import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { herdrStart } from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

describe("herdrStart", () => {
  test("defaults to a 30s budget, overridable via opts", async () => {
    const { sock, stop } = fakeDaemon({
      "herdr:start": { ok: true, data: { state: "started", bin: "/opt/acme/herdr" } },
    });
    stops.push(stop);
    const spy = spyOn(AbortSignal, "timeout");
    await herdrStart({ sockPath: sock });
    await herdrStart({ sockPath: sock, timeoutMs: 3_000 });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([30_000, 3_000]);
    spy.mockRestore();
  });
});
