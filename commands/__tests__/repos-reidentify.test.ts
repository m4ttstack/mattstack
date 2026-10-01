/**
 * The CLI takes its local branch here: the daemon presence checks read
 * module-load constants bound to the preload's throwaway HOME, which holds
 * neither a pid file nor a socket.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS } from "../../lib/repo-index.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { reposReidentify } from "../repos-reidentify.ts";

async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

describe("rt repos reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;
  let out: string[];
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-cmd-")));
    process.env.HOME = home;
    closeStateDb();
    out = [];
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("--dry-run --json prints the per-store report inside the envelope", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    await reposReidentify(["github.com/acme/old", "github.com/acme/new", "--dry-run", "--json"], {}, { print: (s) => out.push(s) });
    const doc = JSON.parse(out.join("\n"));
    expect(doc.ok).toBe(true);
    expect(doc.data.dryRun).toBe(true);
    expect(doc.data.stores.find((s: { store: string }) => s.store === "kv:repo-index")).toMatchObject({ status: "moved", count: 1 });
  });

  test("plain output lists one line per store with its status and count", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    await reposReidentify(["github.com/acme/old", "github.com/acme/new"], {}, { print: (s) => out.push(s) });
    expect(out.some((l) => /kv:repo-index\s+moved\s+1/.test(l))).toBe(true);
    expect(out.some((l) => /run_history\.repo\s+none/.test(l))).toBe(true);
  });

  test("a refused store prints the whole table, then exits non-zero", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fnew", "/y");
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() =>
        reposReidentify(["github.com/acme/old", "github.com/acme/new"], {}, { print: (s) => out.push(s) }),
      );
      expect(code).toBe(2);
      expect(out.some((l) => /kv:repo-index\s+refused/.test(l))).toBe(true);
      expect(out.some((l) => /run_history\.repo\s+none/.test(l))).toBe(true);
      expect(io.stderr()).toContain("refused: kv:repo-index");
    } finally {
      io.restore();
    }
  });

  test("nothing under the old identity says so instead of claiming a move", async () => {
    await reposReidentify(["github.com/acme/typo", "github.com/acme/new"], {}, { print: (s) => out.push(s) });
    expect(out[0]).toBe("nothing under remote:github.com%2Facme%2Ftypo to move (local)");
  });

  test("a refused --json run prints exactly one document carrying the report", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fnew", "/y");
    const code = await runExpectingProcessExit(() =>
      reposReidentify(["github.com/acme/old", "github.com/acme/new", "--json"], {}, { print: (s) => out.push(s) }),
    );
    expect(code).toBe(2);
    const doc = JSON.parse(out.join("\n"));
    expect(doc.error.code).toBe("refused");
    expect(doc.error.via).toBe("local");
    expect(doc.error.report.stores.find((s: { store: string }) => s.store === "kv:repo-index").status).toBe("refused");
  });

  test("a successful --json run names the path it took", async () => {
    await reposReidentify(["github.com/acme/old", "github.com/acme/new", "--json"], {}, { print: (s) => out.push(s) });
    expect(JSON.parse(out.join("\n")).via).toBe("local");
  });

  test("a refused plain run does not claim it moved", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fnew", "/y");
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await runExpectingProcessExit(() => reposReidentify(["github.com/acme/old", "github.com/acme/new"], {}, { print: (s) => out.push(s) }));
      expect(out[0]).toStartWith("refused, partly moved ");
      expect(io.stderr()).toContain("[failed] refused");
    } finally {
      io.restore();
    }
  });

  test("usage error on a missing positional", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposReidentify(["github.com/acme/old"], {}, { print: (s) => out.push(s) }));
      expect(code).toBe(2);
      expect(out).toEqual([]);
      expect(io.stderr()).toContain("[failed] reidentify takes two identities, got 1; usage: rt repos reidentify");
      expect(io.stderr()).not.toContain("rt repos reidentify:");
    } finally {
      io.restore();
    }
  });

  test("an identity that is not a remote is a refusal with no table", async () => {
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposReidentify(["/tmp/x", "github.com/acme/new"], {}, { print: (s) => out.push(s) }));
      expect(code).toBe(2);
      expect(out).toEqual([]);
      expect(io.stderr()).toContain("remote-kind");
    } finally {
      io.restore();
    }
  });
});
