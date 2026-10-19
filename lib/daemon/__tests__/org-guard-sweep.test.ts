import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { DataBranchCheck, MainCheck } from "../../team/data-branch-guard.ts";
import { createOrgGuardSweep } from "../org-guard-sweep.ts";

function harness(opts: { data: DataBranchCheck[]; main?: MainCheck[]; admin?: boolean }) {
  const warns: { obj: Record<string, unknown>; msg: string }[] = [];
  const infos: string[] = [];
  const data = [...opts.data];
  const main = [...(opts.main ?? [])];
  const mainAsked: string[] = [];
  const sweep = createOrgGuardSweep({
    probes: fakeProbes({ home: "/h" }),
    slugs: () => ["acme"],
    isAdmin: () => opts.admin ?? false,
    checkData: async () => data.shift() ?? null,
    checkMain: async (_p, slug) => { mainAsked.push(slug); return main.shift() ?? null; },
    log: { warn: (obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }, info: (_obj: Record<string, unknown>, msg: string) => { infos.push(msg); } } as never,
  });
  return { sweep, warns, infos, mainAsked };
}

const gone: DataBranchCheck = { kind: "gone", branch: "mattstack", local: "a".repeat(40) };
const present: DataBranchCheck = { kind: "present", branch: "mattstack", sha: "a".repeat(40) };

describe("org guard sweep", () => {
  test("a data branch gone from origin is logged once, and again only after it came back and went", async () => {
    const h = harness({ data: [gone, gone, present, gone] });
    for (let i = 0; i < 4; i++) await h.sweep();
    expect(h.warns.map((w) => w.msg)).toEqual(["The org's data branch is gone from the forge, and your copy still has it", "The org's data branch is gone from the forge, and your copy still has it"]);
    expect(h.warns[0]!.obj).toMatchObject({ sweep: "org-guard", team: "acme", branch: "mattstack" });
  });

  test("on an admin's Mac, org data merged into main is logged once", async () => {
    const h = harness({ data: [present, present], main: [{ kind: "merged", files: ["mattstack/org/settings.org.jsonc"] }, { kind: "merged", files: ["mattstack/org/settings.org.jsonc"] }], admin: true });
    await h.sweep();
    await h.sweep();
    expect(h.warns.map((w) => w.msg)).toEqual(["Org data was merged into main. Revert that commit"]);
  });

  test("a member's Mac never reads main", async () => {
    const h = harness({ data: [present] });
    await h.sweep();
    expect(h.mainAsked).toEqual([]);
  });

  test("a check that throws is logged and the sweep carries on", async () => {
    const warns: string[] = [];
    const sweep = createOrgGuardSweep({
      probes: fakeProbes({ home: "/h" }),
      slugs: () => ["acme", "widgets"],
      isAdmin: () => false,
      checkData: async (_p, slug) => { if (slug === "acme") throw new Error("boom"); return gone; },
      checkMain: async () => null,
      log: { warn: (_obj: unknown, msg: string) => { warns.push(msg); }, info: () => {} } as never,
    });
    await sweep();
    expect(warns).toEqual(["org guard check failed for an org", "The org's data branch is gone from the forge, and your copy still has it"]);
  });
});
