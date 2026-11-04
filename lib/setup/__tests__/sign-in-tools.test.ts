import { describe, expect, test } from "bun:test";
import { mergeOrgRequirements, type PackRequirements } from "../requirements.ts";
import { signInTools } from "../sign-in-tools.ts";

function pack(tools: PackRequirements["tools"]): PackRequirements {
  return { pack: "widgets", integrations: [], tools };
}

describe("signInTools", () => {
  test("pack tools with a sign-in, once each, optional ones last", () => {
    const reqs = [
      pack([
        { name: "ldcli", why: "flags", connect: { integration: "ldcli" }, optional: true },
        { name: "doppler", why: "secrets", connect: { integration: "doppler" } },
        { name: "acme-api", why: "the api", connect: { verb: ["acme-api", "login"], label: "Sign in" } },
      ]),
      pack([{ name: "doppler", why: "secrets again", connect: { integration: "doppler" }, optional: true }]),
    ];
    expect(signInTools(reqs).map((t) => t.name)).toEqual(["doppler", "acme-api", "ldcli"]);
    expect(signInTools(reqs)[0]!.why).toBe("secrets");
  });

  test("a tool with no connect is not a sign-in tool", () => {
    expect(signInTools([pack([{ name: "jq", why: "json", install: { brew: "jq" } }])])).toEqual([]);
  });

  test("a pack tool connecting StrongDM is not a sign-in tool", () => {
    const reqs = [pack([{ name: "sdm", why: "databases", connect: { integration: "sdm" } }, { name: "linear", why: "tickets", connect: { integration: "linear" } }])];
    expect(signInTools(reqs)).toEqual([]);
  });

  test("a team tool replaces an org tool of the same name through the merged entry", () => {
    const orgTool = { name: "doppler", why: "org secrets", connect: { integration: "doppler" as const } };
    const teamTool = { name: "doppler", why: "team secrets", connect: { integration: "doppler" as const } };
    const org = { pack: "org", tools: [orgTool], integrations: ["doppler" as const] };
    const tools = signInTools([mergeOrgRequirements(pack([teamTool]), "widgets", org)]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.why).toBe("team secrets");
  });
});
