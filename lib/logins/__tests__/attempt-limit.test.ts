import { describe, expect, test } from "bun:test";
import { ATTEMPT_DAY_MS, ATTEMPT_WINDOW_MS, AttemptLimiter, loginFingerprint } from "../attempt-limit.ts";

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe("AttemptLimiter", () => {
  test("one grant per login per five minutes", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    expect(l.take("a", "f")).toEqual({ ok: true });
    expect(l.take("a", "f")).toEqual({ ok: false, until: c.t + ATTEMPT_WINDOW_MS });
    c.t += ATTEMPT_WINDOW_MS;
    expect(l.take("a", "f")).toEqual({ ok: true });
  });

  test("five per day, the sixth refused until the first ages out", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    const first = c.t;
    for (let i = 0; i < 5; i++) {
      expect(l.take("a", "f").ok).toBe(true);
      c.t += ATTEMPT_WINDOW_MS;
    }
    expect(l.take("a", "f")).toEqual({ ok: false, until: first + ATTEMPT_DAY_MS });
    c.t = first + ATTEMPT_DAY_MS;
    expect(l.take("a", "f").ok).toBe(true);
  });

  test("when both limits apply, until is when the later one lifts", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    const first = c.t;
    for (let i = 0; i < 5; i++) {
      if (i > 0) c.t += ATTEMPT_WINDOW_MS;
      expect(l.take("a", "f").ok).toBe(true);
    }
    c.t += 60_000;
    expect(l.take("a", "f")).toEqual({ ok: false, until: first + ATTEMPT_DAY_MS });
  });

  test("a refused take does not move until", () => {
    const c = clock();
    const l = new AttemptLimiter(c.now);
    expect(l.take("a", "f").ok).toBe(true);
    c.t += 1_000;
    const refused = l.take("a", "f");
    c.t += 1_000;
    expect(l.take("a", "f")).toEqual(refused);
    expect(refused).toEqual({ ok: false, until: c.t - 2_000 + ATTEMPT_WINDOW_MS });
  });

  test("a replaced login (new fingerprint) starts fresh", () => {
    const l = new AttemptLimiter(clock().now);
    l.take("a", "old");
    expect(l.take("a", "new")).toEqual({ ok: true });
  });

  test("logins are counted separately", () => {
    const l = new AttemptLimiter(clock().now);
    l.take("a", "f");
    expect(l.take("b", "f")).toEqual({ ok: true });
  });

  test("the fingerprint changes with email or password and never contains either", () => {
    const f = loginFingerprint({ email: "a@example.com", password: "Canary" });
    expect(f).not.toBe(loginFingerprint({ email: "a@example.com", password: "Canary2" }));
    expect(f).not.toBe(loginFingerprint({ email: "b@example.com", password: "Canary" }));
    expect(f).not.toContain("Canary");
  });
});
