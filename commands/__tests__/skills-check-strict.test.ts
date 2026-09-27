import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mcpTools } from "../../lib/mcp/tools.ts";
import { checkPack, skillsCheck } from "../skills.ts";

function makePack(manifest: Record<string, unknown>, body = "Record it with `rt runs snapshot`."): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-check-strict-")));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
  mkdirSync(join(dir, "skills", "x"), { recursive: true });
  writeFileSync(join(dir, "skills", "x", "SKILL.md"), `---\nname: x\n---\n${body}\n`);
  return dir;
}

/** Bun ignores process.exitCode = undefined once it is truthy, so 0 is the
    only value that clears it before the suite's own exit status. */
async function runCheck(args: string[]): Promise<{ exitCode: number; logs: string[] }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  process.exitCode = 0;
  try {
    await skillsCheck(args);
    return { exitCode: Number(process.exitCode ?? 0), logs };
  } finally {
    logSpy.mockRestore();
    process.exitCode = 0;
  }
}

describe("checkPack strictness", () => {
  test("a pack that does not opt in reports its hits and is not strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("\"strictLint\": true in plugin.json makes the pack strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every hit names a published tool", async () => {
    const published = new Set(mcpTools().map((t) => t.name));
    const dir = makePack({ name: "acme", version: "1.0.0" }, "Push with `git push`, then `rt chat dm x hi`, then `rt skills check`.");
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.map((h) => h.tool)).toEqual(["git_push", "chat_dm", "rt_verb"]);
      expect(payload.mcpLint.every((h) => h.tool !== null && published.has(h.tool))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pack named mattstack without the flag is not strict", async () => {
    const dir = makePack({ name: "mattstack", version: "1.0.0" });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pack named mattstack with \"strictLint\": true in plugin.json is strict", async () => {
    const dir = makePack({ name: "mattstack", version: "1.0.0", strictLint: true });
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint.length).toBe(1);
      expect(payload.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skills check --strict", () => {
  test("exits 1 on hits with --strict and 0 without, naming the policy in the summary line", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" });
    try {
      const strict = await runCheck(["--pack-dir", dir, "--strict"]);
      expect(strict.exitCode).toBe(1);
      expect(strict.logs).toContain("mcp lint: 1 hits (--strict fails on them)");

      const advisory = await runCheck(["--pack-dir", dir]);
      expect(advisory.exitCode).toBe(0);
      expect(advisory.logs).toContain("mcp lint: 1 hits (advisory; --strict fails on them)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a strictLint pack gets the strict summary line even without --strict", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const { exitCode, logs } = await runCheck(["--pack-dir", dir]);
      expect(exitCode).toBe(0);
      expect(logs).toContain("mcp lint: 1 hits (strict: --strict and rt skills sync fail on them)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a strictLint pack run with --strict names sync too", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const { exitCode, logs } = await runCheck(["--pack-dir", dir, "--strict"]);
      expect(exitCode).toBe(1);
      expect(logs).toContain("mcp lint: 1 hits (strict: --strict and rt skills sync fail on them)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--json carries mcpLint and strictLint", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true });
    try {
      const { logs } = await runCheck(["--pack-dir", dir, "--json"]);
      const parsed = JSON.parse(logs.at(-1)!) as { mcpLint: Array<{ rule: string; tool: string }>; strictLint: boolean };
      expect(parsed.mcpLint.map((h) => h.rule)).toEqual(["rt runs snapshot"]);
      expect(parsed.mcpLint[0]!.tool).toBe("run_snapshot");
      expect(parsed.strictLint).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pack script scan", () => {
  function withScript(dir: string): void {
    mkdirSync(join(dir, "skills", "x", "scripts"), { recursive: true });
    writeFileSync(join(dir, "skills", "x", "scripts", "go.sh"), "#!/bin/sh\ngit push origin HEAD\n");
  }
  test("reports script hits as scriptLint, apart from mcpLint", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" }, "No commands here.");
    withScript(dir);
    try {
      const payload = await checkPack({ packDir: dir });
      expect(payload.mcpLint).toEqual([]);
      expect(payload.scriptLint.map((h) => h.tool)).toEqual(["git_push"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("never fails --strict, even for a strictLint pack", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0", strictLint: true }, "No commands here.");
    withScript(dir);
    try {
      const { exitCode, logs } = await runCheck(["--pack-dir", dir, "--strict"]);
      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.startsWith("mcp lint (pack scripts, advisory): 1 hit"))).toBe(true);
      expect(logs).toContain("mcp lint: clean");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("--json always carries scriptLint", async () => {
    const dir = makePack({ name: "acme", version: "1.0.0" }, "No commands here.");
    try {
      const { logs } = await runCheck(["--pack-dir", dir, "--json"]);
      expect(JSON.parse(logs.at(-1)!).scriptLint).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
