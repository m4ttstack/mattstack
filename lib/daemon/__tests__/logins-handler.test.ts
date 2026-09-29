import { describe, expect, test } from "bun:test";
import { createLoginsHandlers } from "../handlers/logins.ts";
import { AttemptLimiter, ATTEMPT_WINDOW_MS } from "../../logins/attempt-limit.ts";
import type { DevLogin } from "../../logins/store.ts";

const TOKEN = "t0ken";
const CANARY = "Canary p@ss&+% ü";
const EMAIL = "dev@example.com";
const ORIGIN = "https://login.example.com";

function setup(login: DevLogin | null = { origin: ORIGIN, email: EMAIL, password: CANARY }) {
  const logged: unknown[] = [];
  const log = { info: (...a: unknown[]) => logged.push(a), debug: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a) };
  const clock = { t: 1_000_000 };
  let reads = 0;
  const state = { login };
  const h = createLoginsHandlers({ log } as any, {
    apiToken: () => TOKEN,
    readLogin: async () => { reads++; return state.login; },
    limiter: new AttemptLimiter(() => clock.t),
  })["logins:fill"];
  return { h, logged, clock, state, reads: () => reads };
}

const pw = { token: TOKEN, client: "fast-browser", pid: 42, name: "devlogin:login.example.com:password", frameOrigin: ORIGIN, elementKind: "password" as const };
const em = { ...pw, name: "devlogin:login.example.com:email", elementKind: "text" as const };

describe("logins:fill", () => {
  test("a missing or wrong token is ok:false and reads nothing", async () => {
    const s = setup();
    expect(await s.h({ ...pw, token: undefined })).toEqual({ ok: false, error: "missing-token" });
    expect(await s.h({ ...pw, token: "nope" })).toEqual({ ok: false, error: "bad-token" });
    expect(s.reads()).toBe(0);
  });

  test.each([
    ["a non-devlogin name", { name: "PASSWORD" }],
    ["no frameOrigin", { frameOrigin: undefined }],
    ["an unknown elementKind", { elementKind: "button" }],
  ])("malformed input (%s) is ok:false bad-payload", async (_l, patch) => {
    expect(await setup().h({ ...pw, ...patch })).toEqual({ ok: false, error: "bad-payload" });
  });

  test("an unsaved site is refused unknown", async () => {
    expect(await setup(null).h(pw)).toEqual({ ok: true, data: { refused: "unknown" } });
  });

  test("the right page gets the value", async () => {
    const s = setup();
    expect(await s.h(em)).toEqual({ ok: true, data: { origin: ORIGIN, kind: "email", value: EMAIL } });
    expect(await s.h(pw)).toEqual({ ok: true, data: { origin: ORIGIN, kind: "password", value: CANARY } });
  });

  test.each([
    "https://login.example.com.evil.test",
    "http://login.example.com",
    "https://login.example.com:8443",
    "null",
    "https://LOGIN.example.com",
  ])("frame origin %s is refused mismatch", async (frameOrigin) => {
    expect(await setup().h({ ...pw, frameOrigin })).toEqual({ ok: true, data: { refused: "mismatch" } });
  });

  test("a password name aimed at a text element is refused mismatch", async () => {
    expect(await setup().h({ ...pw, elementKind: "text" })).toEqual({ ok: true, data: { refused: "mismatch" } });
  });

  test("mismatches never use up an attempt", async () => {
    const s = setup();
    for (let i = 0; i < 6; i++) await s.h({ ...pw, frameOrigin: "https://evil.test" });
    expect(await s.h(pw)).toMatchObject({ ok: true, data: { kind: "password" } });
  });

  test("a second password fill inside five minutes is limited, even from another client; an email fill never counts", async () => {
    const s = setup();
    await s.h(em);
    await s.h(em);
    expect((await s.h(pw)).ok).toBe(true);
    expect(await s.h({ ...pw, client: "other", pid: 43 })).toEqual({ ok: true, data: { refused: "limited", until: s.clock.t + ATTEMPT_WINDOW_MS } });
    expect(await s.h(em)).toMatchObject({ ok: true, data: { kind: "email" } });
  });

  test("replacing the login lifts the limit", async () => {
    const s = setup();
    await s.h(pw);
    s.state.login = { origin: ORIGIN, email: EMAIL, password: "new-password" };
    expect(await s.h(pw)).toMatchObject({ ok: true, data: { value: "new-password" } });
  });

  test("logs name the caller as unverified and never carry a value", async () => {
    const s = setup();
    await s.h(em);
    await s.h(pw);
    await s.h(pw);
    await s.h({ ...pw, frameOrigin: "https://evil.test" });
    const text = JSON.stringify(s.logged);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(EMAIL);
    expect(text).toContain('"verified":false');
    expect(text).toContain("fast-browser");
  });
});
