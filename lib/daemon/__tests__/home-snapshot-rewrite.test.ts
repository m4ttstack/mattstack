import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import type { Logger } from "pino";
import { childEnv } from "../../subprocess.ts";
import { openStateDb } from "../../state/db.ts";
import { getKvValue, setKvValue } from "../../state/index.ts";
import { homeSnapshotSpec, startSnapshot, teamScope, type HomeSnapshotSettings } from "../home-snapshot.ts";
import type { GateVerdict } from "../../team/org-layout.ts";

// An org repo whose history was rewritten upstream (a squash, a purity scrub)
// leaves every clone that pulled before it holding the old commits. When those
// commits change nothing origin does not already have, the pull resets the
// clone to origin instead of stopping on a rebase conflict.

const SETTINGS: HomeSnapshotSettings = { enabled: true, debounceSec: 5, pushDelaySec: 3600, janitorThresholdHours: 1, janitorIntervalMin: 15 };
const env = { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env }).toString();
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commit = (dir: string, rel: string, text: string, message: string) => {
  write(dir, rel, text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};

function fakeLog(): Logger & { calls: { level: string; args: unknown[] }[] } {
  const calls: { level: string; args: unknown[] }[] = [];
  const rec = (level: string) => (...args: unknown[]) => calls.push({ level, args });
  return { info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug"), calls } as unknown as Logger & {
    calls: { level: string; args: unknown[] }[];
  };
}

/**
 * origin holds a base commit then two edits; `clone` pulls all three. The
 * author then squashes the two edits into one and force-pushes, so the clone
 * holds two commits origin no longer has, with the same files at the tip.
 */
function rewrittenOrigin(root: string): { origin: string; author: string; clone: string } {
  const origin = join(root, "origin.git");
  const author = join(root, "author");
  const clone = join(root, "clone");
  git(root, "init", "--bare", "-q", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", author);
  commit(author, "mattstack/settings.team.jsonc", "{ \"a\": 1 }\n", "base");
  git(author, "remote", "add", "origin", origin);
  git(author, "push", "-q", "-u", "origin", "main");
  commit(author, "mattstack/settings.team.jsonc", "{ \"a\": 2 }\n", "edit one");
  commit(author, "mattstack/settings.team.jsonc", "{ \"a\": 3 }\n", "edit two");
  git(author, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, clone);
  git(author, "reset", "-q", "--soft", "HEAD~2");
  git(author, "commit", "-q", "-m", "edits, squashed");
  git(author, "push", "-q", "--force", "origin", "main");
  return { origin, author, clone };
}

function start(clone: string, db: ReturnType<typeof openStateDb>, gate?: () => Promise<GateVerdict | null>) {
  const log = fakeLog();
  const spec = { ...homeSnapshotSpec(clone), id: "team:acme", kvNamespace: "team-snapshot:acme", eventPrefix: "team" as const, scope: teamScope, pull: { intervalSec: 3600, ...(gate ? { gate } : {}) } };
  return { log, handle: startSnapshot(spec, { log, broadcast: () => {}, db, readSettings: () => SETTINGS, readOwners: () => ({ zones: {} }) }) };
}

describe("a pull after origin's history was rewritten", () => {
  test("commits ahead that add nothing are reset to origin, with no conflict", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { author, clone } = rewrittenOrigin(root);
      const { handle } = start(clone, db);
      await handle.ready;
      const result = await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(result.outcome).toBe("reset");
      expect(handle.status().conflicted).toBeNull();
      expect(git(clone, "rev-parse", "HEAD").trim()).toBe(git(author, "rev-parse", "HEAD").trim());
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("a conflict saved before this rt clears on the next pull once the commits ahead add nothing", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-saved-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { author, clone } = rewrittenOrigin(root);
      setKvValue("team-snapshot:acme", "conflict", { at: 1, detail: "CONFLICT (content): mattstack/settings.team.jsonc" }, db);
      const { handle } = start(clone, db);
      await handle.ready;
      expect(handle.status().conflicted).not.toBeNull();
      const result = await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(result.outcome).toBe("reset");
      expect(handle.status().conflicted).toBeNull();
      expect(getKvValue("team-snapshot:acme", "conflict", null, db)).toBeNull();
      expect(git(clone, "rev-parse", "HEAD").trim()).toBe(git(author, "rev-parse", "HEAD").trim());
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("a saved conflict is not reset onto an org layout this rt cannot read", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-gate-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { clone } = rewrittenOrigin(root);
      const before = git(clone, "rev-parse", "HEAD").trim();
      setKvValue("team-snapshot:acme", "conflict", { at: 1, detail: "CONFLICT (content): mattstack/settings.team.jsonc" }, db);
      const { handle } = start(clone, db, async () => ({ kind: "above", layout: 99 }));
      await handle.ready;
      const result = await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(result.outcome).toBe("skipped");
      expect(result.hold).toBeDefined();
      expect(git(clone, "rev-parse", "HEAD").trim()).toBe(before);
      expect(getKvValue("team-snapshot:acme", "conflict", null, db)).not.toBeNull();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("a real local edit ahead of origin still conflicts and is never reset", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-edit-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { clone } = rewrittenOrigin(root);
      commit(clone, "mattstack/settings.team.jsonc", "{ \"a\": 4 }\n", "my own edit");
      const before = git(clone, "rev-parse", "HEAD").trim();
      const { handle } = start(clone, db);
      await handle.ready;
      const result = await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(result.outcome).toBe("conflict");
      expect(git(clone, "rev-parse", "HEAD").trim()).toBe(before);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("an edit ahead that touches a file origin never changed is kept, not reset", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-other-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { clone } = rewrittenOrigin(root);
      commit(clone, "mattstack/teams/widgets/note.md", "mine\n", "my own file");
      const { handle } = start(clone, db);
      await handle.ready;
      await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(readFileSync(join(clone, "mattstack/teams/widgets/note.md"), "utf8")).toBe("mine\n");
      expect(git(clone, "log", "--format=%s").split("\n")).toContain("my own file");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("uncommitted work in the clone survives the reset", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-snapshot-rewrite-dirty-")));
    const db = openStateDb(join(root, "state.db"), "cli");
    try {
      const { author, clone } = rewrittenOrigin(root);
      write(clone, "scratch.txt", "not committed\n");
      const { handle } = start(clone, db);
      await handle.ready;
      const result = await handle.pullNow();
      await handle.settled();
      handle.stop();

      expect(result.outcome).toBe("reset");
      expect(git(clone, "rev-parse", "HEAD").trim()).toBe(git(author, "rev-parse", "HEAD").trim());
      expect(readFileSync(join(clone, "scratch.txt"), "utf8")).toBe("not committed\n");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
