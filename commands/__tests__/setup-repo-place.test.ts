import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setupRepoPlace, type RepoPlaceDeps } from "../setup.ts";
import { gitRepo, realFsProbes } from "../../lib/setup/__tests__/fakes.ts";
import { markDeferred, readPlacements, writePlacement } from "../../lib/setup/repo-placement.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

const WIDGETS = "gitlab.com/acme/widgets";
const GITLAB_API = "gitlab.com/a/api";
const GITHUB_API = "github.com/b/api";

let cap: CapturedOut;
let home: string;
beforeEach(() => {
  cap = capturePlain();
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-place-verb-")));
});
afterEach(() => {
  cap.restore();
  rmSync(home, { recursive: true, force: true });
});

function neverCalled(name: string) {
  return async (): Promise<unknown> => {
    throw new Error(`unexpected call: ${name}`);
  };
}

function baseDeps(overrides: Partial<RepoPlaceDeps> = {}): RepoPlaceDeps & { lines: unknown[]; exitCodes: number[] } {
  const lines: unknown[] = [];
  const exitCodes: number[] = [];
  return {
    probes: realFsProbes(home),
    json: (v) => lines.push(v),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    stdin: neverCalled("stdin"),
    tracked: () => [WIDGETS, GITLAB_API, GITHUB_API],
    repoRoots: () => [],
    lines,
    exitCodes,
    ...overrides,
  };
}

async function expectExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    throw new Error("expected exit sentinel, function returned normally");
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "exit sentinel") throw err;
  }
}

describe("rt setup repo place", () => {
  test("--checkout records the checkout and prints the envelope", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    const deps = baseDeps();

    await setupRepoPlace([WIDGETS, "--checkout", "~/code/widgets/", "--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    expect(readPlacements(deps.probes).placements).toEqual({ [WIDGETS]: { mode: "checkout", path } });
    expect(deps.lines).toEqual([{ contract: 1, at: expect.any(String), identity: WIDGETS, mode: "checkout", path }]);
  });

  test("--clone-to records the destination", async () => {
    const path = join(home, "code", "widgets");
    const deps = baseDeps();

    await setupRepoPlace([WIDGETS, "--clone-to", path], {}, deps);

    expect(readPlacements(deps.probes).placements).toEqual({ [WIDGETS]: { mode: "clone", path } });
    expect(cap.stdout()).toContain(path);
  });

  test("the stdin form answers like the flags", async () => {
    const path = join(home, "code", "widgets");
    const deps = baseDeps({ stdin: async () => ({ identity: WIDGETS, mode: "clone", path }) });

    await setupRepoPlace(["--json"], {}, deps);

    expect(readPlacements(deps.probes).placements).toEqual({ [WIDGETS]: { mode: "clone", path } });
  });

  test("a folder that is not the repo exits 2 with the check's words and records nothing", async () => {
    mkdirSync(join(home, "foo"), { recursive: true });
    const deps = baseDeps();

    await expectExit(() => setupRepoPlace([WIDGETS, "--checkout", join(home, "foo"), "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect((deps.lines[0] as { error: { message: string } }).error.message).toBe("~/foo isn't a git checkout.");
    expect(readPlacements(deps.probes).placements).toEqual({});
  });

  test("a non-empty clone destination is refused", async () => {
    const path = join(home, "code", "widgets");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "notes.txt"), "");
    const deps = baseDeps();

    await expectExit(() => setupRepoPlace([WIDGETS, "--clone-to", path, "--json"], {}, deps));

    expect((deps.lines[0] as { error: { message: string } }).error.message).toBe("~/code/widgets already exists. Choose an empty or new folder.");
  });

  test("two repos named api: the second cannot take the first's default destination", async () => {
    mkdirSync(join(home, "code"), { recursive: true });
    const deps = baseDeps({ repoRoots: () => [join(home, "code")] });

    await expectExit(() => setupRepoPlace([GITHUB_API, "--clone-to", "~/code/api", "--json"], {}, deps));

    expect((deps.lines[0] as { error: { message: string } }).error.message).toBe("~/code/api is where api goes. Choose another folder.");
  });

  test("the destination another repo recorded is refused", async () => {
    const deps = baseDeps();
    writePlacement(deps.probes, GITLAB_API, { mode: "clone", path: join(home, "work", "api") });

    await expectExit(() => setupRepoPlace([GITHUB_API, "--clone-to", "~/work/api", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });

  test("answering a deferred repo leaves the deferral for repos.clone to clear", async () => {
    const deps = baseDeps();
    markDeferred(deps.probes, WIDGETS);

    await setupRepoPlace([WIDGETS, "--clone-to", join(home, "code", "widgets"), "--json"], {}, deps);

    expect(readPlacements(deps.probes).deferred).toEqual([WIDGETS]);
  });

  test("no identity at a terminal is a usage error that never reads stdin", async () => {
    const deps = baseDeps({ isTTY: () => true });

    await expectExit(() => setupRepoPlace([], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });

  test("both or neither of --checkout and --clone-to is a usage error", async () => {
    const deps = baseDeps();
    await expectExit(() => setupRepoPlace([WIDGETS, "--json"], {}, deps));
    await expectExit(() => setupRepoPlace([WIDGETS, "--checkout", "/a", "--clone-to", "/b", "--json"], {}, deps));
    expect(deps.exitCodes).toEqual([2, 2]);
  });
});
