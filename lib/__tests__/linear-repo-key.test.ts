import { describe, expect, test } from "bun:test";
import { repoLinearKey } from "../linear.ts";

const secrets: Record<string, string> = { "linearApiKey.mattstack": "lin_personal" };
const readValue = async (name: string) => secrets[name] ?? null;

describe("repoLinearKey", () => {
  test("returns the secret the repo's rt.linearKey names", async () => {
    const key = await repoLinearKey("github.com/m4ttstack/mattstack", { readName: () => "linearApiKey.mattstack", readValue });
    expect(key).toBe("lin_personal");
  });

  test("the default name keeps linearApiKey, without reading a secret", async () => {
    let read = false;
    const key = await repoLinearKey("gitlab.example.com/acme/web", {
      readName: () => "linearApiKey",
      readValue: async () => { read = true; return "x"; },
    });
    expect(key).toBeNull();
    expect(read).toBe(false);
  });

  test("no repo, or a named secret that is missing, keeps linearApiKey", async () => {
    expect(await repoLinearKey(null, { readName: () => "linearApiKey.mattstack", readValue })).toBeNull();
    expect(await repoLinearKey("github.com/o/r", { readName: () => "linearApiKey.gone", readValue })).toBeNull();
  });
});
