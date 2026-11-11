import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { syncProjectMRs } from "../project-sync.ts";
import { createProjectMRs } from "../project-mrs-store.ts";
import { readSyncHealth } from "../project-sync-health.ts";
import { openStateDb } from "../../state/index.ts";

function repoWithOrigin(origin: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-psync-github-")));
  execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: path, stdio: "pipe" });
  return path;
}

describe("project sync on a GitHub repo", () => {
  test("is skipped without asking for a context, and logs the skip once", async () => {
    const repoName = "github.com/acme/psync-skip";
    const path = repoWithOrigin("git@github.com:acme/psync-skip.git");
    const store = createProjectMRs(openStateDb(join(mkdtempSync(join(tmpdir(), "rt-psync-")), "state.db"), "cli"));
    const asked: string[] = [];
    const logged: Array<{ obj: object; msg: string }> = [];
    const overrides = {
      store,
      repoContext: async (repo: string) => { asked.push(`context:${repo}`); throw new Error("must not ask for a context"); },
      fetchProject: async (repo: string) => { asked.push(`project:${repo}`); throw new Error("must not fetch"); },
      selfUsername: null,
      info: (obj: object, msg: string) => logged.push({ obj, msg }),
    };
    const deps = { repoIndex: () => ({ [repoName]: path }), broadcast: () => { throw new Error("must not broadcast"); } };

    await syncProjectMRs(deps, repoName, overrides);
    await syncProjectMRs(deps, repoName, overrides);

    expect(asked).toEqual([]);
    expect(store.read(repoName)).toBeUndefined();
    expect(readSyncHealth(repoName)).toBeUndefined();
    expect(logged).toEqual([{ obj: { repo: repoName }, msg: "project sync skips GitHub repos for now" }]);
  });
});
