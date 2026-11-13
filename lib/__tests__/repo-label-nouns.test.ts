import { describe, expect, test } from "bun:test";
import { changeNoun, forgeChangeNoun } from "../repo-label.ts";

describe("what each forge calls a change", () => {
  test("GitHub says PR and pull request", () => {
    expect(forgeChangeNoun("github")).toBe("PR");
    expect(forgeChangeNoun("github", "long")).toBe("pull request");
  });

  test("GitLab, and a forge rt cannot name, say MR and merge request", () => {
    expect(forgeChangeNoun("gitlab")).toBe("MR");
    expect(forgeChangeNoun("gitlab", "long")).toBe("merge request");
    expect(forgeChangeNoun(null)).toBe("MR");
  });

  test("a repo identity picks its forge from the host", () => {
    expect(changeNoun("remote:github.com%2Fo%2Fr")).toBe("PR");
    expect(changeNoun("remote:gitlab.com%2Fo%2Fr")).toBe("MR");
  });
});
