import { describe, expect, test } from "bun:test";
import { legacyManifestPath, manifestPack, manifestRepoKey, packManifestPath } from "../manifest-paths.ts";

describe("manifest paths", () => {
  test("packManifestPath places the file under repos/<slug>/packs/<pack>", () => {
    expect(packManifestPath("/h/.mattstack", "gitlab.example.com-acme-widgets", "widgets"))
      .toBe("/h/.mattstack/repos/gitlab.example.com-acme-widgets/packs/widgets/skills.jsonc");
  });
  test("legacyManifestPath is the retired per-repo file", () => {
    expect(legacyManifestPath("/h/.mattstack", "s")).toBe("/h/.mattstack/repos/s/skills.jsonc");
  });
  test("manifestRepoKey reads the slug from both shapes", () => {
    expect(manifestRepoKey("/h/.mattstack/repos/slug-a/packs/widgets/skills.jsonc")).toBe("slug-a");
    expect(manifestRepoKey("/tmp/x/skills.jsonc")).toBe("x");
  });
  test("manifestPack is the pack dir for the per-pack shape and null otherwise", () => {
    expect(manifestPack("/h/.mattstack/repos/slug-a/packs/widgets/skills.jsonc")).toBe("widgets");
    expect(manifestPack("/tmp/x/skills.jsonc")).toBeNull();
  });
});
