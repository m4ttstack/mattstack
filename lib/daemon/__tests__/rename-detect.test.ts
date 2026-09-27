import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearIdentityMemo, deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { detectRenamedRepos, realRenameDetectDeps, startRenameDetector, type RenameDetectDeps } from "../rename-detect.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";
const silent = { info: () => {}, warn: () => {} };

function deps(over: Partial<RenameDetectDeps>): RenameDetectDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    entries: () => [{ repoName: OLD, path: "/repo" }],
    readRemote: async () => "https://github.com/acme/new.git",
    renamedTo: async (o, r) => (o === "acme" && r === "old" ? "acme/new" : null),
    reidentify: async (from, to) => { calls.push(`${from}->${to}`); return { ok: true }; },
    log: silent,
    calls,
    ...over,
  };
}

describe("detectRenamedRepos", () => {
  test("applies when the fresh remote derives a new identity and GitHub names it the same repo", async () => {
    const d = deps({});
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: true }]);
    expect(d.calls).toEqual([`${OLD}->${NEW}`]);
  });

  test("matches GitHub's full_name case-insensitively", async () => {
    const d = deps({ renamedTo: async () => "Acme/New" });
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: true }]);
  });

  test("does nothing when the remote still derives the same identity", async () => {
    const d = deps({ readRemote: async () => "git@github.com:acme/old.git" });
    expect(await detectRenamedRepos(d)).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  test("does nothing for a non-GitHub remote", async () => {
    const d = deps({ readRemote: async () => "https://gitlab.com/acme/new.git" });
    expect(await detectRenamedRepos(d)).toEqual([]);
  });

  test("does nothing when GitHub does not report a rename", async () => {
    const d = deps({ renamedTo: async () => null });
    expect(await detectRenamedRepos(d)).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  test("does nothing when GitHub names a different repo than the remote derives", async () => {
    const d = deps({ renamedTo: async () => "acme/elsewhere" });
    expect(await detectRenamedRepos(d)).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  test("a missing remote or path is skipped, not thrown", async () => {
    const d = deps({ readRemote: async () => null });
    expect(await detectRenamedRepos(d)).toEqual([]);
  });

  test("reports applied false when reidentify refuses", async () => {
    const d = deps({ reidentify: async () => ({ ok: false }) });
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: false }]);
  });

  test("one entry's throw does not stop the pass", async () => {
    const d = deps({
      entries: () => [{ repoName: OLD, path: "/broken" }, { repoName: OLD, path: "/repo" }],
      readRemote: async (p) => {
        if (p === "/broken") throw new Error("boom");
        return "https://github.com/acme/new.git";
      },
    });
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: true }]);
  });
});

describe("detectRenamedRepos and the identity memo", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-rename-detect-memo-")));
    clearIdentityMemo();
  });
  afterEach(() => {
    clearIdentityMemo();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an apply clears the memo so an unmoved checkout derives the new identity", async () => {
    const checkout = join(dir, "checkout");
    mkdirSync(checkout);
    execSync("git init -q -b main && git remote add origin https://github.com/acme/old.git", { cwd: checkout, stdio: "pipe" });
    expect(serializeIdentity(await deriveRepoIdentity(checkout))).toBe(OLD);
    execSync("git remote set-url origin https://github.com/acme/new.git", { cwd: checkout, stdio: "pipe" });
    expect(serializeIdentity(await deriveRepoIdentity(checkout))).toBe(OLD);

    await detectRenamedRepos(deps({}));

    expect(serializeIdentity(await deriveRepoIdentity(checkout))).toBe(NEW);
  });
});

describe("realRenameDetectDeps.renamedTo", () => {
  test("follows the 301 to /repositories/<id> and reads full_name", async () => {
    const seen: { url: string; redirect?: RequestInit["redirect"] }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, redirect: init?.redirect });
      if (url === "https://api.github.com/repos/acme/old") {
        return new Response(null, { status: 301, headers: { location: "https://api.github.com/repositories/123" } });
      }
      if (url === "https://api.github.com/repositories/123") {
        return new Response(JSON.stringify({ full_name: "acme/new" }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const real = realRenameDetectDeps(silent as never, fetchImpl);

    expect(await real.renamedTo("acme", "old")).toBe("acme/new");
    expect(seen.map((s) => s.url)).toEqual(["https://api.github.com/repos/acme/old", "https://api.github.com/repositories/123"]);
    expect(seen[0]!.redirect).toBe("manual");
  });

  test("any status but 301, or a thrown fetch, is null", async () => {
    const ok = realRenameDetectDeps(silent as never, (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch);
    expect(await ok.renamedTo("acme", "old")).toBeNull();
    const down = realRenameDetectDeps(silent as never, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(await down.renamedTo("acme", "old")).toBeNull();
  });
});

describe("startRenameDetector", () => {
  test("the first pass waits for the boot migration to settle, even when it rejects", async () => {
    let settle!: (v?: unknown) => void;
    const bootMigration = new Promise((_, reject) => { settle = reject; });
    let runs = 0;
    const stop = startRenameDetector(bootMigration, async () => { runs++; }, 60 * 60 * 1000);
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(runs).toBe(0);
      settle(new Error("migration failed"));
      await bootMigration.catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      expect(runs).toBe(1);
    } finally {
      stop();
    }
  });
});
