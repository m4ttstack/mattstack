import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { updateRepoIndex } from "../../repo-index.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import type { ApplyContext } from "../apply.ts";
import type { PackRequirements } from "../requirements.ts";
import { fakeProbes } from "./fakes.ts";
import { materializeWorld } from "./materialize-world.ts";
import type { Probes } from "../probes.ts";

import { NO_MANIFEST_DETAIL, setupPackFlow } from "../pack.ts";

const fakeSecrets: SecretsSeams = {
  ageKeySeam: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false,
    statFile: () => null,
    readFile: () => "",
    writeFile: () => {},
    ensureDir: () => {},
    chmod: () => {},
    fsyncAndRename: () => {},
    removeFile: () => {},
  },
};

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    p,
    emit: () => {},
    log: () => {},
    intent: null,
    team: { slug: "", name: "", mode: "none" },
    snapshot: null,
    reqs: [],
    // installPlugins must never hard-fail this flow just because `claude`
    // isn't resolvable in the fake environment.
    nonInteractive: true,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets: fakeSecrets,
    teamSecrets: () => fakeSecrets,
    relay: fakeRelay,
    secretPresence: { has: async () => null },
    redact: () => {},
    async need() {
      return "no-app";
    },
    ...overrides,
  };
}

const fragment = (bindings: object, pipelines: object = { feature: ["stage-plan", "stage-gates"] }) =>
  JSON.stringify({ pipelines, bindings });

function registerRepo(home: string): string {
  const repoDir = mkdtempSync(join(home, "repo-"));
  const repoName = basename(repoDir);
  updateRepoIndex(repoName, repoDir);
  return repoName;
}

describe("setupPackFlow", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-pack-home-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const widgets = (workType?: string): PackRequirements[] => [{ pack: "widgets", tools: [], integrations: [], workType }];

  test("every stage's slots bound -> ok", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home, { fragment: fragment({ "mattstack:stage-gates": { domain: "widgets:gates" } }) }) });
    expect(await setupPackFlow(makeCtx(p, { reqs: widgets("feature") }))).toEqual({ ok: true, detail: `2 stages resolved for feature work` });
  });

  test("a stage with an empty slot value -> stage-unresolved", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home, { fragment: fragment({ "mattstack:stage-gates": { domain: "" } }) }) });
    expect(await setupPackFlow(makeCtx(p, { reqs: widgets("feature") }))).toEqual({
      ok: false,
      stage: "stage-gates",
      detail: `The stage-gates stage has no skill bound to it`,
    });
  });

  test("no pack file for the requirements' pack -> NO_MANIFEST_DETAIL", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home) });
    const reqs: PackRequirements[] = [{ pack: "gadgets", tools: [], integrations: [], workType: "feature" }];
    expect(await setupPackFlow(makeCtx(p, { reqs }))).toEqual({ ok: false, detail: NO_MANIFEST_DETAIL });
    expect(NO_MANIFEST_DETAIL).toBe("This pack has no bindings file yet. Run rt skills materialize");
  });

  test("the pack's own failed materialize outcome is the detail, not a missing-file note", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home, { siblingFragment: JSON.stringify({ extends: "acme-base@acme" }) }) });
    const reqs: PackRequirements[] = [{ pack: "gadgets", tools: [], integrations: [], workType: "feature" }];
    expect(await setupPackFlow(makeCtx(p, { reqs }))).toEqual({
      ok: false,
      detail: "gadgets extends acme-base@acme, which is not installed; add it to the team's claude.plugins",
    });
  });

  test("a sibling pack's failure leaves this pack's check alone", async () => {
    registerRepo(home);
    const p = fakeProbes({
      home,
      ...materializeWorld(home, { fragment: fragment({}, { feature: ["stage-plan"] }), siblingFragment: JSON.stringify({ extends: "acme-base@acme" }) }),
    });
    expect(await setupPackFlow(makeCtx(p, { reqs: widgets() }))).toEqual({ ok: true, detail: `1 stage resolved for feature work` });
  });

  test("no registered repo, plugins installed -> not a failure, the check waits on a repo clone", async () => {
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files: { "/usr/local/bin/claude": "bin" },
      exec: async (argv) => ({ code: 0, stdout: argv.includes("list") ? "[]" : "", stderr: "" }),
    });

    const result = await setupPackFlow(makeCtx(p));
    expect(result).toEqual({ ok: true, detail: "plugins installed; the pipeline check waits for a repo clone" });
  });

  test("no registered repo, plugin install skipped -> passes the step's own detail through, never claims plugins installed", async () => {
    const p = fakeProbes({ home, env: {} });

    const result = await setupPackFlow(makeCtx(p));
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("Claude Code is not installed (not in this build, and no copy on your PATH); the pipeline check waits for a repo clone");
  });

  test("the first repo has no git remote -> says so, never that no team pack declares it", async () => {
    const repoName = registerRepo(home);
    const p = fakeProbes({
      home,
      ...materializeWorld(home),
      exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    });

    const result = await setupPackFlow(makeCtx(p, { reqs: widgets() }));
    expect(result).toEqual({ ok: true, detail: `${repoName} has no git remote, so there is no pipeline to check` });
  });

  test("the first repo no team pack declares -> not a failure, nothing to check", async () => {
    const repoName = registerRepo(home);
    const p = fakeProbes({
      home,
      ...materializeWorld(home),
      exec: async (argv) =>
        argv[0] === "git" && argv.includes("get-url")
          ? { code: 0, stdout: "https://gitlab.example.com/acme/other.git\n", stderr: "" }
          : { code: 0, stdout: "", stderr: "" },
    });

    const result = await setupPackFlow(makeCtx(p, { reqs: widgets() }));
    expect(result).toEqual({ ok: true, detail: `No team pack covers ${repoName}, so there is no pipeline to check` });
  });

  test("defaults workType to feature when the pack declares none", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home, { fragment: fragment({}, { feature: ["stage-plan"] }) }) });
    expect(await setupPackFlow(makeCtx(p, { reqs: widgets() }))).toEqual({ ok: true, detail: `1 stage resolved for feature work` });
  });

  test("no pipeline declared for the work type -> vacuously ok, nothing to resolve", async () => {
    registerRepo(home);
    const p = fakeProbes({ home, ...materializeWorld(home, { fragment: fragment({}) }) });
    expect(await setupPackFlow(makeCtx(p, { reqs: widgets("chore") }))).toEqual({ ok: true, detail: `0 stages resolved for chore work` });
  });

  test("a malformed pack requirements file surfaces its own error, never a misleading stage failure", async () => {
    const p = fakeProbes({ home });
    const reqs: PackRequirements[] = [{ pack: "widgets", tools: [], integrations: [], error: "invalid JSON: Unexpected token" }];
    expect(await setupPackFlow(makeCtx(p, { reqs }))).toEqual({ ok: false, detail: "invalid JSON: Unexpected token" });
  });
});
