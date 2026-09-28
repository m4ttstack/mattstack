import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsExpand } from "../skills-expand.ts";
import { runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";

let root: string;
let logs: string[];
let logSpy: ReturnType<typeof spyOn>;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-expand-cli-"));
  write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.2.3" }));
  write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), "---\nname: note\ndescription: n\n---\n\nShared.\n");
  write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\n{{include:note}}\n");
  logs = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

const base = () => ["--src", join(root, "src"), "--out", join(root, "out"), "--mattstack-dir", root];

describe("rt skills expand", () => {
  test("writes the output and reports each skill", async () => {
    await skillsExpand(base());
    expect(readFileSync(join(root, "out", "a", "SKILL.md"), "utf8")).toContain("Shared.");
    expect(logs.join("\n")).toContain("+ a");
  });

  test("--check is clean after expand and exits 1 naming the drift after an edit", async () => {
    await skillsExpand(base());
    const clean = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(clean.exitCode).toBeUndefined();
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nNew line.\n\n{{include:note}}\n");
    const drifted = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(drifted.exitCode).toBe(1);
    expect(drifted.errors.join("\n")).toContain("a: source");
  });

  test("--check --json prints the drift envelope", async () => {
    await skillsExpand(base());
    rmSync(join(root, "out", "a"), { recursive: true });
    await runExpectingCleanExit(() => skillsExpand([...base(), "--check", "--json"]));
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed).toMatchObject({ ok: false, mode: "check", drift: [{ skill: "a", causes: ["missing"] }] });
  });

  test("--dry-run writes nothing", async () => {
    await skillsExpand([...base(), "--dry-run"]);
    expect(existsSync(join(root, "out"))).toBe(false);
    expect(logs.join("\n")).toContain("+ a");
  });

  test("a missing --src or --out is a usage error", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--src", join(root, "src")]));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("--out");
  });

  test("--mattstack-dir with no value is a usage error", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--src", join(root, "src"), "--out", join(root, "out"), "--mattstack-dir"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("--mattstack-dir needs a value");
  });

  test("--strict fails on a shell form in the expanded output, dry run included", async () => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`.\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--dry-run", "--json"]));
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed.ok).toBe(false);
    expect(parsed.lint).toHaveLength(1);
    expect(parsed.lint[0]).toContain(join(root, "out", "a", "SKILL.md"));
    expect(parsed.lint[0]).toContain("glab mr note");
  });

  test("--strict fails on a shell form in a vendored markdown file", async () => {
    write(join(root, "src", "a", "stage.md"), "# Stage\n\nPost with `glab mr note 3 -m hi`.\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--json"]));
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed.ok).toBe(false);
    expect(parsed.lint).toHaveLength(1);
    expect(parsed.lint[0]).toContain(`${join(root, "out", "a", "stage.md")}:3`);
  });

  test("--strict honours the allow marker", async () => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`. <!-- mcp-lint: allow -->\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--json"]));
    expect(r.exitCode).toBeUndefined();
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ ok: true, lint: [] });
  });

  test("--strict reports script hits as advisory without failing", async () => {
    write(join(root, "src", "a", "scripts", "post.sh"), "glab mr note 3 -m hi\n");
    await skillsExpand(base());
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check", "--strict", "--json"]));
    expect(r.exitCode).toBeUndefined();
    expect(r.errors.join("\n")).toContain(`(advisory) ${join(root, "out", "a", "scripts", "post.sh")}:1`);
    expect(JSON.parse(logs.at(-1)!).lint).toEqual([]);
  });

  test("an expand error exits 1 with the file named", async () => {
    write(join(root, "src", "b", "SKILL.md"), "---\nname: app:b\ndescription: b\n---\n\n{{include:nope}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand(base()));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain('include "nope"');
  });
});
