import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCiLeaseByBranch } from "../../../packages/rt-client/src/index.ts";
import { readWatchState, watchStatePath, writeWatchState, type PersistedWatch } from "../watch-state.ts";

const MR = "https://gitlab.example.com/group/proj/-/merge_requests/42";
const SHA = "abcdef1234567890";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "watch-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function sample(over: Partial<PersistedWatch> = {}): PersistedWatch {
  return {
    version: 1, mr: MR, sha: SHA, pipelineId: 7, pipelineStatus: "running", lastResult: "failed",
    budgetMinutes: 30, priorPipelineId: 3, waitingSince: 1000, held: true, heldBy: "session:aaa", reclaims: 2, updatedAt: 0, ...over,
  };
}

describe("watch state", () => {
  test("round trips and stamps updatedAt", () => {
    writeWatchState(sample(), { dir, now: () => 5000 });
    expect(readWatchState(MR, SHA, { dir })).toEqual(sample({ updatedAt: 5000 }));
  });

  test("missing file gives a fresh state", () => {
    const s = readWatchState(MR, SHA, { dir, now: () => 9 });
    expect(s).toMatchObject({ version: 1, mr: MR, sha: SHA, pipelineId: null, held: false, reclaims: 0, priorPipelineId: null, updatedAt: 9 });
  });

  test("corrupt JSON gives a fresh state", () => {
    mkdirSync(join(dir, "watch"), { recursive: true });
    writeFileSync(watchStatePath(MR, { dir }), "{not json");
    const s = readWatchState(MR, SHA, { dir });
    expect(s.held).toBe(false);
    expect(s.priorPipelineId).toBeNull();
  });

  test("another commit carries the pipeline forward and resets the budget fields", () => {
    writeWatchState(sample(), { dir });
    const s = readWatchState(MR, "fffffff", { dir });
    expect(s).toMatchObject({ sha: "fffffff", priorPipelineId: 7, reclaims: 0, budgetMinutes: null, waitingSince: null, pipelineId: null });
  });

  test("sha matches as a case-insensitive prefix either way", () => {
    writeWatchState(sample(), { dir });
    expect(readWatchState(MR, "ABCDEF1", { dir }).reclaims).toBe(2);
    expect(readWatchState(MR, `${SHA}ffff`, { dir }).reclaims).toBe(2);
  });

  test("a file written before heldBy existed reads it as null", () => {
    const { heldBy: _, ...old } = sample();
    mkdirSync(join(dir, "watch"), { recursive: true });
    writeFileSync(watchStatePath(MR, { dir }), JSON.stringify(old));
    expect(readWatchState(MR, SHA, { dir })).toMatchObject({ version: 1, held: true, heldBy: null, reclaims: 2 });
  });

  test("GitHub commit facts read back with the state", () => {
    const github = { required: ["checks"], requiredFor: "main", requiredTries: 1, anchor: { runId: 900, createdAt: 1234 }, anchorTries: 1, confirm: null };
    writeWatchState(sample({ github }), { dir, now: () => 5000 });
    expect(readWatchState(MR, SHA, { dir }).github).toEqual(github);
  });

  test.each([
    ["missing", undefined],
    ["a number", 7],
    ["null", null],
  ])("a stored requiredFor that is %s reads back as null", (_label, requiredFor) => {
    mkdirSync(join(dir, "watch"), { recursive: true });
    const github = { required: ["checks"], requiredFor, requiredTries: 1, anchor: null, anchorTries: 0, confirm: null };
    writeFileSync(watchStatePath(MR, { dir }), JSON.stringify({ ...sample(), github }));
    expect(readWatchState(MR, SHA, { dir }).github).toEqual({ ...github, requiredFor: null });
  });

  test("a new sha reads back without GitHub commit facts", () => {
    writeWatchState(sample({ github: { required: [], requiredFor: "main", requiredTries: 1, anchor: null, anchorTries: 0, confirm: null } }), { dir });
    expect(readWatchState(MR, "fffffff", { dir }).github).toBeUndefined();
  });

  test("a fresh state has no GitHub commit facts", () => {
    expect(readWatchState(MR, SHA, { dir })).not.toHaveProperty("github");
  });

  test("a github field that is not an object is dropped", () => {
    mkdirSync(join(dir, "watch"), { recursive: true });
    writeFileSync(watchStatePath(MR, { dir }), JSON.stringify({ ...sample(), github: "nope" }));
    expect(readWatchState(MR, SHA, { dir })).not.toHaveProperty("github");
  });

  test.each([
    ["a string createdAt", { runId: 900, createdAt: "2026-11-11T10:00:00Z" }],
    ["a null createdAt", { runId: 900, createdAt: null }],
    ["a non-object anchor", 7],
  ])("a stored anchor with %s is dropped and the rest of the facts kept", (_label, anchor) => {
    mkdirSync(join(dir, "watch"), { recursive: true });
    const github = { required: ["checks"], requiredFor: "main", requiredTries: 1, anchor, anchorTries: 1, confirm: null };
    writeFileSync(watchStatePath(MR, { dir }), JSON.stringify({ ...sample(), github }));
    expect(readWatchState(MR, SHA, { dir }).github).toEqual({ ...github, anchor: null });
  });

  test("leaves no temp files", () => {
    writeWatchState(sample(), { dir });
    expect(readdirSync(join(dir, "watch")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("the lease directory scan ignores the watch subdirectory", () => {
    writeWatchState(sample(), { dir });
    expect(readCiLeaseByBranch("feature", { dir })).toBeNull();
  });
});
