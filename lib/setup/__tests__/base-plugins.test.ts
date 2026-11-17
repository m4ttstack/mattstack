import { describe, expect, test } from "bun:test";
import { BASE_PLUGINS, SUPERSEDED_PLUGINS, isSuperseded, resolveBasePlugin } from "../base-plugins.ts";

describe("base plugins", () => {
  test("the baseline installs mattstack's superpowers, not the stock copy", () => {
    expect(BASE_PLUGINS).toContain("superpowers@mattstack");
    expect(BASE_PLUGINS).not.toContain("superpowers@claude-plugins-official");
  });

  test("exactly the two stock ids are superseded, each by superpowers@mattstack", () => {
    expect(SUPERSEDED_PLUGINS).toEqual({
      "superpowers@claude-plugins-official": "superpowers@mattstack",
      "superpowers@superpowers-marketplace": "superpowers@mattstack",
    });
    expect(isSuperseded("superpowers@superpowers-marketplace")).toBe(true);
    expect(isSuperseded("superpowers@superpowers-pinned")).toBe(false);
  });

  test("an installed stock copy no longer stands in for the baseline entry", () => {
    expect(resolveBasePlugin("superpowers@mattstack", (id) => id === "superpowers@claude-plugins-official")).toBe("superpowers@mattstack");
  });
});
