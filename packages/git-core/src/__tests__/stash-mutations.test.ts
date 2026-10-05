import { describe, expect, it } from "bun:test";
import { simpleGit } from "simple-git";
import type { ClientContext } from "../client.ts";
import { stashPop } from "../stash.ts";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

function porcelainLine(out: string): string {
  return out.replace(/\n+$/, "");
}

async function seeded() {
  const sb = await makeSandbox();
  await sb.write("a.txt", "one\n");
  await sb.commitAll("first");
  return sb;
}

describe("stashPush", () => {
  it("pushes with a message, listed at index 0, tree clean after", async () => {
    const sb = await seeded();
    try {
      await sb.write("a.txt", "two\n");
      const client = createGitClient(sb.dir);
      const result = await client.stashPush({ message: "wip work" });
      expect(result).toEqual({ created: true });
      const stashes = await client.stashes();
      expect(stashes[0]).toEqual({ index: 0, branch: "main", message: "wip work" });
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("returns created false and adds no entry when there is nothing to stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      const result = await client.stashPush();
      expect(result).toEqual({ created: false });
      expect(await client.stashes()).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("includeUntracked stashes an untracked file", async () => {
    const sb = await seeded();
    try {
      await sb.write("untracked.txt", "new\n");
      const client = createGitClient(sb.dir);
      const result = await client.stashPush({ includeUntracked: true });
      expect(result).toEqual({ created: true });
      expect(porcelainLine(await sb.git(["status", "--porcelain"]))).toBe("");
    } finally {
      await sb.cleanup();
    }
  });
});

describe("stashApply / stashPop / stashDrop", () => {
  it("apply restores changes and keeps the entry; pop restores and removes; drop removes without touching the tree", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "two\n");
      await client.stashPush({ message: "first change" });

      await client.stashApply(0);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
      expect((await client.stashes()).length).toBe(1);

      await sb.git(["checkout", "--", "a.txt"]);
      await client.stashPop(0);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
      expect(await client.stashes()).toEqual([]);

      await sb.write("a.txt", "three\n");
      await client.stashPush({ message: "second change" });
      await sb.write("a.txt", "two\n");
      await client.stashDrop(0);
      expect(await client.stashes()).toEqual([]);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("a verified successful pop does not fail on a later stash-list read", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "two\n");
      await client.stashPush({ message: "selected" });
      const git = simpleGit({ baseDir: sb.dir });
      let lists = 0;
      const ctx: ClientContext = {
        dir: sb.dir,
        git: new Proxy(git, {
          get(target, property) {
            if (property === "stashList") {
              return async () => {
                if (++lists > 1) throw new Error("later stash-list read failed");
                return target.stashList();
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };

      const result = await stashPop(ctx, 0).catch((err: unknown) => err);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("two\n");
      expect(await sb.git(["stash", "list"])).toBe("");
      expect(result).toEqual({ kept: false });
      expect(lists).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  for (const index of [0, 1]) {
    it(`pop at index ${index} reports not kept when another stash replaces its count`, async () => {
      const sb = await seeded();
      try {
        await sb.write("b.txt", "base\n");
        await sb.commitAll("add second file");
        const client = createGitClient(sb.dir);
        await sb.write("a.txt", "selected\n");
        await client.stashPush({ message: "selected" });
        const selectedHash = (await sb.git(["rev-parse", "stash@{0}"])).trim();
        if (index === 1) {
          await sb.write("b.txt", "newer\n");
          await client.stashPush({ message: "newer" });
        }

        await sb.write("b.txt", "unrelated\n");
        const unrelatedHash = (await sb.git(["stash", "create", "unrelated"])).trim();
        await sb.git(["checkout", "--", "b.txt"]);
        const git = simpleGit({ baseDir: sb.dir });
        const ctx: ClientContext = {
          dir: sb.dir,
          git: new Proxy(git, {
            get(target, property) {
              if (property === "stash") {
                return async (args: string[]) => {
                  const output = await target.stash(args);
                  await sb.git(["stash", "store", "-m", "unrelated", unrelatedHash]);
                  return output;
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        };

        expect(await stashPop(ctx, index)).toEqual({ kept: false });
        expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("selected\n");
        expect(await Bun.file(`${sb.dir}/b.txt`).text()).toBe("base\n");
        const hashes = (await sb.git(["stash", "list", "--format=%H"])).trim().split("\n");
        expect(hashes).toHaveLength(index + 1);
        expect(hashes).not.toContain(selectedHash);
        expect(hashes).toContain(unrelatedHash);
        if (index === 1) expect((await client.stashes()).map((entry) => entry.message)).toEqual(["unrelated", "newer"]);
      } finally {
        await sb.cleanup();
      }
    });
  }

  for (const index of [0, 1]) {
    it(`pop at index ${index} reports not kept when another entry has the same commit`, async () => {
      const sb = await seeded();
      try {
        const client = createGitClient(sb.dir);
        await sb.write("a.txt", "selected\n");
        await client.stashPush({ message: "selected" });
        const selectedHash = (await sb.git(["rev-parse", "stash@{0}"])).trim();
        await sb.write("a.txt", "temporary\n");
        const temporaryHash = (await sb.git(["stash", "create", "temporary"])).trim();
        await sb.git(["checkout", "--", "a.txt"]);
        await sb.git(["stash", "store", "-m", "temporary", temporaryHash]);
        await sb.git(["stash", "store", "-m", "duplicate", selectedHash]);
        await sb.git(["stash", "drop", "stash@{1}"]);
        expect((await client.stashes()).length).toBe(2);

        expect(await client.stashPop(index)).toEqual({ kept: false });
        expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("selected\n");
        expect((await client.stashes()).length).toBe(1);
        expect((await sb.git(["stash", "list", "--format=%gs"])).trim()).toBe(index === 0 ? "On main: selected" : "duplicate");
        expect((await sb.git(["stash", "list", "--format=%H"])).trim()).toBe(selectedHash);
      } finally {
        await sb.cleanup();
      }
    });
  }

  it("pop rejects a local-edit collision with a filename containing CONFLICT", async () => {
    const sb = await seeded();
    try {
      await sb.write("CONFLICT.txt", "base\n");
      await sb.commitAll("add conflict filename");
      const client = createGitClient(sb.dir);
      await sb.write("CONFLICT.txt", "stashed\n");
      await client.stashPush({ message: "mine" });
      await sb.write("CONFLICT.txt", "local\n");

      await expect(client.stashPop(0)).rejects.toThrow(/would be overwritten by merge/);
      expect(await Bun.file(`${sb.dir}/CONFLICT.txt`).text()).toBe("local\n");
      expect((await client.stashes()).length).toBe(1);
      expect(await sb.git(["diff", "--name-only", "--diff-filter=U"])).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("pop at an invalid index rejects without changing an existing stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.stashPush({ message: "mine" });
      const before = await client.stashes();

      await expect(client.stashPop(5)).rejects.toThrow(/only has 1 entries/);
      expect(await client.stashes()).toEqual(before);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toBe("one\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("pop on an empty stash list rejects with an error mentioning the ref", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await expect(client.stashPop(0)).rejects.toThrow(/stash@\{0\}/);
    } finally {
      await sb.cleanup();
    }
  });
});

describe("stashPop on a conflict", () => {
  it("a conflicting pop reports kept and leaves the stash", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.stashPush({ message: "mine" });
      await sb.write("a.txt", "committed\n");
      await sb.commitAll("theirs");
      expect(await client.stashPop(0)).toEqual({ kept: true });
      expect((await client.stashes()).length).toBe(1);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toContain("<<<<<<<");
    } finally {
      await sb.cleanup();
    }
  });

  it("a conflicting pop keeps the entry when an untracked filename looks like a drop message", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "stashed\n");
      await client.stashPush({ message: "mine" });
      const selectedHash = (await sb.git(["rev-parse", "stash@{0}"])).trim();
      await sb.write("a.txt", "committed\n");
      await sb.commitAll("theirs");
      await sb.write(`Dropped stash@{0} (${selectedHash})`, "untracked\n");

      expect(await client.stashPop(0)).toEqual({ kept: true });
      expect((await client.stashes()).length).toBe(1);
      expect(await Bun.file(`${sb.dir}/a.txt`).text()).toContain("<<<<<<<");
    } finally {
      await sb.cleanup();
    }
  });

  it("a clean pop reports not kept", async () => {
    const sb = await seeded();
    try {
      const client = createGitClient(sb.dir);
      await sb.write("a.txt", "two\n");
      await client.stashPush({ message: "x" });
      expect(await client.stashPop(0)).toEqual({ kept: false });
    } finally {
      await sb.cleanup();
    }
  });
});
