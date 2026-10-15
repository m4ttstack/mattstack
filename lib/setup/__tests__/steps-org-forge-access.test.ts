import { afterEach, describe, expect, test } from "bun:test";
import type { SecretsSeams } from "../../secrets/store.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import type { ApplyContext } from "../apply.ts";
import { forgeAccessStepSeams, orgForgeAccessStep } from "../steps/org-forge-access.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/h";
const ORG = `${HOME}/.mattstack/orgs/acme`;
const SECRETS = { marker: "team secrets for acme" } as unknown as SecretsSeams;
const real = forgeAccessStepSeams.run;
afterEach(() => { forgeAccessStepSeams.run = real; });
const ran = (applied: { done: string[]; manualSteps: string[] }, admin: { reencrypted: string[]; failure: string | null } | null = null) =>
  async () => ({ report: { kind: "no-forge" as const }, applied: { ...applied, limit: null, heldOff: [] }, admin });

function ctx(me: string, latch: boolean): ApplyContext {
  const p = fakeProbes({
    home: HOME,
    dirs: { [`${HOME}/.mattstack/orgs`]: ["acme"] },
    files: {
      [`${ORG}/.git/config`]: "[core]\n",
      [`${ORG}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} } }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: me, rtMayManageMembership: latch }),
    },
  });
  return { p, teamSecrets: (slug: string) => (slug === "acme" ? SECRETS : ({} as SecretsSeams)) } as unknown as ApplyContext;
}

describe("org.forge-access", () => {
  test("skips where rt does not manage forge access", async () => {
    forgeAccessStepSeams.run = async () => { throw new Error("must not run"); };
    expect(await orgForgeAccessStep.run(ctx("dev1", false))).toEqual({ state: "skipped", detail: "rt does not manage forge access on this Mac" });
    expect(await orgForgeAccessStep.run(ctx("dev3", true))).toMatchObject({ state: "skipped" });
  });
  test("passes the org's own team secret seams, and reports what it changed", async () => {
    const seen: unknown[] = [];
    forgeAccessStepSeams.run = async (_p, _slug, secrets) => {
      seen.push(secrets);
      return { report: { kind: "no-forge" }, applied: { done: ["Gave dev2 write access"], manualSteps: [], limit: null, heldOff: [] }, admin: null };
    };
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toEqual({ state: "done", detail: "acme: Gave dev2 write access" });
    expect(seen).toEqual([SECRETS]);
  });
  test("names the admin-only secrets it re-encrypted after a role change", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: [] }, { reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toEqual({ state: "done", detail: "acme: re-encrypted the admin-only secrets for the current owners and admins" });
  });
  test("a forge refusal is partial, with the verb that shows the steps", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: ["Open https://github.com/acme/widgets/settings/access"] });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toMatchObject({ state: "partial", remedy: "Run rt team forge-access to see the steps" });
  });
  test("an admin-only secrets failure is partial, with the verb that retries it", async () => {
    forgeAccessStepSeams.run = ran({ done: [], manualSteps: [] }, { reencrypted: [], failure: "sops refused" });
    expect(await orgForgeAccessStep.run(ctx("dev1", true))).toMatchObject({ state: "partial", remedy: "Run rt team admin-secrets" });
  });
  test("a data branch shared with the rest of the repo needs the admin, and is never called a forge refusal", async () => {
    forgeAccessStepSeams.run = async () => ({ report: { kind: "shared-branch", branch: "main" }, applied: null, admin: null });
    const outcome = await orgForgeAccessStep.run(ctx("dev1", true));
    expect(outcome).toEqual({ state: "needs-you", detail: "acme: The org's data is on main, which the rest of the repo uses too, so rt leaves its rules alone. Move the org's data to its own branch first." });
  });
  test("a throw is a failed outcome, never a thrown run", async () => {
    forgeAccessStepSeams.run = async () => { throw new Error("boom"); };
    expect((await orgForgeAccessStep.run(ctx("dev1", true))).state).toBe("failed");
  });
});
