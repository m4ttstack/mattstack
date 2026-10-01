import { describe, expect, test } from "bun:test";
import { compareVersions, ENGINE_PACK_REF, findInstalledPluginDir } from "../installed-plugins.ts";

function fs(dirs: Record<string, string[]>) {
  return {
    exists: (p: string) => p in dirs || Object.keys(dirs).some((d) => d.startsWith(p + "/")),
    readDir: (p: string) => dirs[p] ?? [],
  };
}

describe("findInstalledPluginDir", () => {
  const cache = "/h/.claude/plugins/cache";
  test("picks the highest semver version dir of <marketplace>/<plugin>", () => {
    const f = fs({ [`${cache}/acme/acme-base`]: ["0.9.0", "0.10.1"], [`${cache}/acme/acme-base/0.9.0`]: [], [`${cache}/acme/acme-base/0.10.1`]: [] });
    expect(findInstalledPluginDir(f, "/h", "acme-base@acme")).toBe(`${cache}/acme/acme-base/0.10.1`);
  });
  test("null when the plugin is not in the cache", () => {
    expect(findInstalledPluginDir(fs({}), "/h", "acme-base@acme")).toBeNull();
  });
  test("refuses a ref without a marketplace", () => {
    expect(findInstalledPluginDir(fs({}), "/h", "acme-base")).toBeNull();
  });
  test("refuses an uppercase ref, as the manifest schema does", () => {
    const f = fs({ [`${cache}/Acme/Acme-Base`]: ["0.1.0"], [`${cache}/Acme/Acme-Base/0.1.0`]: [] });
    expect(findInstalledPluginDir(f, "/h", "Acme-Base@Acme")).toBeNull();
  });
  test("the engine pack ref is mattstack@mattstack", () => {
    expect(ENGINE_PACK_REF).toBe("mattstack@mattstack");
  });
});

describe("compareVersions", () => {
  test("dotted numeric compare, missing segments are 0", () => {
    expect(compareVersions("0.10.1", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});
