import { describe, expect, spyOn, test } from "bun:test";
import { releaseApps } from "../release.ts";
import type { ReleaseAppOptions, ReleaseAppReport, ReleaseAppSeams } from "../../lib/release/release-app.ts";

function seams(): ReleaseAppSeams {
  return {
    repoRoot: "/repo",
    exec: async () => ({ stdout: "", stderr: "no exec in command tests", exitCode: 1 }),
    fetchJson: () => Promise.reject(new Error("no network")),
    now: () => 0,
    sleep: async () => {},
    isTTY: false,
    workDir: () => "/work",
    readFile: () => null,
    writeFile: () => {},
    confirm: async () => false,
    log: () => {},
  };
}

function report(status: ReleaseAppReport["status"], extra: Partial<ReleaseAppReport> = {}): ReleaseAppReport {
  return {
    apps: ["board"], status, lastTag: "v2.13.1", nextTag: "v2.13.2",
    steps: [], notes: null, notesHash: null, resume: null, ...extra,
  };
}

interface Harness {
  runs: ReleaseAppOptions[];
  logs: string[];
  exitCode: number;
  exitCalled: number | undefined;
}

async function invoke(args: string[], o: { result?: ReleaseAppReport } = {}): Promise<Harness> {
  const h: Harness = { runs: [], logs: [], exitCode: 0, exitCalled: undefined };
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { h.logs.push(a.map(String).join(" ")); });
  const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
    h.exitCalled = code;
    throw new Error("process.exit sentinel");
  });
  process.exitCode = 0;
  try {
    await releaseApps(args, {}, {
      seams: seams(),
      run: async (_s, opts) => { h.runs.push(opts); return o.result ?? report("released"); },
    });
  } catch (err) {
    if (!String(err).includes("process.exit sentinel")) throw err;
  } finally {
    h.exitCode = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    exitSpy.mockRestore();
    logSpy.mockRestore();
  }
  return h;
}

describe("rt release apps: arguments", () => {
  test("takes no app name: a bare run releases whatever moved", async () => {
    const h = await invoke([]);
    expect(h.runs).toEqual([{ dryRun: false, json: false, yesNotes: null }]);
  });

  test("an app name is a usage error that says the verb takes none", async () => {
    const h = await invoke(["board"]);
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBe(2);
    expect(h.logs.join("\n")).toContain("usage: rt release apps [--dry-run]");
  });

  test("passes every flag through, --yes-notes with its approval token", async () => {
    const h = await invoke(["--dry-run", "--yes-notes", "0123456789ab"]);
    expect(h.runs).toEqual([{ dryRun: true, json: false, yesNotes: "0123456789ab" }]);
  });

  test("--yes-notes takes only a notes hash: the tag form is a usage error", async () => {
    for (const token of ["v2.13.2", "0123456789", "0123456789abcd", "0123456789AB"]) {
      const h = await invoke(["--yes-notes", token]);
      expect(h.runs).toEqual([]);
      expect(h.exitCalled).toBe(2);
      expect(h.logs.join("\n")).toContain("--yes-notes <notes hash>");
    }
  });

  test("--yes-notes without a value is a usage error", async () => {
    const h = await invoke(["--yes-notes"]);
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBe(2);
  });

  test("--json usage errors come back as a JSON envelope", async () => {
    const h = await invoke(["board", "--json"]);
    expect(h.exitCalled).toBe(2);
    const body = JSON.parse(h.logs.at(-1)!) as { error: { code: string } };
    expect(body.error.code).toBe("usage");
  });
});

describe("rt release apps: output", () => {
  test("a dry run names every app it would ship and the tag", async () => {
    const h = await invoke(["--dry-run"], { result: report("planned", { apps: ["boxscore", "chat", "console"] }) });
    expect(h.logs.join("\n")).toContain("release boxscore, chat and console as v2.13.2");
  });

  test("a pending publish exits 1 and names the recheck", async () => {
    const h = await invoke([], { result: report("pending", { resume: "rt release verify v2.13.2" }) });
    expect(h.exitCode).toBe(1);
    expect(h.logs.join("\n")).toContain("rt release verify v2.13.2");
  });

  test("--json prints the report in the envelope; an approval stop exits 0", async () => {
    const h = await invoke(["--json"], { result: report("awaiting-approval", { notes: "notes\n", notesHash: "0123456789ab", resume: "rt release apps --json --yes-notes 0123456789ab" }) });
    const body = JSON.parse(h.logs.at(-1)!) as ReleaseAppReport & { contract: number };
    expect(body.contract).toBe(1);
    expect(body.status).toBe("awaiting-approval");
    expect(body.apps).toEqual(["board"]);
    expect(body.resume).toBe("rt release apps --json --yes-notes 0123456789ab");
    expect(h.exitCode).toBe(0);
  });

  test("a failed step exits 1 and names the step and the resume command", async () => {
    const h = await invoke([], {
      result: report("failed", {
        steps: [{ id: "tag", label: "tag", status: "failed", detail: "push rejected" }],
        resume: "rt release apps",
      }),
    });
    expect(h.exitCode).toBe(1);
    expect(h.logs.join("\n")).toContain("stopped at tag");
    expect(h.logs.join("\n")).toContain("resume: rt release apps");
  });

  test("a released report prints the next tag and exits 0", async () => {
    const h = await invoke([]);
    expect(h.exitCode).toBe(0);
    expect(h.logs.join("\n")).toContain("released v2.13.2");
  });
});
