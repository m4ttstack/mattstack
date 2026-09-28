import { describe, expect, test } from "bun:test";
import { RT_REPO } from "../release-app.ts";
import { RELEASE_REPO } from "../update-machine.ts";
import { RELEASES_URL } from "../../../commands/update.ts";

describe("the release code names the renamed repo", () => {
  test("every constant says m4ttstack/mattstack", () => {
    expect(RT_REPO).toBe("m4ttstack/mattstack");
    expect(RELEASE_REPO).toBe("m4ttstack/mattstack");
    expect(RELEASES_URL).toBe("https://github.com/m4ttstack/mattstack/releases/latest");
  });
});
