import { describe, expect, test } from "bun:test";
import {
  compilePatterns,
  INFRA_DEFAULTS,
  mergeConfig,
  REAL_DEFAULTS,
  settingsConfig,
  type TriageConfig,
} from "../triage-config.ts";

const base: TriageConfig = {
  realPatterns: ["A", "B"],
  infraPatterns: [],
  noisyJobs: ["lint"],
  baseDepth: 3,
  baseRef: null,
  skipBase: false,
};

function merged(inline: Record<string, unknown> | undefined): TriageConfig {
  const out = mergeConfig(base, inline);
  if ("error" in out) throw new Error(out.error);
  return out;
}

describe("defaults", () => {
  test("list sizes match the shell script", () => {
    expect(REAL_DEFAULTS).toHaveLength(13);
    expect(INFRA_DEFAULTS).toHaveLength(14);
  });
});

describe("mergeConfig", () => {
  test("concatenates arrays base first and drops duplicates", () => {
    const out = merged({ "real-patterns": ["B", "C"], "noisy-jobs": ["lint", "e2e"] });
    expect(out.realPatterns).toEqual(["A", "B", "C"]);
    expect(out.noisyJobs).toEqual(["lint", "e2e"]);
  });

  test("inline scalars win over base", () => {
    const out = merged({ "base-depth": 2, "base-ref": "develop", "skip-base": true });
    expect(out.baseDepth).toBe(2);
    expect(out.baseRef).toBe("develop");
    expect(out.skipBase).toBe(true);
  });

  test("undefined inline returns the base unchanged", () => {
    expect(merged(undefined)).toEqual(base);
  });

  test("a string base-depth errors naming the key", () => {
    const out = mergeConfig(base, { "base-depth": "2" });
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("base-depth");
  });

  test.each([0, 21, 2.5])("base-depth %p is out of range", (n) => {
    const out = mergeConfig(base, { "base-depth": n });
    expect((out as { error: string }).error).toContain("base-depth");
  });

  test("a non-string array element errors naming the key", () => {
    const out = mergeConfig(base, { "infra-patterns": ["ok", 3] });
    expect((out as { error: string }).error).toContain("infra-patterns");
  });

  test("a wrong-typed skip-base errors naming the key", () => {
    const out = mergeConfig(base, { "skip-base": "yes" });
    expect((out as { error: string }).error).toContain("skip-base");
  });

  test("unknown keys are ignored", () => {
    expect(merged({ description: "x", timeout: 2700 })).toEqual(base);
  });
});

describe("compilePatterns", () => {
  test("real is defaults plus config; infra adds config then forge", () => {
    const out = compilePatterns(
      { ...base, realPatterns: ["extra-real"], infraPatterns: ["extra-infra"] },
      ["forge-infra"],
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.real).toHaveLength(REAL_DEFAULTS.length + 1);
    expect(out.infra).toHaveLength(INFRA_DEFAULTS.length + 2);
    expect(out.infra.at(-1)?.source).toBe("forge-infra");
    expect(out.real.every((r) => r.flags === "")).toBe(true);
  });

  test("every default compiles and matches its own text", () => {
    const out = compilePatterns(base, []);
    if ("error" in out) throw new Error(out.error);
    expect(out.real.some((r) => r.test("Tests: 1 failed"))).toBe(true);
    expect(out.infra.some((r) => r.test("dial tcp 10.0.0.1:443: connection refused"))).toBe(true);
  });

  test("a POSIX bracket class errors naming the pattern", () => {
    const out = compilePatterns({ ...base, realPatterns: ["[[:digit:]]+"] }, []);
    expect((out as { error: string }).error).toContain("[[:digit:]]+");
  });

  test("a pattern that does not compile errors naming the pattern", () => {
    const out = compilePatterns({ ...base, infraPatterns: ["("] }, []);
    expect((out as { error: string }).error).toContain("pattern (");
  });

  test("a bad forge pattern errors too", () => {
    const out = compilePatterns(base, ["["]);
    expect((out as { error: string }).error).toContain("pattern [");
  });
});

describe("settingsConfig", () => {
  const defaultFor = (k: string): unknown =>
    ({
      "ci.triage.realPatterns": [],
      "ci.triage.infraPatterns": [],
      "ci.triage.noisyJobs": [],
      "ci.triage.baseDepth": 3,
      "ci.triage.baseRef": undefined,
      "ci.triage.skipBase": false,
    })[k];

  test("reads the six ci.triage keys", () => {
    const cfg = settingsConfig(
      (k) => ({ "ci.triage.realPatterns": ["X"] } as Record<string, unknown>)[k] ?? defaultFor(k),
    );
    expect(cfg).toEqual({
      realPatterns: ["X"],
      infraPatterns: [],
      noisyJobs: [],
      baseDepth: 3,
      baseRef: null,
      skipBase: false,
    });
  });

  test("passes through scalar overrides", () => {
    const cfg = settingsConfig(
      (k) =>
        ({ "ci.triage.baseDepth": 5, "ci.triage.baseRef": "develop", "ci.triage.skipBase": true } as Record<
          string,
          unknown
        >)[k] ?? defaultFor(k),
    ) as TriageConfig;
    expect(cfg.baseDepth).toBe(5);
    expect(cfg.baseRef).toBe("develop");
    expect(cfg.skipBase).toBe(true);
  });

  test.each([
    ["ci.triage.baseDepth", 0, "setting ci.triage.baseDepth must be an integer from 1 to 20"],
    ["ci.triage.baseDepth", 25.5, "setting ci.triage.baseDepth must be an integer from 1 to 20"],
    ["ci.triage.baseDepth", 500, "setting ci.triage.baseDepth must be an integer from 1 to 20"],
    ["ci.triage.baseDepth", "3", "setting ci.triage.baseDepth must be an integer from 1 to 20"],
    ["ci.triage.baseRef", "", "setting ci.triage.baseRef must be a non-empty string or unset"],
    ["ci.triage.baseRef", 7, "setting ci.triage.baseRef must be a non-empty string or unset"],
    ["ci.triage.skipBase", "yes", "setting ci.triage.skipBase must be a boolean"],
  ])("%s set to %p is an error naming the key", (key, value, error) => {
    expect(settingsConfig((k) => (k === key ? value : defaultFor(k)))).toEqual({ error });
  });

  test("baseDepth at 1 and 20 is accepted", () => {
    for (const d of [1, 20]) {
      const cfg = settingsConfig((k) => (k === "ci.triage.baseDepth" ? d : defaultFor(k)));
      expect((cfg as { baseDepth: number }).baseDepth).toBe(d);
    }
  });
});
