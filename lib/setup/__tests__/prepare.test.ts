import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { PREPARE_BUDGET_MS, preparePath, readPrepare, recordToolInstall, runPrepare, type PrepareRecord } from "../prepare.ts";
import type { PackRequirements } from "../requirements.ts";
import type { InstallResult, installTool } from "../tools-install.ts";
import { fakeProbes, missing, ok, type ExecScript } from "./fakes.ts";

const HOME = "/fake-home";
const OWN_PID = 4242;

/** Pinned for both processors, so the route does not depend on the machine running the test. */
function pinned(name: string) {
  const pin = { url: `https://example.com/${name}`, sha256: "a".repeat(64), extract: "" };
  return { download: { arm64: pin, x86_64: pin } };
}

const reqs: PackRequirements[] = [
  {
    pack: "widgets",
    integrations: [],
    tools: [
      { name: "jq", why: "json", install: pinned("jq") },
      { name: "acme-api", why: "the api", install: { url: "https://acme.example/install" } },
      { name: "doppler", why: "secrets", install: pinned("doppler"), connect: { integration: "doppler" } },
      { name: "yq", why: "yaml", install: pinned("yq"), optional: true },
      { name: "gh", why: "prs", install: pinned("gh") },
    ],
  },
];

/** Claude Code, herdr and every pack tool missing except gh; Command Line Tools present unless `cltMissing`. */
function machine(opts: { cltMissing?: boolean; onSleep?: () => void } = {}): ExecScript {
  return (argv) => {
    if (argv[0] === "xcode-select") return opts.cltMissing ? { code: 2, stdout: "", stderr: "unable to get active developer directory" } : ok("/Library/Developer/CommandLineTools");
    if (argv[0] === "sleep") {
      opts.onSleep?.();
      return ok();
    }
    if (argv[1] === "--version") return argv[0] === "gh" ? ok("gh 2.80.0") : missing(argv[0]!);
    return ok();
  };
}

function fakeInstall(seen: string[], results: Record<string, InstallResult | Error> = {}): typeof installTool {
  return async (_p, tool) => {
    seen.push(tool);
    const r = results[tool];
    if (r instanceof Error) throw r;
    return r ?? { via: "download", ok: true, detail: `installed ${tool}` };
  };
}

function seedRecord(record: PrepareRecord): Record<string, string> {
  return { [preparePath(HOME, record.stage)]: JSON.stringify(record) };
}

const alive = (pid: number) => pid === OWN_PID || pid === 999;

describe("runPrepare", () => {
  test("macos installs Command Line Tools only when xcode-select fails", async () => {
    const seen: string[] = [];
    const missingClt = fakeProbes({ home: HOME, exec: machine({ cltMissing: true }) });
    const result = await runPrepare(missingClt, "macos", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(seen).toEqual(["apple-clt"]);
    expect(result).toEqual({ stage: "macos", installed: ["apple-clt"], failed: [] });

    const present = fakeProbes({ home: HOME, exec: machine() });
    const again: string[] = [];
    expect(await runPrepare(present, "macos", { reqs, install: fakeInstall(again), alive, pid: OWN_PID })).toEqual({ stage: "macos", installed: [], failed: [] });
    expect(again).toEqual([]);
  });

  test("macos also updates Command Line Tools whose git is older than the floor", async () => {
    const base = machine();
    const oldGit = fakeProbes({ home: HOME, exec: (argv, o) => (argv[0] === "git" && argv[1] === "--version" ? { code: 0, stdout: "git version 2.24.3 (Apple Git-128)\n", stderr: "" } : base(argv, o)) });
    const seen: string[] = [];
    expect(await runPrepare(oldGit, "macos", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID })).toEqual({ stage: "macos", installed: ["apple-clt"], failed: [] });
    expect(seen).toEqual(["apple-clt"]);
  });

  test("accounts installs Claude Code, herdr, then the team tools rt can install", async () => {
    const seen: string[] = [];
    const p = fakeProbes({ home: HOME, exec: machine() });
    const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(seen).toEqual(["claude", "herdr", "doppler", "jq"]);
    expect(result.installed).toEqual(["claude", "herdr", "doppler", "jq"]);
  });

  test("accounts installs Claude Code whenever ~/.local/bin/claude is missing, even with a claude elsewhere on PATH", async () => {
    const elsewhere: ExecScript = (argv) => (argv[0] === "claude" && argv[1] === "--version" ? ok("2.1.0") : machine()(argv));
    const seen: string[] = [];
    await runPrepare(fakeProbes({ home: HOME, exec: elsewhere }), "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(seen[0]).toBe("claude");

    const placed: string[] = [];
    const atVendorPath = fakeProbes({ home: HOME, exec: elsewhere, files: { [`${HOME}/.local/bin/claude`]: "bin" } });
    await runPrepare(atVendorPath, "accounts", { reqs, install: fakeInstall(placed), alive, pid: OWN_PID });
    expect(placed).not.toContain("claude");
  });

  test("a team tool rt cannot install is left for its row", async () => {
    const seen: string[] = [];
    const p = fakeProbes({ home: HOME, exec: machine() });
    await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(seen).not.toContain("acme-api");
    expect(readPrepare(p, "accounts", alive)!.items).not.toContain("acme-api");
  });

  test("a second run of the same stage while one is alive skips, naming it running", async () => {
    const running: PrepareRecord = { stage: "accounts", startedAt: "2026-01-01T00:00:00.000Z", pid: 999, items: ["claude"], failed: [] };
    const p = fakeProbes({ home: HOME, exec: machine(), files: seedRecord(running) });
    const seen: string[] = [];
    const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(result).toEqual({ stage: "accounts", skipped: "running", installed: [], failed: [] });
    expect(seen).toEqual([]);
    expect(JSON.parse(p.readFile(preparePath(HOME, "accounts"))!)).toEqual(running);
  });

  test("accounts runs while macos is still installing, and waits for it before its first install", async () => {
    const macos: PrepareRecord = { stage: "macos", startedAt: "2026-01-01T00:00:00.000Z", pid: 999, items: ["apple-clt"], failed: [] };
    const events: string[] = [];
    let sleeps = 0;
    const p = fakeProbes({
      home: HOME,
      files: seedRecord(macos),
      exec: machine({
        onSleep: () => {
          sleeps++;
          events.push("sleep");
          expect(readPrepare(p, "accounts", alive, () => p.now())).toMatchObject({ running: true, items: ["claude", "herdr", "doppler", "jq"] });
          if (sleeps === 2) {
            const { pid: _pid, ...rest } = macos;
            p.writeFile(preparePath(HOME, "macos"), JSON.stringify({ ...rest, endedAt: "2026-01-01T00:10:00.000Z" }));
          }
        },
      }),
    });
    const sleepCalls = () => p.calls.exec.filter((argv) => argv[0] === "sleep");
    const install: typeof installTool = async (_p, tool) => {
      events.push(`install:${tool}`);
      return { via: "download", ok: true, detail: "ok" };
    };
    const result = await runPrepare(p, "accounts", { reqs, install, alive, pid: OWN_PID });
    expect(sleepCalls()).toEqual([
      ["sleep", "5"],
      ["sleep", "5"],
    ]);
    expect(events).toEqual(["sleep", "sleep", "install:claude", "install:herdr", "install:doppler", "install:jq"]);
    expect(result.installed).toHaveLength(4);
  });

  test("the two stages keep separate records", async () => {
    const p = fakeProbes({ home: HOME, exec: machine({ cltMissing: true }) });
    await runPrepare(p, "macos", { reqs, install: fakeInstall([]), alive, pid: OWN_PID });
    await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), alive, pid: OWN_PID });
    expect(preparePath(HOME, "macos")).toBe("/fake-home/.mattstack/rt/setup-prepare-macos.json");
    expect(preparePath(HOME, "accounts")).toBe("/fake-home/.mattstack/rt/setup-prepare-accounts.json");
    expect(readPrepare(p, "macos", alive)!.items).toEqual(["apple-clt"]);
    expect(readPrepare(p, "accounts", alive)!.items).toEqual(["claude", "herdr", "doppler", "jq"]);
  });

  test("a record whose pid died is not running", async () => {
    const orphan: PrepareRecord = { stage: "accounts", startedAt: "2026-01-01T00:00:00.000Z", pid: 77, items: ["claude"], failed: [] };
    const p = fakeProbes({ home: HOME, exec: machine(), files: seedRecord(orphan) });
    expect(readPrepare(p, "accounts", alive)).toEqual({ ...orphan, running: false });
    const seen: string[] = [];
    const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(result.skipped).toBeUndefined();
    expect(seen).toContain("claude");
  });

  test("a record older than its stage's budget is not running, even when its pid is alive", async () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const reused: PrepareRecord = { stage: "accounts", startedAt, pid: 999, items: ["claude"], failed: [] };
    const at = (ms: number) => () => new Date(Date.parse(startedAt) + ms);
    const files = seedRecord(reused);
    const fresh = fakeProbes({ home: HOME, exec: machine(), files });
    expect(readPrepare(fresh, "accounts", alive, at(PREPARE_BUDGET_MS.accounts))!.running).toBe(true);
    expect(readPrepare(fresh, "accounts", alive, at(PREPARE_BUDGET_MS.accounts + 1))!.running).toBe(false);
    expect(readPrepare(fresh, "accounts", alive, at(PREPARE_BUDGET_MS.macos + 1))!.running).toBe(true);

    const later = new Date(Date.parse(startedAt) + PREPARE_BUDGET_MS.accounts + 60_000);
    const p = fakeProbes({ home: HOME, exec: machine(), files, now: later });
    const seen: string[] = [];
    const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(result.skipped).toBeUndefined();
    expect(seen).toContain("claude");

    const macos: PrepareRecord = { stage: "macos", startedAt, pid: 999, items: ["apple-clt"], failed: [] };
    expect(readPrepare(fakeProbes({ home: HOME, files: seedRecord(macos) }), "macos", alive, at(PREPARE_BUDGET_MS.macos + 1))!.running).toBe(false);
  });

  test("a failed install is recorded with its detail and the rest still run", async () => {
    const p = fakeProbes({ home: HOME, exec: machine() });
    const seen: string[] = [];
    const install = fakeInstall(seen, {
      claude: { via: "vendor", ok: false, detail: "install script failed (exit 1): no network" },
      doppler: new UserActionableError("no-installer", "no install method known for doppler"),
    });
    const result = await runPrepare(p, "accounts", { reqs, install, alive, pid: OWN_PID });
    expect(seen).toEqual(["claude", "herdr", "doppler", "jq"]);
    const failed = [
      { tool: "claude", detail: "install script failed (exit 1): no network" },
      { tool: "doppler", detail: "no install method known for doppler" },
    ];
    expect(result).toEqual({ stage: "accounts", installed: ["herdr", "jq"], failed });
    expect(readPrepare(p, "accounts", alive)!.failed).toEqual(failed);
  });

  describe("Fast Browser", () => {
    const withFastBrowser = (exec: ExecScript = machine()) =>
      fakeProbes({ home: HOME, env: { PATH: "/usr/local/bin" }, files: { "/usr/local/bin/fast-browser": "bin" }, exec });

    test("accounts sets up Fast Browser once, after the tools it integrates into", async () => {
      const p = withFastBrowser();
      const seen: string[] = [];
      const setUps: ReturnType<typeof readPrepare>[] = [];
      const setUpFastBrowser = async () => {
        seen.push("fast-browser");
        setUps.push(readPrepare(p, "accounts", alive, () => p.now()));
        return { state: "done" as const, detail: "Fast Browser is set up" };
      };
      const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), setUpFastBrowser, alive, pid: OWN_PID });
      expect(seen).toEqual(["claude", "herdr", "doppler", "jq", "fast-browser"]);
      expect(setUps).toHaveLength(1);
      expect(setUps[0]).toMatchObject({ running: true, items: ["claude", "herdr", "doppler", "jq", "fast-browser"] });
      expect(result.installed).toEqual(["claude", "herdr", "doppler", "jq", "fast-browser"]);
    });

    test("a Fast Browser setup that does not finish is recorded with its reason", async () => {
      const p = withFastBrowser();
      const setUpFastBrowser = async () => ({ state: "skipped" as const, detail: "No Claude Code or Codex found, so there is nothing to integrate with" });
      const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), setUpFastBrowser, alive, pid: OWN_PID });
      const failed = [{ tool: "fast-browser", detail: "No Claude Code or Codex found, so there is nothing to integrate with" }];
      expect(result.failed).toEqual(failed);
      expect(readPrepare(p, "accounts", alive)).toMatchObject({ running: false, failed });
    });

    test("a build without Fast Browser has nothing to set up", async () => {
      let called = false;
      const p = fakeProbes({ home: HOME, exec: machine() });
      await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), setUpFastBrowser: async () => ((called = true), { state: "done" }), alive, pid: OWN_PID });
      expect(called).toBe(false);
      expect(readPrepare(p, "accounts", alive)!.items).not.toContain("fast-browser");
    });

    test("by default it runs Install's own Fast Browser setup, unattended", async () => {
      const p = withFastBrowser((argv) => (argv[0] === "/usr/local/bin/fast-browser" ? { code: 2, stdout: "", stderr: "fast-browser: Detected hosts: none." } : machine()(argv)));
      const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), alive, pid: OWN_PID });
      expect(p.calls.exec.filter((argv) => argv[0] === "/usr/local/bin/fast-browser")).toEqual([["/usr/local/bin/fast-browser", "setup", "--host", "claude", "--source", "https://github.com/m4ttstack/mattstack-marketplace.git"]]);
      expect(result.failed).toEqual([{ tool: "fast-browser", detail: "No Claude Code or Codex found, so there is nothing to integrate with" }]);
    });

    test("any other failed Fast Browser setup reaches the record with rt's detail", async () => {
      const p = withFastBrowser((argv) => (argv[0] === "/usr/local/bin/fast-browser" ? { code: 1, stdout: "", stderr: "fast-browser: runtime checksum mismatch" } : machine()(argv)));
      const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), alive, pid: OWN_PID });
      const failed = [{ tool: "fast-browser", detail: "Fast Browser's setup failed (exit 1): fast-browser: runtime checksum mismatch" }];
      expect(result.failed).toEqual(failed);
      expect(readPrepare(p, "accounts", alive)!.failed).toEqual(failed);
    });
  });

  test("the record carries the items while it runs and loses its pid when it ends", async () => {
    const p = fakeProbes({ home: HOME, exec: machine(), now: new Date("2026-01-01T00:05:00.000Z") });
    const during: ReturnType<typeof readPrepare>[] = [];
    const install: typeof installTool = async () => {
      during.push(readPrepare(p, "accounts", alive, () => p.now()));
      return { via: "download", ok: true, detail: "ok" };
    };
    await runPrepare(p, "accounts", { reqs, install, alive, pid: OWN_PID });
    expect(during[0]).toEqual({ stage: "accounts", startedAt: "2026-01-01T00:05:00.000Z", pid: OWN_PID, items: ["claude", "herdr", "doppler", "jq"], failed: [], running: true });
    const after = readPrepare(p, "accounts", alive)!;
    expect(after.pid).toBeUndefined();
    expect(after.endedAt).toBe("2026-01-01T00:05:00.000Z");
    expect(after.running).toBe(false);
    expect(p.calls.renames.every(([, to]) => to === preparePath(HOME, "accounts"))).toBe(true);
  });
});

describe("recordToolInstall", () => {
  const ended: PrepareRecord = { stage: "accounts", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:05:00.000Z", items: ["jq"], failed: [{ tool: "jq", detail: "background failure" }], pressFailed: [{ tool: "jq", detail: "old press" }, { tool: "gh", detail: "gh failed" }] };
  const read = (p: ReturnType<typeof fakeProbes>) => readPrepare(p, "accounts", () => false, () => p.now());

  test("a failure replaces that tool's press entry and keeps the others, and leaves failed alone", () => {
    const p = fakeProbes({ home: HOME, files: seedRecord(ended) });
    recordToolInstall(p, "jq", "the download failed", { pid: OWN_PID });
    expect(read(p)?.pressFailed).toEqual([{ tool: "gh", detail: "gh failed" }, { tool: "jq", detail: "the download failed" }]);
    expect(read(p)?.failed).toEqual(ended.failed);
    expect(read(p)?.endedAt).toBe(ended.endedAt);
    expect(read(p)?.startedAt).toBe(ended.startedAt);
  });

  test("a failure adds a press entry to a record from before the field", () => {
    const { pressFailed: _older, ...older } = ended;
    const p = fakeProbes({ home: HOME, files: seedRecord(older) });
    recordToolInstall(p, "yq", "the download failed", { pid: OWN_PID });
    expect(read(p)?.pressFailed).toEqual([{ tool: "yq", detail: "the download failed" }]);
  });

  test("a success removes the press entry and leaves failed alone", () => {
    const p = fakeProbes({ home: HOME, files: seedRecord(ended) });
    recordToolInstall(p, "jq", null, { pid: OWN_PID });
    expect(read(p)?.pressFailed).toEqual([{ tool: "gh", detail: "gh failed" }]);
    expect(read(p)?.failed).toEqual(ended.failed);
  });

  test("with no record, a failure writes one that has already ended", () => {
    const p = fakeProbes({ home: HOME });
    recordToolInstall(p, "jq", "the download failed", { pid: OWN_PID });
    const record = read(p);
    expect(record).toMatchObject({ stage: "accounts", items: [], failed: [], pressFailed: [{ tool: "jq", detail: "the download failed" }], running: false });
    expect(record?.endedAt).toBe(p.now().toISOString());
    expect(record?.pid).toBeUndefined();
  });

  test("with no record, a success writes one with nothing failed", () => {
    const p = fakeProbes({ home: HOME });
    recordToolInstall(p, "jq", null, { pid: OWN_PID });
    expect(read(p)).toMatchObject({ failed: [], pressFailed: [], running: false });
  });

  test("a running record belongs to its run, so it is left alone", () => {
    const running: PrepareRecord = { stage: "accounts", startedAt: "2026-01-01T00:00:00.000Z", pid: 99, items: ["jq"], failed: [] };
    const p = fakeProbes({ home: HOME, files: seedRecord(running) });
    recordToolInstall(p, "jq", "the download failed", { pid: OWN_PID, alive: () => true });
    expect(p.calls.renames).toEqual([]);
    expect(p.readFile(preparePath(HOME, "accounts"))).toBe(JSON.stringify(running));
  });

  test("a run that died without ending reads ended once this writes it, so its pid can never be reused as running", () => {
    const dead: PrepareRecord = { stage: "accounts", startedAt: "2026-01-01T00:00:00.000Z", pid: 99, items: ["jq"], failed: [] };
    const p = fakeProbes({ home: HOME, files: seedRecord(dead) });
    recordToolInstall(p, "jq", "the download failed", { pid: OWN_PID, alive: () => false });
    expect(readPrepare(p, "accounts", () => true, () => p.now())).toMatchObject({ running: false, pressFailed: [{ tool: "jq", detail: "the download failed" }] });
  });

  test("a prepare run carries the press failures through every write and starts its own failed list fresh", async () => {
    const p = fakeProbes({ home: HOME, exec: machine(), files: seedRecord(ended) });
    const midRun: unknown[] = [];
    const install: typeof installTool = async (probes, tool, list) => {
      midRun.push(read(p)?.pressFailed);
      return fakeInstall([])(probes, tool, list);
    };
    await runPrepare(p, "accounts", { reqs, install, setUpFastBrowser: async () => ({ state: "done" }), alive: () => false, pid: OWN_PID });
    expect(midRun.length).toBeGreaterThan(1);
    expect(midRun.every((seen) => Bun.deepEquals(seen, ended.pressFailed))).toBe(true);
    expect(read(p)?.pressFailed).toEqual(ended.pressFailed);
    expect(read(p)?.failed).toEqual([]);
  });

  test("a press that lands while a prepare run probes its tools survives the run's first write", async () => {
    const script = machine();
    let pressed = false;
    const p = fakeProbes({
      home: HOME,
      files: seedRecord(ended),
      exec: (argv, opts) => {
        if (!pressed && argv[1] === "--version") {
          pressed = true;
          recordToolInstall(p, "yq", "the download failed", { pid: OWN_PID, alive: () => false });
        }
        return script(argv, opts);
      },
    });
    await runPrepare(p, "accounts", { reqs, install: fakeInstall([]), setUpFastBrowser: async () => ({ state: "done" }), alive: () => false, pid: OWN_PID });
    expect(read(p)?.pressFailed).toContainEqual({ tool: "yq", detail: "the download failed" });
  });
});
