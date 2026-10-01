import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { decideUpdate, summarizeUpdate, updateNotification, SETUP_UPDATE_CATEGORY } from "../update.ts";

const DAEMON = "/fake-home/.mattstack/rt/daemon.json";
const STATE = "/fake-home/.mattstack/rt/setup-state.json";
const INTENT = "/fake-home/.mattstack/rt/setup-intent.json";

describe("decideUpdate", () => {
  test("a Mac with no daemon.json was never set up", () => {
    expect(decideUpdate(fakeProbes(), "2.15.0", false)).toEqual({ kind: "not-set-up" });
  });

  test("daemon.json present and no setup-state.json at all runs", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}" } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "run" });
  });

  test("a stamp for the running version skips as current", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.15.0", at: "x" } }) } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "current", version: "2.15.0" });
  });

  test("a stamp for another version runs", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.14.0", at: "x" } }) } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "run" });
  });

  test("--force runs over a current stamp", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.15.0", at: "x" } }) } });
    expect(decideUpdate(p, "2.15.0", true)).toEqual({ kind: "run" });
  });

  test("a dev build always runs, even over a dev stamp", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "dev", at: "x" } }) } });
    expect(decideUpdate(p, "dev", false)).toEqual({ kind: "run" });
  });

  test("never set up wins over --force", () => {
    expect(decideUpdate(fakeProbes(), "2.15.0", true)).toEqual({ kind: "not-set-up" });
  });

  test("a Mac mid-setup, with the daemon installed and a team choice still pending, is not set up", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [INTENT]: "{}" } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "not-set-up" });
    expect(decideUpdate(p, "2.15.0", true)).toEqual({ kind: "not-set-up" });
  });

  test("a current-format state file with no Finish on record is not set up, daemon or not", () => {
    const p = fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 2, lastApplyAt: "x" }) } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "not-set-up" });
  });

  test("a Finish on record runs even when daemon.json is gone", () => {
    const p = fakeProbes({ files: { [STATE]: JSON.stringify({ v: 2, finishedAt: "2026-09-30T00:00:00.000Z" }) } });
    expect(decideUpdate(p, "2.15.0", false)).toEqual({ kind: "run" });
  });
});

describe("summarizeUpdate", () => {
  test("groups outcomes and omits empty groups", () => {
    expect(summarizeUpdate([
      { id: "path.link", state: "done" },
      { id: "skills.link", state: "partial", detail: "1 of 2" },
      { id: "claude.permissions", state: "skipped" },
      { id: "verify", state: "needs-you", detail: "to connect: Slack" },
    ])).toBe("ran: path.link, skills.link · skipped: claude.permissions · needs you: verify");
    expect(summarizeUpdate([{ id: "migration.a", state: "failed", detail: "boom" }])).toBe("failed: migration.a");
    expect(summarizeUpdate([])).toBe("nothing to do");
  });
});

describe("updateNotification", () => {
  test("null when nothing needs a person", () => {
    expect(updateNotification("2.15.0", [{ id: "path.link", state: "done" }, { id: "verify", state: "done" }])).toBeNull();
  });

  test("names the version and every needs-you or failed item with its detail, under one id per version", () => {
    const n = updateNotification("2.15.0", [
      { id: "path.link", state: "done" },
      { id: "claude.permissions", state: "failed", detail: "settings.json is not valid JSON" },
      { id: "verify", state: "needs-you", detail: "to connect: Slack" },
    ]);
    expect(n).toEqual({
      id: "setup_update:2.15.0",
      title: "Setup needs you after the update to 2.15.0",
      message: "claude.permissions: settings.json is not valid JSON · verify: to connect: Slack",
    });
    expect(SETUP_UPDATE_CATEGORY).toBe("setup_update");
  });

  test("an item with no detail is named alone", () => {
    expect(updateNotification("dev", [{ id: "verify", state: "needs-you" }])?.message).toBe("verify");
  });
});
