import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { preparePath, readPrepare, runPrepare, type PrepareRecord } from "../prepare.ts";
import type { PackRequirements } from "../requirements.ts";
import type { InstallResult, installTool } from "../tools-install.ts";
import { fakeProbes, missing, ok, type ExecScript } from "./fakes.ts";

const HOME = "/fake-home";
const OWN_PID = 4242;

const reqs: PackRequirements[] = [
  {
    pack: "widgets",
    integrations: [],
    tools: [
      { name: "jq", why: "json", install: { brew: "jq" } },
      { name: "acme-api", why: "the api", install: { url: "https://acme.example/install" } },
      { name: "doppler", why: "secrets", install: { brew: "doppler" }, connect: { integration: "doppler" } },
      { name: "yq", why: "yaml", install: { brew: "yq" }, optional: true },
      { name: "gh", why: "prs", install: { brew: "gh" } },
    ],
  },
];

/** Claude Code, herdr and every pack tool missing except gh; brew present; Command Line Tools present unless `cltMissing`. */
function machine(opts: { cltMissing?: boolean; onSleep?: () => void } = {}): ExecScript {
  return (argv) => {
    if (argv[0] === "xcode-select") return opts.cltMissing ? { code: 2, stdout: "", stderr: "unable to get active developer directory" } : ok("/Library/Developer/CommandLineTools");
    if (argv[0] === "brew") return ok("Homebrew 4.6.0");
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
    return r ?? { via: "brew", ok: true, detail: `installed ${tool}` };
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

  test("accounts installs Claude Code, herdr, then the team tools rt can install", async () => {
    const seen: string[] = [];
    const p = fakeProbes({ home: HOME, exec: machine() });
    const result = await runPrepare(p, "accounts", { reqs, install: fakeInstall(seen), alive, pid: OWN_PID });
    expect(seen).toEqual(["claude", "herdr", "doppler", "jq"]);
    expect(result.installed).toEqual(["claude", "herdr", "doppler", "jq"]);
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
          expect(readPrepare(p, "accounts", alive)).toMatchObject({ running: true, items: ["claude", "herdr", "doppler", "jq"] });
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
      return { via: "brew", ok: true, detail: "ok" };
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

  test("the record carries the items while it runs and loses its pid when it ends", async () => {
    const p = fakeProbes({ home: HOME, exec: machine(), now: new Date("2026-01-01T00:05:00.000Z") });
    const during: ReturnType<typeof readPrepare>[] = [];
    const install: typeof installTool = async () => {
      during.push(readPrepare(p, "accounts", alive));
      return { via: "brew", ok: true, detail: "ok" };
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
