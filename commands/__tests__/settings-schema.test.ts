import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildLock } from "../../lib/settings/schema-lock.ts";
import { MIGRATIONS_INDEX_PATH, MIGRATION_SCHEMAS_PATH } from "../../lib/settings/schema-draft.ts";
import { settingsSchemaDiff, settingsSchemaLock } from "../settings-schema.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("settingsSchemaLock", () => {
  let dir: string;
  let cap: ReturnType<typeof captureOut>;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-schema-lock-")));
    process.exitCode = 0;
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    cap.restore();
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes the built lock to --out and prints its path", async () => {
    const target = join(dir, "schema.lock.json");

    await settingsSchemaLock(["--out", target]);

    expect(readFileSync(target, "utf8")).toBe(`${JSON.stringify(buildLock(), null, 2)}\n`);
    expect(cap.stdout()).toBe(`${target}\n`);
    expect(cap.stderr()).toBe("");
  });

  test("a compiled-binary lock path refuses to write and exits 1", async () => {
    const bunfsPath = "/$bunfs/nope/schema.lock.json";

    await settingsSchemaLock([], { lockPath: bunfsPath });

    expect(process.exitCode).toBe(1);
    expect(cap.stderr()).toContain("run from source");
  });
});

describe("settingsSchemaDiff", () => {
  const LOCK_REL = "packages/rt-client/src/settings/schema.lock.json";
  let dir: string;
  let cap: ReturnType<typeof captureOut>;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-schema-diff-")));
    process.exitCode = 0;
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    cap.restore();
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLock = (lock: unknown): string => {
    const p = join(dir, "prev.lock.json");
    writeFileSync(p, JSON.stringify(lock));
    return p;
  };

  test("a key whose type changed without a storeVersion bump fails with the change and the problem", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { ...built[key]!.schema, type: "boolean" } } };

    await settingsSchemaDiff(["--against", writeLock(prev), "--json"], { shippedLock: null });

    const body = JSON.parse(cap.stdout());
    expect(body.ok).toBe(false);
    expect(body.changes).toContainEqual(expect.objectContaining({ key, kind: "breaking" }));
    expect(body.problems).toContainEqual(expect.stringContaining(key));
    expect(process.exitCode).toBe(1);
  });

  test("a breaking change prints a table row, the problem as a failed line, and exits 1", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { ...built[key]!.schema, type: "boolean" } } };

    await settingsSchemaDiff(["--against", writeLock(prev)], { shippedLock: null });

    expect(cap.stdout()).toMatch(new RegExp(`^breaking  ${key.replace(/\./g, "\\.")}  `));
    expect(cap.stdout()).toContain(`\n[failed] `);
    expect(process.exitCode).toBe(1);
  });

  test("an empty previous lock is all additions and passes", async () => {
    await settingsSchemaDiff(["--against", writeLock({}), "--json"], { shippedLock: null });

    const body = JSON.parse(cap.stdout());
    expect(body.ok).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.changes.every((c: { kind: string }) => c.kind === "safe")).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test("a missing --against file reads as an empty lock and warns naming the path", async () => {
    const absent = join(dir, "absent.json");
    await settingsSchemaDiff(["--against", absent, "--json"], { shippedLock: null });

    expect(JSON.parse(cap.stdout()).ok).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(cap.stderr()).toContain(absent);
  });

  test("--against and --against-ref together is a usage error", async () => {
    await settingsSchemaDiff(["--against", writeLock({}), "--against-ref", "HEAD", "--json"]);

    expect(process.exitCode).toBe(1);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toContain("--against");
    expect(cap.stderr()).toContain("--against-ref");
  });

  test("a compiled-binary repo root refuses and exits 1", async () => {
    await settingsSchemaDiff(["--json"], { repoRoot: "/$bunfs/root/" });

    expect(process.exitCode).toBe(1);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toContain("run from source");
  });

  test("the committed lock diffed against itself prints no changes", async () => {
    await settingsSchemaDiff(["--against", writeLock(buildLock())], { shippedLock: null });

    expect(cap.stdout()).toBe("[ok] No schema changes\n");
    expect(process.exitCode).toBe(0);
  });

  test("an unknown --against-ref is an error, not an empty lock", async () => {
    const git = (args: string[]) => (args[0] === "rev-parse" ? { status: 1, stdout: "", stderr: "" } : { status: 0, stdout: "", stderr: "" });
    await settingsSchemaDiff(["--against-ref", "refs/heads/no-such-branch-for-schema-diff", "--json"], { git });

    expect(process.exitCode).toBe(1);
    expect(cap.stderr()).toContain("no-such-branch-for-schema-diff");
  });

  // "tag" is answered separately from "show" so a fake built for the against-ref path never
  // doubles as a (wrong) tag list: an unanswered tag --list must read as "no tags", not as
  // whatever the show fixture happens to return.
  const fakeGit = (show: { status: number; stdout?: string; stderr?: string }, tag: { status?: number; stdout?: string } = { status: 0, stdout: "" }) => (args: string[]) => {
    if (args[0] === "rev-parse") return { status: 0, stdout: "abc\n", stderr: "" };
    if (args[0] === "tag") return { status: tag.status ?? 0, stdout: tag.stdout ?? "", stderr: "" };
    return { stdout: "", stderr: "", ...show };
  };

  test("a ref whose tree has no lock reads as an empty lock", async () => {
    for (const stderr of [
      "fatal: path 'packages/rt-client/src/settings/schema.lock.json' does not exist in 'origin/main'",
      "fatal: path 'packages/rt-client/src/settings/schema.lock.json' exists on disk, but not in 'origin/main'",
    ]) {
      cap.clear();
      await settingsSchemaDiff(["--json"], { git: fakeGit({ status: 128, stderr }) });
      expect(JSON.parse(cap.stdout()).ok).toBe(true);
      expect(process.exitCode).toBe(0);
    }
  });

  test("any other git show failure is an error, never an empty lock", async () => {
    await settingsSchemaDiff(["--json"], { git: fakeGit({ status: 128, stderr: "fatal: bad object 1234abcd" }) });

    expect(process.exitCode).toBe(1);
    expect(cap.stdout()).toBe("");
    expect(cap.stderr()).toContain("bad object");
  });

  test("--json reports the shipped ref whose lock the acknowledgement hatch reads", async () => {
    const git = () => ({ status: 0, stdout: "{}", stderr: "" });
    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "HEAD", "--json"], { git });
    expect(JSON.parse(cap.stdout()).shipped).toBe("HEAD");
  });

  test("an unknown --shipped-ref is an error, not an empty lock", async () => {
    const git = (args: string[]) => (args[0] === "rev-parse" ? { status: 1, stdout: "", stderr: "" } : { status: 0, stdout: "", stderr: "" });
    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "refs/tags/no-such-tag-for-schema-diff", "--json"], { git });
    expect(process.exitCode).toBe(1);
    expect(cap.stderr()).toContain("no-such-tag-for-schema-diff");
  });

  test("no --shipped-ref resolves the highest v* tag from git tag --list, and reads that tag's lock", async () => {
    const shows: string[] = [];
    const git = (args: string[]) => {
      if (args[0] === "tag") return { status: 0, stdout: "v9.9.9\nv1.0.0\n", stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc\n", stderr: "" };
      shows.push(args[1] ?? "");
      return { status: 0, stdout: "{}", stderr: "" };
    };

    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--json"], { git });

    expect(JSON.parse(cap.stdout()).shipped).toBe("v9.9.9");
    expect(shows).toEqual([`v9.9.9:${LOCK_REL}`]);
  });

  test("--draft writes a step for a breaking change into copies of the two migration files", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { type: "boolean" } } };
    const indexPath = join(dir, "index.ts");
    const schemasPath = join(dir, "schemas.ts");
    copyFileSync(MIGRATIONS_INDEX_PATH, indexPath);
    copyFileSync(MIGRATION_SCHEMAS_PATH, schemasPath);

    await settingsSchemaDiff(["--against", writeLock(prev), "--draft", "--json"], {
      shippedLock: null,
      migrationsIndexPath: indexPath,
      migrationSchemasPath: schemasPath,
    });

    const body = JSON.parse(cap.stdout()) as { drafts: { kind: string; key: string }[] };
    expect(body.drafts).toContainEqual(expect.objectContaining({ kind: "step", key }));
    expect(readFileSync(indexPath, "utf8")).toContain(`key: ${JSON.stringify(key)}`);
    expect(readFileSync(schemasPath, "utf8")).toContain("schema: z.boolean()");
    expect(process.exitCode).toBe(1);
  });

  test("a malformed lock at the ref or in --against is an error naming its source", async () => {
    await settingsSchemaDiff(["--json"], { git: fakeGit({ status: 0, stdout: "{ not json" }) });
    expect(process.exitCode).toBe(1);
    expect(cap.stderr()).toContain("origin/main");

    process.exitCode = 0;
    cap.clear();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    await settingsSchemaDiff(["--against", bad, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(cap.stderr()).toContain(bad);
    expect(cap.stdout()).toBe("");
  });
});
