import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { claudeRulesDir } from "../../claude-rules/paths.ts";
import type { ApplyContext } from "../apply.ts";
import { createRealProbes, type Probes } from "../probes.ts";
import { claudeRulesStep } from "../steps/claude-rules.ts";

let home: string;
let p: Probes;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "claude-rules-step-")));
  p = { ...createRealProbes(), home, env: { HOME: home } };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function ctxFor(probes: Probes): ApplyContext {
  return { p: probes, log: () => {}, emit: () => {} } as unknown as ApplyContext;
}

describe("claude.rules", () => {
  test("is update-safe and always applies", () => {
    expect(claudeRulesStep.id).toBe("claude.rules");
    expect(claudeRulesStep.title).toBe("Link the shared Claude rules");
    expect(claudeRulesStep.kind).toBe("rt");
    expect(claudeRulesStep.updateSafe).toBe(true);
  });

  test("a fresh Mac links mattstack's rules and reports done", async () => {
    const loc = join(home, ".claude", "plugins", "marketplaces", "mattstack");
    mkdirSync(join(loc, "plugins", "mattstack", "rules"), { recursive: true });
    writeFileSync(join(home, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify({ mattstack: { installLocation: loc } }));

    const outcome = await claudeRulesStep.run(ctxFor(p));

    expect(outcome).toEqual({ state: "done", detail: "Linked mattstack's rules into 1 Claude folder" });
    expect(readlinkSync(join(home, ".claude", "rules", "mattstack"))).toBe(claudeRulesDir(home));
  });

  test("a reconcile that throws is a failed outcome", async () => {
    const broken: Probes = { ...p, mkdirp: () => { throw new Error("disk full"); } };
    expect(await claudeRulesStep.run(ctxFor(broken))).toEqual({ state: "failed", detail: "disk full" });
  });
});
