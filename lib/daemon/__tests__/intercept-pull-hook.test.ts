import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath } from "../../rt-paths.ts";
import { closeStateDb, getKvValue, setKvValue } from "../../state/index.ts";
import { installShims, renderInterceptShim, shimPath, type InterceptRule } from "../../endpoint/shim.ts";
import { createInterceptPullHook } from "../intercept-pull-hook.ts";

function fakeLog() {
  const calls = { debug: [] as unknown[][], info: [] as unknown[][], warn: [] as unknown[][] };
  return {
    calls,
    debug: (...a: unknown[]) => { calls.debug.push(a); },
    info: (...a: unknown[]) => { calls.info.push(a); },
    warn: (...a: unknown[]) => { calls.warn.push(a); },
  };
}

const RULE: InterceptRule = {
  command: "fakecmd-pull",
  repo: "remote:x%2Facme%2Fwidgets",
  repoRemote: "git@x:acme/widgets.git",
  matches: [{ cwdGlob: ".", role: "x" }],
};

function spyInstall() {
  return mock(async () => ({ installed: [RULE.command], current: [], skipped: [], rules: 1 }));
}

describe("createInterceptPullHook", () => {
  test("reinstalls when the pulled rules differ from the cached ones, and logs the commands at info", async () => {
    const install = spyInstall();
    const log = fakeLog();
    const hook = createInterceptPullHook({ log, loadInterceptRules: () => [], buildInterceptRules: async () => [RULE], installShims: install });

    await hook("acme");

    expect(install).toHaveBeenCalledTimes(1);
    expect(log.calls.info).toHaveLength(1);
    expect((log.calls.info[0]![0] as { installed: string[]; team: string })).toMatchObject({ installed: [RULE.command], team: "acme" });
  });

  test("reinstalls when a rule's matches change", async () => {
    const install = spyInstall();
    const changed = { ...RULE, matches: [{ cwdGlob: "apps/**", role: "x" }] };
    const hook = createInterceptPullHook({ log: fakeLog(), loadInterceptRules: () => [RULE], buildInterceptRules: async () => [changed], installShims: install });

    await hook("acme");

    expect(install).toHaveBeenCalledTimes(1);
  });

  test("does nothing when the rules are unchanged, whatever their order", async () => {
    const other = { ...RULE, command: "fakecmd-other" };
    const install = spyInstall();
    const log = fakeLog();
    const hook = createInterceptPullHook({ log, loadInterceptRules: () => [RULE, other], buildInterceptRules: async () => [other, RULE], installShims: install });

    await hook("acme");

    expect(install).not.toHaveBeenCalled();
    expect(log.calls.info).toHaveLength(0);
  });

  test("does nothing when no intercepts are declared", async () => {
    const install = spyInstall();
    const hook = createInterceptPullHook({ log: fakeLog(), loadInterceptRules: () => [], buildInterceptRules: async () => [], installShims: install });

    await hook("acme");

    expect(install).not.toHaveBeenCalled();
  });

  test("an installShims throw is logged at warn with err and never escapes", async () => {
    const boom = new Error("disk full");
    const log = fakeLog();
    const hook = createInterceptPullHook({ log, loadInterceptRules: () => [], buildInterceptRules: async () => [RULE], installShims: async () => { throw boom; } });

    await hook("acme");

    expect(log.calls.warn).toHaveLength(1);
    expect((log.calls.warn[0]![0] as { err: unknown }).err).toBe(boom);
  });

  describe("against the real installer (temp HOME)", () => {
    const origHome = process.env.HOME;
    let home: string;

    beforeEach(() => {
      home = realpathSync(mkdtempSync(join(tmpdir(), "rt-intercept-pull-")));
      process.env.HOME = home;
      closeStateDb();
      const dir = mkdtempSync(join(home, "repo-"));
      execSync("git init -q", { cwd: dir });
      execSync("git remote add origin git@x:acme/widgets.git", { cwd: dir });
      setKvValue("repo-index", "widgets", dir);
    });

    afterEach(() => {
      process.env.HOME = origHome;
      closeStateDb();
      rmSync(home, { recursive: true, force: true });
    });

    function declare(commands: string[]): void {
      mkdirSync(dirname(teamSettingsPath("acme")), { recursive: true });
      writeFileSync(teamSettingsPath("acme"), JSON.stringify({
        repos: { "x/acme/widgets": { "rt.intercepts": commands.map((command) => ({ command, matches: RULE.matches })) } },
      }));
    }

    test("a pull that adds an intercept installs its shim; a pull that changes nothing rewrites nothing", async () => {
      declare([]);
      await installShims();
      declare([RULE.command]);

      await createInterceptPullHook({ log: fakeLog() })("acme");

      const path = shimPath(RULE.command);
      expect(readFileSync(path, "utf8")).toBe(renderInterceptShim(RULE.command));
      const shimMtime = statSync(path).mtimeMs;
      const generatedAt = getKvValue<{ generatedAt: number } | null>("intercepts", "rules", null)?.generatedAt;

      const install = mock(installShims);
      await createInterceptPullHook({ log: fakeLog(), installShims: install })("acme");

      expect(install).not.toHaveBeenCalled();
      expect(statSync(path).mtimeMs).toBe(shimMtime);
      expect(getKvValue<{ generatedAt: number } | null>("intercepts", "rules", null)?.generatedAt).toBe(generatedAt);
    });

    test("an occupied slot is left alone", async () => {
      declare([]);
      await installShims();
      declare([RULE.command]);
      const theirs = "#!/bin/sh\necho my own wrapper\n";
      mkdirSync(dirname(shimPath(RULE.command)), { recursive: true });
      writeFileSync(shimPath(RULE.command), theirs);
      const log = fakeLog();

      await createInterceptPullHook({ log })("acme");

      expect(readFileSync(shimPath(RULE.command), "utf8")).toBe(theirs);
      expect((log.calls.info[0]![0] as { skipped: string[] }).skipped).toEqual([RULE.command]);
    });
  });
});
