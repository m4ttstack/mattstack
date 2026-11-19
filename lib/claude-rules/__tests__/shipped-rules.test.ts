import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const RULES = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "rules");

describe("plugins/mattstack/rules", () => {
  const names = existsSync(RULES) ? readdirSync(RULES) : [];

  test("holds at least 16 rules, every one a .md file", () => {
    expect(names.length).toBeGreaterThanOrEqual(16);
    expect(names.filter((n) => !n.endsWith(".md"))).toEqual([]);
  });

  test("no rule names a person, a personal path or carries frontmatter", () => {
    for (const name of names) {
      const body = readFileSync(join(RULES, name), "utf8");
      expect({ name, person: /\bMatt\b/.test(body) }).toEqual({ name, person: false });
      expect({ name, operator: body.includes("the operator") }).toEqual({ name, operator: false });
      expect({ name, users: body.includes("/Users/") }).toEqual({ name, users: false });
      expect({ name, documents: body.includes("~/Documents") }).toEqual({ name, documents: false });
      expect({ name, frontmatter: body.startsWith("---") }).toEqual({ name, frontmatter: false });
    }
  });
});
