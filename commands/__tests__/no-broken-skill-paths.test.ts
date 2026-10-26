import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkPack } from "../skills.ts";

const mattstackDir = mkdtempSync(join(tmpdir(), "rt-no-broken-skill-paths-"));
afterAll(() => rmSync(mattstackDir, { recursive: true, force: true }));

test("every cross-skill path in the mattstack plugin's hand-authored skills resolves", async () => {
  const payload = await checkPack({ packDir: join(import.meta.dir, "..", "..", "plugins", "mattstack"), mattstackDir });
  expect(payload.skillPaths).toEqual([]);
}, 60_000);
