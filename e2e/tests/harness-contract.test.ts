/**
 * The harness acceptance contract end to end: the runner and verifier as the
 * separate processes S9b runs, against throwaway acceptance environments whose
 * probes are real executables (stubbed harness CLIs, a real Info.plist), plus
 * the committed evidence file's own shape. Nothing here starts rt, a daemon,
 * Claude Code or Codex.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readEvidence, type EvidenceFile } from "../../scripts/acceptance/evidence.ts";
import { verifyHarnessAcceptance } from "../../scripts/acceptance/harnesses.ts";
import { PROFILES, requiredSlots, slotKey, type Profile } from "../../scripts/acceptance/scenarios.ts";
import { fixtureEnv, installStubs, type FixtureEnv } from "../../scripts/acceptance/__tests__/fixture-env.ts";

const REPO = join(import.meta.dir, "..", "..");
const RUNNER = join(REPO, "scripts", "acceptance", "harnesses.ts");
const COMMITTED = join(REPO, "docs", "superpowers", "evidence", "harness-integrations-acceptance.json");

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

async function runner(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const home = temp("rt-harness-contract-home-");
  const proc = Bun.spawn([process.execPath, RUNNER, ...args], {
    cwd: REPO,
    env: { HOME: home, PATH: "/usr/bin:/bin", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: `${stdout}${stderr}` };
}

function stubbedEnv(profile: Profile): FixtureEnv {
  const e = fixtureEnv();
  cleanup.push(e.root);
  installStubs(e, profile);
  e.captureAllPassing(profile);
  return e;
}

function load(path: string): EvidenceFile {
  const doc = readEvidence(path);
  if (!doc.ok) throw new Error(doc.error.message);
  return doc.data;
}

describe("harness acceptance contract", () => {
  test("with no acceptance environment a profile run records every scenario blocked and exits non-zero", async () => {
    const evidence = join(temp("rt-harness-contract-"), "acceptance.json");
    const run = await runner(["--profile", "codex-only", "--evidence", evidence]);
    expect(run.code).toBe(1);
    expect(run.out).toContain(`0 passed, 0 failed, ${requiredSlots("codex-only").length} blocked`);
    const doc = load(evidence);
    expect(doc.profiles["codex-only"]!.scenarios.every((s) => s.outcome === "blocked")).toBe(true);
    const verify = await runner(["--verify", "--evidence", evidence]);
    expect(verify.code).toBe(1);
    expect(verify.out).toContain("claude-only: has not run");
  });

  test("three profiles run at once each land in the shared file, and only the complete matrix verifies", async () => {
    const evidence = join(temp("rt-harness-contract-"), "acceptance.json");
    const envs = Object.fromEntries(PROFILES.map((p) => [p, stubbedEnv(p)])) as Record<Profile, FixtureEnv>;
    const runs = await Promise.all(PROFILES.map((p) => runner(["--profile", p, "--evidence", evidence], { RT_ACCEPTANCE_ENV: envs[p].descriptorPath })));
    for (const r of runs) expect(r.out).toContain("0 failed, 0 blocked");
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0]);

    const doc = load(evidence);
    expect(Object.keys(doc.profiles)).toEqual([...PROFILES]);
    expect(doc.profiles["codex-only"]!.claudeExecutions).toBe(0);
    expect(doc.profiles["codex-only"]!.natives).toEqual({ codex: "0.160.0" });
    expect(existsSync(envs["codex-only"].descriptor.claudeTripwireLog!)).toBe(false);
    expect(existsSync(`${evidence}.lock`)).toBe(false);

    const verify = await runner(["--verify", "--evidence", evidence]);
    expect(verify.out).toContain("complete");
    expect(verify.code).toBe(0);

    // A captured file removed after the run is a failure, not a quiet pass.
    const record = doc.profiles.mixed!.scenarios.find((s) => s.evidence.length > 0)!;
    rmSync(join(evidence, "..", record.evidence[0]!));
    const broken = await runner(["--verify", "--evidence", evidence]);
    expect(broken.code).toBe(1);
    expect(broken.out).toContain("is missing");
  });

  test("a guest's run imports into the shared file with its captured files", async () => {
    const guest = join(temp("rt-harness-contract-guest-"), "acceptance.json");
    const e = stubbedEnv("claude-only");
    expect((await runner(["--profile", "claude-only", "--evidence", guest], { RT_ACCEPTANCE_ENV: e.descriptorPath })).code).toBe(0);
    const shared = join(temp("rt-harness-contract-host-"), "acceptance.json");
    const imported = await runner(["--import", guest, "--profile", "claude-only", "--evidence", shared]);
    expect(imported.code).toBe(0);
    const run = load(shared).profiles["claude-only"]!;
    for (const path of run.scenarios.flatMap((s) => s.evidence)) expect(existsSync(join(shared, "..", path))).toBe(true);
  });

  test("a Codex-only installation that calls Claude fails verification", async () => {
    const evidence = join(temp("rt-harness-contract-"), "acceptance.json");
    const e = stubbedEnv("codex-only");
    mkdirSync(join(e.descriptor.claudeTripwireLog!, ".."), { recursive: true });
    writeFileSync(e.descriptor.claudeTripwireLog!, "2026-10-10T00:00:00Z claude --version\n");
    const run = await runner(["--profile", "codex-only", "--evidence", evidence], { RT_ACCEPTANCE_ENV: e.descriptorPath });
    expect(run.code).toBe(1);
    expect(run.out).toContain("codex-only-no-claude: the Claude tripwire was called 1 time(s)");
  });

  test("usage errors exit 2", async () => {
    expect((await runner(["--profile", "codex-only"])).code).toBe(2);
    expect((await runner(["--verify", "--profile", "mixed", "--evidence", "x.json"])).code).toBe(2);
    expect((await runner(["--profile", "everything", "--evidence", "x.json"])).code).toBe(2);
  });
});

describe("the committed acceptance evidence", () => {
  const doc = load(COMMITTED);

  test("records every required scenario of every profile, once", () => {
    for (const profile of PROFILES) {
      const run = doc.profiles[profile];
      expect(run, profile).toBeDefined();
      const keys = run!.scenarios.map((s) => slotKey(s.scenario, s.harness));
      expect(keys.sort()).toEqual(requiredSlots(profile).map((s) => slotKey(s.scenario.id, s.harness)).sort());
    }
  });

  test("passes verification exactly when every required scenario passed", () => {
    const allPassed = PROFILES.every((p) => doc.profiles[p]!.scenarios.every((s) => s.outcome === "passed"));
    expect(verifyHarnessAcceptance(COMMITTED).ok).toBe(allPassed);
  });

  test("says that capture-only passes are operator-attested", () => {
    expect(doc.attestation).toContain("ruling P18");
  });

  test("a scenario that has not passed says why", () => {
    for (const profile of PROFILES) {
      for (const s of doc.profiles[profile]!.scenarios) {
        if (s.outcome !== "passed") expect(s.reason?.length ?? 0, slotKey(s.scenario, s.harness)).toBeGreaterThan(0);
      }
    }
  });

  test("names no file outside its own evidence folder", () => {
    const text = readFileSync(COMMITTED, "utf8");
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/tmp\//);
  });
});
