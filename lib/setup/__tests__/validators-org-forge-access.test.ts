import { describe, expect, test } from "bun:test";
import type { ForgeAccessReport } from "../../team/forge-access-apply.ts";
import { forgeAccessRow } from "../validators/org-forge-access.ts";
import { fakeProbes } from "./fakes.ts";

const p = fakeProbes({ home: "/h" });
const noDiff = { grant: [], addPush: [], removePush: [], waiting: [] };
const ready = (over: Partial<Extract<ForgeAccessReport, { kind: "ready" }>> = {}): ForgeAccessReport => ({
  kind: "ready", provider: "github", branch: "mattstack", pushList: { kind: "named", users: ["dev1"] },
  wanted: { members: [], pushers: ["dev1"], invalid: [] }, diff: noDiff, managing: true, lastManualSteps: [], ...over,
});
const rowFor = (report: ForgeAccessReport) => forgeAccessRow(p, "acme", async () => report);

describe("forgeAccessRow", () => {
  test("is absent on a Mac that does not run the org, off GitHub and GitLab, and before the data has its own branch", async () => {
    for (const report of [{ kind: "not-admin" }, { kind: "no-forge" }, { kind: "not-yet", branch: "main" }] as ForgeAccessReport[]) expect(await rowFor(report)).toBeNull();
  });
  test("on a trial branch it says the access sync waits", async () => {
    expect(await rowFor({ kind: "trial", branch: "mattstack-trial" })).toMatchObject({
      status: "skipped",
      detail: "Forge access waits while this Mac is on the trial branch mattstack-trial",
      action: null,
    });
  });
  test("matching access is ready, and says plainly when the forge cannot name who may push", async () => {
    expect(await rowFor(ready())).toMatchObject({ id: "org.forge-access", status: "ready", required: false, kind: "access" });
    const open = await rowFor(ready({ pushList: { kind: "open", why: "The mattstack branch lets every Developer push" } }));
    expect(open?.status).toBe("ready");
    expect(open?.detail).toContain("only rt limits what they change there");
  });
  test("a difference without the latch offers the latch", async () => {
    const r = await rowFor(ready({ managing: false, diff: { ...noDiff, grant: [{ username: "dev2", level: "write" }] } }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "run", verb: ["team", "manage-membership", "on", "--team", "acme"] } });
    expect(r?.detail).toContain("Give dev2 write access");
  });
  test("a difference the forge refused shows the step by hand", async () => {
    const r = await rowFor(ready({ diff: { ...noDiff, addPush: ["dev2"] }, lastManualSteps: ["Open https://github.com/acme/widgets/settings/branches"] }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "steps", steps: ["Open https://github.com/acme/widgets/settings/branches"] } });
  });
  test("a difference with the latch and no refusal offers to apply now", async () => {
    const r = await rowFor(ready({ diff: { ...noDiff, removePush: ["dev3"] } }));
    expect(r).toMatchObject({ status: "needs-you", action: { type: "run", verb: ["team", "forge-access", "--apply", "--team", "acme"] } });
  });
  test("a refused read shows the steps", async () => {
    expect(await rowFor({ kind: "refused", manualSteps: ["Sign in, then run this again: gh auth login"] })).toMatchObject({ status: "needs-you", action: { type: "steps" } });
  });
  test("a read that throws is one error row, never a throw", async () => {
    const r = await forgeAccessRow(p, "acme", async () => { throw new Error("timed out"); });
    expect(r).toMatchObject({ status: "error", action: { type: "run", verb: ["setup", "status"] } });
  });
});
