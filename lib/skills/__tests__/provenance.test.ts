import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gitFacts, maskProvenance, mattstackProvenance } from "../provenance.ts";

describe("maskProvenance", () => {
  test("deletes marker versions and masks the compiled value and baked provenance flags", () => {
    const body = [
      "---", 'name: "work"', "metadata:", '  compiled: "mattstack@0.10.3 + acme:plan-policy@0.5.2"', "---",
      "<!-- part: step source=mattstack:work version=0.10.3 path=attachments/pipeline/work/SKILL.md lines=13-98 -->",
      '  "feature": "--repo r --work-type feature --pipeline feature --mattstack-sha 0.10.3 --mattstack-dirty 0 --pack-sha acme=abc1234"',
      "<!-- part: slot:domain binding=acme:plan-policy version=0.5.2 path=attachments/plan-policy/SKILL.md lines=9-84 -->",
    ].join("\n");
    const masked = maskProvenance(body);
    expect(masked).not.toContain("0.10.3");
    expect(masked).not.toContain("0.5.2");
    expect(masked).not.toContain("abc1234");
    expect(masked).toContain("source=mattstack:work path=attachments/pipeline/work/SKILL.md");
    expect(masked).toContain("compiled: *");
    expect(masked).toContain("--mattstack-sha * --mattstack-dirty 0 --pack-sha *");
  });
  test("leaves a body without provenance tokens unchanged", () => {
    expect(maskProvenance("plain text\n--mattstack-dirty 0")).toBe("plain text\n--mattstack-dirty 0");
  });
});

describe("mattstackProvenance", () => {
  const plugin = { dir: "/plugins/mattstack", version: "1.2.0" };

  test("no declared pipelines: no git subprocess, the plugin version stands in", () => {
    let calls = 0;
    const facts = () => {
      calls++;
      return { sha: "abc1234", dirty: 1 as const };
    };

    expect(mattstackProvenance({}, plugin, facts)).toEqual({ sha: "1.2.0", dirty: 0 });
    expect(calls).toBe(0);
  });

  test("declared pipelines: the git facts are what get baked", () => {
    let calls = 0;
    const facts = () => {
      calls++;
      return { sha: "abc1234", dirty: 1 as const };
    };

    expect(mattstackProvenance({ feature: ["mattstack:stage-plan"] }, plugin, facts)).toEqual({ sha: "abc1234", dirty: 1 });
    expect(calls).toBe(1);
  });

  test("a non-git plugin dir degrades to its version, not an empty sha", () => {
    const facts = () => ({ sha: "", dirty: 0 as const });
    expect(mattstackProvenance({ feature: [] }, plugin, facts)).toEqual({ sha: "1.2.0", dirty: 0 });
  });
});

describe("gitFacts", () => {
  function repoWithPlugin(): { root: string; plugin: string } {
    const root = mkdtempSync(join(tmpdir(), "rt-provenance-git-"));
    const plugin = join(root, "plugins", "mattstack");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "a.md"), "a\n");
    writeFileSync(join(root, "top.md"), "top\n");
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    return { root, plugin };
  }

  test("an in-tree dir ignores dirt elsewhere in its checkout", () => {
    const { root, plugin } = repoWithPlugin();
    writeFileSync(join(root, "top.md"), "changed\n");
    writeFileSync(join(root, "untracked.md"), "x\n");
    expect(gitFacts(plugin).dirty).toBe(0);
  });

  test("an in-tree dir reports its own dirt", () => {
    const { plugin } = repoWithPlugin();
    writeFileSync(join(plugin, "a.md"), "changed\n");
    const facts = gitFacts(plugin);
    expect(facts.dirty).toBe(1);
    expect(facts.sha).toMatch(/^[0-9a-f]{4,}$/);
  });
});
