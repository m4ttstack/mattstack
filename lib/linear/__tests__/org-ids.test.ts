import { describe, expect, test } from "bun:test";
import { orgIdContext, findOrgIds } from "../org-ids.ts";

const ctx = { forgeHost: "gitlab.example.com", teamKeys: ["ACME", "ABC"] };

describe("findOrgIds", () => {
  test("a !digits MR ref is refused", () => {
    expect(findOrgIds(["see !1234 for it"], ctx).ok).toBe(false);
  });
  test("a URL on the forge host is refused", () => {
    expect(findOrgIds(["https://gitlab.example.com/g/p/-/issues/1"], ctx).ok).toBe(false);
  });
  test("a ticket id with a directory key is refused, case-sensitive key match on a word boundary", () => {
    expect(findOrgIds(["fix ACME-1234 now"], ctx).ok).toBe(false);
    expect(findOrgIds(["acme-1234"], ctx).ok).toBe(true);
    expect(findOrgIds(["XACME-1234"], ctx).ok).toBe(true);
  });
  test("RT-123 and SUPPORT-4 pass when RT and SUPPORT are not directory keys", () => {
    expect(findOrgIds(["RT-123 and SUPPORT-4"], ctx)).toEqual({ ok: true });
  });
  test("a null forgeHost or teamKeys fails closed with a reason naming the missing setting", () => {
    const a = findOrgIds(["hello"], { forgeHost: null, teamKeys: ["ACME"] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toContain("mattstack.integrations");
    const b = findOrgIds(["hello"], { forgeHost: "x.test", teamKeys: null });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toContain("mattstack.directory");
  });
  test("empty teamKeys or an empty forgeHost fails closed", () => {
    const a = findOrgIds(["hello"], { forgeHost: "x.test", teamKeys: [] });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toContain("mattstack.directory");
    expect(findOrgIds(["hello"], { forgeHost: "", teamKeys: ["ACME"] }).ok).toBe(false);
  });
  test("orgIdContext reads keys, skips null entries, and returns null for an empty directory", () => {
    const reader = (integrations: unknown, directory: unknown) =>
      (<T>(key: string) => ({ value: (key === "mattstack.integrations" ? integrations : directory) as T })) as Parameters<typeof orgIdContext>[0];
    expect(orgIdContext(reader({ forge: { host: "g.test" } }, { teams: { a: { linear: { team: "ACME" } }, b: null, c: {} } }))).toEqual({
      forgeHost: "g.test",
      teamKeys: ["ACME"],
    });
    expect(orgIdContext(reader({ forge: { host: "g.test" } }, { teams: {} }))).toEqual({ forgeHost: "g.test", teamKeys: null });
    expect(orgIdContext(reader(undefined, undefined))).toEqual({ forgeHost: null, teamKeys: null });
  });
  test("an exclamation mark in prose (`works!`) passes", () => {
    expect(findOrgIds(["it works! really! 100"], ctx)).toEqual({ ok: true });
  });
});
