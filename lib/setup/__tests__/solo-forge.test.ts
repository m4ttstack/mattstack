import { describe, expect, test } from "bun:test";
import { soloForgeOverrides } from "../solo-forge.ts";

describe("soloForgeOverrides", () => {
  test("drops a leftover github.com host on solo", () => {
    expect("forgeHost" in soloForgeOverrides({ forgeHost: "github.com" }, true)).toBe(false);
  });
  test("drops it case-insensitively", () => {
    expect("forgeHost" in soloForgeOverrides({ forgeHost: "GitHub.com" }, true)).toBe(false);
  });
  test("keeps a self-hosted GitLab host on solo", () => {
    expect(soloForgeOverrides({ forgeHost: "gitlab.example.com" }, true)).toEqual({ forgeHost: "gitlab.example.com" });
  });
  test("keeps every host on a team Mac", () => {
    expect(soloForgeOverrides({ forgeHost: "github.com" }, false)).toEqual({ forgeHost: "github.com" });
  });
  test("does not change the overrides it was given", () => {
    const input = { forgeHost: "github.com" };
    soloForgeOverrides(input, true);
    expect(input.forgeHost).toBe("github.com");
  });
});
