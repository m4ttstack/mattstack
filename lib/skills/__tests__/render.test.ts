import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { compilePackAll, renderPackInto } from "../../../commands/skills.ts";
import { LOCK_REL, readLock, serializeLock } from "../compiled-lock.ts";
import { inputHash } from "../render.ts";
import { seedTwoVerbPack } from "./helpers.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function filesUnder(root: string): Map<string, { bytes: string; mode: number }> {
  const files = new Map<string, { bytes: string; mode: number }>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.set(relative(root, abs), { bytes: readFileSync(abs).toString("base64"), mode: statSync(abs).mode & 0o777 });
    }
  };
  walk(root);
  return files;
}

function flagValue(flags: string[], name: string): string {
  return flags[flags.indexOf(name) + 1]!;
}

function seed() {
  const { packDir, flags } = seedTwoVerbPack(made);
  const manifest = flagValue(flags, "--manifest");
  const mattstackDir = flagValue(flags, "--mattstack-dir");
  const outRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-render-out-")));
  made.push(outRoot);
  const repoKey = basename(dirname(manifest));
  return { packDir, manifest, mattstackDir, outRoot, repoKey, manifestText: readFileSync(manifest, "utf8") };
}

describe("renderPackInto", () => {
  test("renderPackInto writes what compile writes", async () => {
    const s = seed();
    const rendered = await renderPackInto({ packDir: s.packDir, manifestText: s.manifestText, repoKey: s.repoKey, outRoot: s.outRoot, mattstackDir: s.mattstackDir });
    expect(rendered).toEqual({ ok: true, mattstack: "1.0.0" });

    const before = filesUnder(s.packDir);
    const compiled = await compilePackAll({ pack: "acme", packDir: s.packDir, manifest: s.manifest, mattstackDir: s.mattstackDir });
    expect(compiled.errors).toEqual([]);
    const after = filesUnder(s.packDir);
    const written = [...after.keys()].filter((rel) => /^(skills|attachments)\//.test(rel) && before.get(rel)?.bytes !== after.get(rel)!.bytes).sort();
    expect(written.length).toBeGreaterThan(0);

    const out = filesUnder(s.outRoot);
    expect([...out.keys()].sort()).toEqual(written);
    for (const rel of written) expect(out.get(rel)).toEqual(after.get(rel)!);
  });

  test("renderPackInto keeps the executable bit", async () => {
    const s = seed();
    const script = join(s.mattstackDir, "plugins", "mattstack", "skills", "pipeline", "alpha", "scripts", "x.sh");
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, "#!/bin/sh\necho hi\n");
    chmodSync(script, 0o755);
    const rendered = await renderPackInto({ packDir: s.packDir, manifestText: s.manifestText, repoKey: s.repoKey, outRoot: s.outRoot, mattstackDir: s.mattstackDir });
    expect(rendered.ok).toBe(true);
    expect(statSync(join(s.outRoot, "skills", "alpha", "scripts", "x.sh")).mode & 0o777).toBe(0o755);
  });

  test("renderPackInto leaves the pack untouched", async () => {
    const s = seed();
    const before = filesUnder(s.packDir);
    const rendered = await renderPackInto({ packDir: s.packDir, manifestText: s.manifestText, repoKey: s.repoKey, outRoot: s.outRoot, mattstackDir: s.mattstackDir });
    expect(rendered.ok).toBe(true);
    expect(filesUnder(s.packDir)).toEqual(before);
  });
});

describe("inputHash", () => {
  test("inputHash changes when a fill changes and not when the lock changes", async () => {
    const s = seed();
    await compilePackAll({ pack: "acme", packDir: s.packDir, manifest: s.manifest, mattstackDir: s.mattstackDir });
    const first = inputHash(s.packDir, null, s.manifestText);

    writeFileSync(join(s.packDir, LOCK_REL), serializeLock({ ...readLock(s.packDir), builtWith: "9.9.9", bases: { other: "1.0.0" } }));
    expect(inputHash(s.packDir, null, s.manifestText)).toBe(first);

    const compiledBody = join(s.packDir, "skills", "alpha", "SKILL.md");
    writeFileSync(compiledBody, readFileSync(compiledBody, "utf8") + "\nedited output\n");
    expect(inputHash(s.packDir, null, s.manifestText)).toBe(first);

    const fill = join(s.packDir, "attachments", "policy", "SKILL.md");
    writeFileSync(fill, readFileSync(fill, "utf8") + "\nOne more rule.\n");
    expect(inputHash(s.packDir, null, s.manifestText)).not.toBe(first);
  });

  test("inputHash changes with the bindings and the base pack's sources", () => {
    const s = seed();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "rt-render-base-")));
    made.push(base);
    mkdirSync(join(base, "attachments", "rule"), { recursive: true });
    writeFileSync(join(base, "attachments", "rule", "SKILL.md"), "a\n");
    const first = inputHash(s.packDir, base, s.manifestText);
    expect(inputHash(s.packDir, base, s.manifestText + " ")).not.toBe(first);
    writeFileSync(join(base, "attachments", "rule", "SKILL.md"), "b\n");
    expect(inputHash(s.packDir, base, s.manifestText)).not.toBe(first);
  });
});
