import { describe, expect, spyOn, test } from "bun:test";
import { progressBlocks, releaseAppBlocks, releaseApps } from "../release.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
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
    progress: () => {},
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
  stdout: string;
  stderr: string;
  exitCode: number;
  exitCalled: number | undefined;
}

async function invoke(args: string[], o: { result?: ReleaseAppReport } = {}): Promise<Harness> {
  const h: Harness = { runs: [], logs: [], stdout: "", stderr: "", exitCode: 0, exitCalled: undefined };
  const io = captureOut();
  ui.__test__.setHuman(() => false);
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
    h.logs = io.lines();
    h.stdout = io.stdout();
    h.stderr = io.stderr();
    io.restore();
    h.exitCode = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    exitSpy.mockRestore();
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
    expect(h.logs).toEqual([]);
    expect(h.stderr).toBe("This command takes no app name\n  why: It releases every app that changed.\n  next: rt release apps [--dry-run] [--json] [--yes-notes <notes hash>]\n");
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
      expect(h.stderr).toContain("--yes-notes <notes hash>");
      expect(h.stderr).toStartWith("The notes hash is the 12 characters a stopped run printed\n");
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
    const body = JSON.parse(h.stdout.trim()) as { error: { code: string } };
    expect(body.error.code).toBe("usage");
  });
});

describe("rt release apps: output", () => {
  test("a dry run names every app it would ship and the tag", async () => {
    const h = await invoke(["--dry-run"], { result: report("planned", { apps: ["boxscore", "chat", "console"] }) });
    expect(h.logs).toEqual(["[not yet] Dry run: nothing changed  a real run releases boxscore, chat and console as v2.13.2"]);
  });

  test("a pending publish exits 1 and names the recheck", async () => {
    const h = await invoke([], { result: report("pending", { resume: "rt release verify v2.13.2" }) });
    expect(h.exitCode).toBe(1);
    expect(h.logs).toEqual(["[not yet] v2.13.2 is tagged, and its publish has not verified yet", "  next: rt release verify v2.13.2"]);
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
    expect(h.logs).toEqual(["[failed] Stopped at tag", "  next: rt release apps"]);
  });

  test("a released report prints the next tag and exits 0", async () => {
    const h = await invoke([]);
    expect(h.exitCode).toBe(0);
    expect(h.logs).toEqual(["[ok] Released v2.13.2"]);
  });
  test("the other endings: approval, a no at the prompt, a fast path refusal, and a failure with nothing to rerun", () => {
    expect(renderPlain(releaseAppBlocks(report("awaiting-approval", { resume: "rt release apps --yes-notes 0123456789ab" })))).toBe(
      "[needs you] The notes need your approval\n  next: rt release apps --yes-notes 0123456789ab\n",
    );
    expect(renderPlain(releaseAppBlocks(report("declined", { resume: "rt release apps" })))).toBe(
      "[skipped] You said no: nothing was committed or tagged\n  next: rt release apps\n",
    );
    const qualify = { id: "qualify" as const, label: "qualify", status: "stopped" as const, detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [qualify] })))).toBe(
      "[refused] rt will not take the fast path for this release  Main does not qualify for the fast path since v2.13.1: lib/ changed\n",
    );
    const nothing = { ...qualify, detail: "nothing has moved since v2.13.1" };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [nothing] })))).toBe("[skipped] Nothing to release  nothing has moved since v2.13.1\n");
    const noTag = { ...qualify, detail: "origin has no release tag. Run this from an rt checkout." };
    expect(renderPlain(releaseAppBlocks(report("declined", { steps: [noTag] })))).toBe(
      "rt cannot release from here\n  why: origin has no release tag. Run this from an rt checkout.\n",
    );
    expect(renderPlain(releaseAppBlocks(report("failed", { steps: [{ id: "qualify", label: "qualify", status: "failed", detail: "main moved" }] })))).toBe(
      "[failed] Stopped at qualify  this needs a decision, not a rerun\n",
    );
  });

  test("the three stops with nothing to resume each go where they belong: a refusal and a failure on stderr, nothing to release on stdout", async () => {
    const stopped = (detail: string) => report("declined", { steps: [{ id: "qualify" as const, label: "qualify", status: "stopped" as const, detail }] });

    const noTag = await invoke([], { result: stopped("origin has no release tag. Run this from an rt checkout.") });
    expect(noTag.exitCode).toBe(1);
    expect(noTag.stdout).toBe("");
    expect(noTag.stderr).toStartWith("rt cannot release from here\n");

    const nothing = await invoke([], { result: stopped("nothing has moved since v2.13.1") });
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stderr).toBe("");
    expect(nothing.logs).toEqual(["[skipped] Nothing to release  nothing has moved since v2.13.1"]);
  });

  test("a fast path refusal is refused, not failed: on stderr, exit code 1 as today", async () => {
    const qualify = { id: "qualify" as const, label: "qualify", status: "stopped" as const, detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" };
    const h = await invoke([], { result: report("declined", { steps: [qualify] }) });
    expect(h.exitCode).toBe(1);
    expect(h.stdout).toBe("");
    expect(h.stderr).toBe("[refused] rt will not take the fast path for this release  Main does not qualify for the fast path since v2.13.1: lib/ changed\n");
  });

  test("progress: a step is a status line with its command under it, the watch is a running line, the notes are verbatim", () => {
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "tag", label: "tag", status: "planned", detail: "tag v2.13.2 at the notes commit and push it", command: "git tag -a v2.13.2 <notes commit> -m v2.13.2" } }))).toBe(
      "[not yet] tag  tag v2.13.2 at the notes commit and push it\n  next: git tag -a v2.13.2 <notes commit> -m v2.13.2\n",
    );
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "notes", label: "release notes", status: "stopped", detail: "the notes need approval" } }))).toBe("[needs you] release notes  the notes need approval\n");
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "Main does not qualify for the fast path since v2.13.1: lib/ changed" } }))).toBe(
      "[refused] qualify  Main does not qualify for the fast path since v2.13.1: lib/ changed\n",
    );
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "nothing has moved since v2.13.1" } }))).toBe("[skipped] qualify  nothing has moved since v2.13.1\n");
    expect(renderPlain(progressBlocks({ kind: "step", step: { id: "qualify", label: "qualify", status: "stopped", detail: "origin has no release tag. Run this from an rt checkout." } }))).toBe(
      "[failed] qualify  origin has no release tag. Run this from an rt checkout.\n",
    );
    expect(renderPlain(progressBlocks({ kind: "watching", tag: "v2.13.2" }))).toBe("[running] Watching the release build for v2.13.2  a real run takes 25 to 50 minutes\n");
    expect(renderPlain(progressBlocks({ kind: "notes", notes: "A patch release.\n\n### board", hash: "0123456789ab" }))).toBe(
      "release notes:\n  A patch release.\n  \n  ### board\nnotes hash: 0123456789ab\n",
    );
  });

  test("--json keeps stdout for the envelope: progress lands on stderr", async () => {
    const h: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    process.exitCode = 0;
    try {
      await releaseApps(["--json", "--dry-run"], {}, {
        run: async (s) => {
          s.progress({ kind: "watching", tag: "v2.13.2" });
          return report("planned");
        },
      });
      h.stdout = io.stdout();
      h.stderr = io.stderr();
    } finally {
      io.restore();
      process.exitCode = 0;
    }
    expect(h.stdout.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(h.stdout).status).toBe("planned");
    expect(h.stderr).toBe("[running] Watching the release build for v2.13.2  a real run takes 25 to 50 minutes\n");
  });
});
