/**
 * Runs in every unit suite as a standing assertion that the bun test preload
 * (test-setup.ts) scrubbed live-estate daemon pointers, and doubles as the
 * child probe for test-home-isolation.test.ts, which re-runs this file with
 * an ambient RT_DAEMON_SOCK to prove the scrub — not a clean shell — is what
 * makes the env safe.
 */
import { expect, test } from "bun:test";

test("live daemon socket pointers are scrubbed from the test process env", () => {
  expect(process.env.RT_DAEMON_SOCK).toBeUndefined();
  expect(process.env.RT_APP_SOCKET).toBeUndefined();
});

test("the forbidden-socket list is armed for the rtCommand guard", () => {
  const raw = process.env.RT_TEST_FORBID_SOCKS;
  expect(raw).toBeDefined();
  const forbidden = JSON.parse(raw!) as string[];
  expect(forbidden.length).toBeGreaterThan(0);
  expect(forbidden.some((p) => p.endsWith("/.mattstack/rt/rt.sock"))).toBe(true);
  // Set only by the parent test that spawns this file with a fake live sock.
  if (process.env.PROBE_EXPECT_FORBIDDEN) {
    expect(forbidden).toContain(process.env.PROBE_EXPECT_FORBIDDEN);
  }
});

test("herd and herdr pane variables are scrubbed from the test process env", () => {
  const leaked = Object.keys(process.env).filter((k) => k.startsWith("HERD_") || k.startsWith("HERDR_"));
  expect(leaked).toEqual([]);
});

test("config and runs pointers that override the scratch HOME are scrubbed", () => {
  for (const key of ["XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GH_CONFIG_DIR", "RT_RUNS_ROOT", "RT_RUN_DB"]) {
    expect(process.env[key], key).toBeUndefined();
  }
});
