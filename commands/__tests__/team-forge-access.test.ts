import { describe, expect, spyOn, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { teamLocalPath } from "../../lib/team/team-local.ts";
import type { ForgeAccessReport } from "../../lib/team/forge-access-apply.ts";
import { forgeAccessBlocks, teamForgeAccess, type TeamDeps } from "../team.ts";

async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

const ready = (over: Partial<Extract<ForgeAccessReport, { kind: "ready" }>> = {}): ForgeAccessReport => ({
  kind: "ready",
  provider: "gitlab",
  branch: "mattstack",
  pushList: { kind: "named", users: ["dev1"] },
  wanted: { members: [], pushers: ["dev1", "dev2"], invalid: [] },
  diff: { grant: [{ username: "dev2", level: "write" }], addPush: ["dev2"], removePush: [], waiting: [] },
  managing: false,
  lastManualSteps: [],
  ...over,
});

describe("forgeAccessBlocks", () => {
  test("not yet: says rt leaves it alone until the data has its own branch", () => {
    const text = renderPlain(forgeAccessBlocks("acme", { kind: "not-yet", branch: "main" }, null));
    expect(text).toContain("rt leaves forge access alone for now");
    expect(text).toContain("once the org's data has a branch of its own");
  });
  test("on a trial branch: says the access sync waits", () => {
    const text = renderPlain(forgeAccessBlocks("acme", { kind: "trial", branch: "mattstack-trial" }, null));
    expect(text).toContain("Forge access waits while this Mac is on the trial branch mattstack-trial");
    expect(text).toContain(`rt team branch use`);
  });
  test("a difference lists each change and points at the latch when it is off", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready(), null));
    expect(text).toContain("Give dev2 write access");
    expect(text).toContain("Let dev2 push mattstack");
    expect(text).toContain("rt team manage-membership on --team acme");
  });
  test("with the latch on it points at apply", () => {
    expect(renderPlain(forgeAccessBlocks("acme", ready({ managing: true }), null))).toContain("rt team forge-access --apply --team acme");
  });
  test("an applied run lists what changed, the limit and the steps by hand", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready({ managing: true }), { done: ["Gave dev2 write access"], manualSteps: ["Open https://gitlab.com/acme/widgets/-/settings/repository"], limit: "x. Anyone with write access can push mattstack, and only rt limits what they change there." }));
    expect(text).toContain("Gave dev2 write access");
    expect(text).toContain("only rt limits what they change there");
    expect(text).toContain("Open https://gitlab.com/acme/widgets/-/settings/repository");
  });
  test("nothing to change reads as done", () => {
    const text = renderPlain(forgeAccessBlocks("acme", ready({ diff: { grant: [], addPush: [], removePush: [], waiting: [] } }), null));
    expect(text).toContain("Forge access matches the org's roles");
  });
});

describe("teamForgeAccess", () => {
  const files = (me: string, latch: boolean) => ({
    "/home/x/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
    [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch }),
  });
  const deps = (me: string, latch: boolean): TeamDeps & { lines: string[] } => {
    const lines: string[] = [];
    return {
      probes: fakeProbes({ home: "/home/x", files: files(me, latch) }),
      print: (s) => lines.push(s),
      exit: (code) => { throw new Error(`exit ${code}`); },
      forgeAccessSeams: { forgeToken: async () => null, access: () => null },
      lines,
    };
  };

  test("--json prints the report in an envelope", async () => {
    const d = deps("dev1", false);
    await teamForgeAccess(["--team", "acme", "--json"], {}, d);
    expect(JSON.parse(d.lines[0]!)).toMatchObject({ slug: "acme", report: { kind: "not-yet" }, applied: null });
  });
  test("--apply with the latch off is refused with the latch as the next step", async () => {
    const d = deps("dev1", false);
    expect(await runExpectingProcessExit(() => teamForgeAccess(["--apply", "--team", "acme", "--json"], {}, d))).toBe(2);
    expect(JSON.parse(d.lines[0]!).error.code).toBe("forge-access-off");
  });
  test("someone who does not run the org is refused", async () => {
    const d = deps("dev3", true);
    expect(await runExpectingProcessExit(() => teamForgeAccess(["--team", "acme", "--json"], {}, d))).toBe(2);
    expect(JSON.parse(d.lines[0]!).error.code).toBe("team-pull-only");
  });
});
