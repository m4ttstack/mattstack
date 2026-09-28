import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

interface Workflow {
  jobs: Record<string, { needs?: string | string[] }>;
}

const workflow = Bun.YAML.parse(
  readFileSync(join(ROOT, ".github", "workflows", "checks.yml"), "utf8"),
) as Workflow;

const plugins = readdirSync(join(ROOT, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("every plugin has its own CI job", () => {
  test("plugins/ is not empty", () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  for (const name of plugins) {
    test(`plugins/${name} has a plugin-${name} job`, () => {
      expect(Object.keys(workflow.jobs)).toContain(`plugin-${name}`);
    });

    test(`the checks gate needs plugin-${name}`, () => {
      const needs = workflow.jobs.checks?.needs ?? [];
      expect(Array.isArray(needs) ? needs : [needs]).toContain(`plugin-${name}`);
    });
  }
});
