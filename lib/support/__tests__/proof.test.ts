import { describe, expect, test } from "bun:test";
import { supportMac, verifySupportMac, type ProofInput } from "../proof.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER = Buffer.alloc(32, 2).toString("base64");

const input: ProofInput = {
  kind: "request",
  id: "r1",
  org: "git.example.com/acme/mattstack",
  from: "ada",
  to: "alex",
  sentAt: 1000,
  body: '{"text":"help"}',
};

describe("support proof", () => {
  test("a MAC verifies for the same input and fails when any one field changes", () => {
    const mac = supportMac(KEY, input);
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySupportMac([KEY], input, mac)).toBe(true);
    const changed: ProofInput[] = [
      { ...input, kind: "status" },
      { ...input, id: "r2" },
      { ...input, org: "git.example.com/other/mattstack" },
      { ...input, from: "bo" },
      { ...input, to: "bo" },
      { ...input, sentAt: 1001 },
      { ...input, body: '{"text":"help!"}' },
    ];
    for (const c of changed) expect(verifySupportMac([KEY], c, mac)).toBe(false);
  });

  test("a MAC does not depend on how field boundaries fall", () => {
    const a = supportMac(KEY, { ...input, id: "ab", org: "c" });
    const b = supportMac(KEY, { ...input, id: "a", org: "bc" });
    expect(a).not.toBe(b);
  });

  test("names are compared the way the switchboard spells them", () => {
    const mac = supportMac(KEY, { ...input, from: " Ada ", to: "ALEX" });
    expect(verifySupportMac([KEY], input, mac)).toBe(true);
  });

  test("a wrong-length or non-hex mac is false, not a throw", () => {
    for (const mac of ["", "ab", "z".repeat(64), `${supportMac(KEY, input)}00`, "é".repeat(64)])
      expect(verifySupportMac([KEY], input, mac)).toBe(false);
  });

  test("the same usernames with another org's key do not verify", () => {
    const mac = supportMac(OTHER, input);
    expect(verifySupportMac([KEY], input, mac)).toBe(false);
    expect(verifySupportMac([], input, mac)).toBe(false);
    expect(verifySupportMac([KEY, OTHER], input, mac)).toBe(true);
  });
});
