import { describe, expect, test } from "bun:test";
import type { TeamSnapshotEntry } from "../../daemon/team-snapshots.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { isPushRefusal, orgRows } from "../validators/org.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/h";
const ROOT = `${HOME}/.mattstack/teams/acme`;
const GITHUB = { provider: "github" as const, host: "github.com" };
const noStatus = async () => [];

function probes(opts: { username?: string; roster?: unknown[]; roles?: unknown } = {}) {
  return fakeProbes({
    home: HOME,
    dirs: { [`${ROOT}/mattstack/teams`]: ["widgets"] },
    files: {
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: JSON.stringify({
        "mattstack.roster": opts.roster ?? [{ username: "dev1", teams: ["widgets"] }],
        "mattstack.org": opts.roles ?? { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
      }),
      ...(opts.username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.username }) } : {}),
    },
  });
}

function status(error: string | null, slug = "acme"): () => Promise<TeamSnapshotEntry[]> {
  return async () => [{
    slug, id: slug, enabled: true, watching: true, repoDir: ROOT,
    lastRunAt: 0, lastCommit: null, lastCommitError: null, pushPending: true,
    lastPushAt: 0, lastPushError: error, lastPullAt: 0, lastPullError: null,
    lastPullSkipped: null, conflicted: null, pullOnly: false, unownedDirty: [],
    claimedZones: [], firstSeenDirty: {}, ownersError: null,
  }];
}

describe("orgRows", () => {
  test("a team member with no access problem gets no rows or writes", async () => {
    const p = probes({ username: "dev1" });
    expect(await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus })).toEqual([]);
    expect(p.calls.writes).toEqual({});
  });

  test("missing identity explains absent pack and offers a member token", async () => {
    const p = probes();
    const [row] = await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus });
    expect(row).toMatchObject({ id: "team.identity", kind: "access", required: false, status: "needs-you", title: "Who you are" });
    expect(row!.detail).toContain("GitHub");
    expect(row!.detail).toContain("team pack");
    expect(row!.action).toMatchObject({ type: "connect", integration: "github", label: "Connect", fields: [{ name: "token", hint: "repo, read:org" }] });
    expect(row!.finishGated).toBeUndefined();
    expect(p.calls.writes).toEqual({});
  });

  test("a custom forge link requires confirmation in the probe HOME", async () => {
    const forge = { provider: "gitlab" as const, host: "gitlab.example.com" };
    for (const confirmed of [null, "gitlab.other.example.com", "gitlab.example.com"]) {
      const p = probes();
      if (confirmed) p.writeFile(`${HOME}/.mattstack/user/settings.user.jsonc`, JSON.stringify({ "rt.integrations": { forgeHost: confirmed } }));
      const before = { ...p.calls.writes };
      const [row] = await orgRows(p, "acme", { forge, readStatus: noStatus });
      expect(row!.action).toMatchObject({ type: "connect", integration: "gitlab", fields: [{ name: "token", hint: "api" }] });
      const action = row!.action;
      if (action?.type !== "connect") throw new Error("expected connect");
      if (confirmed === "gitlab.example.com") expect(action.create?.url).toBe("https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api");
      else expect(action.create).toBeUndefined();
      expect(p.calls.fetch).toEqual([]);
      expect(p.calls.exec).toEqual([]);
      expect(p.calls.writes).toEqual(before);
    }
  });

  test("missing identity without a recognized forge offers steps", async () => {
    const [row] = await orgRows(probes(), "acme", { forge: null, readStatus: noStatus });
    expect(row!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Run: rt setup apply --only team.identity", "Then run: rt setup status"] });
  });

  test("no roster team explains absent pack and asks an admin without writing membership", async () => {
    const p = probes({ username: "dev9" });
    const [row] = await orgRows(p, "acme", { forge: GITHUB, readStatus: noStatus });
    expect(row).toMatchObject({ id: "team.none", kind: "access", required: false, status: "needs-you", title: "Your team" });
    expect(row!.detail).toContain("dev9");
    expect(row!.detail).toContain("team pack");
    expect(row!.action).toEqual({ type: "steps", label: "Show steps…", steps: [
      "Ask an org admin (dev1) to put dev9 on a team: rt team members set dev9 --teams <team>",
      "If dev9 is not your forge username, ask them to fix your name on the roster",
      "Then run: rt team pull",
    ] });
    expect(row!.finishGated).toBeUndefined();
    expect(p.calls.writes).toEqual({});
  });

  test("an owner gets owner token scopes when its push was refused", async () => {
    const [row] = await orgRows(probes({ username: "dev2", roster: [{ username: "dev2", teams: ["widgets"] }] }), "acme", { forge: GITHUB, readStatus: status("remote: Permission to acme/org.git denied to dev2.") });
    expect(row).toMatchObject({ id: "team.push-access", kind: "access", required: false, status: "needs-you" });
    expect(row!.detail).toBe("Your changes to the widgets team are saved on this Mac, but the org repo refused the push. Ask an org admin (dev1) for write access");
    expect(row!.action).toMatchObject({ type: "connect", integration: "github", create: { url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg" } });
    expect(row!.finishGated).toBeUndefined();
  });

  test("an admin without a recognized forge gets push access steps", async () => {
    const [row] = await orgRows(probes({ username: "dev1" }), "acme", { forge: null, readStatus: status("fatal: Authentication failed") });
    expect(row!.detail).toContain("changes to the org");
    expect(row!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Ask an org admin (dev1) for write access to the org repo", "Then run: rt team publish"] });
  });

  test("members never get push access and failures from other orgs do not apply", async () => {
    expect(await orgRows(probes({ username: "dev1", roles: { admins: [], teams: {} } }), "acme", { forge: GITHUB, readStatus: status("error: 403") })).toEqual([]);
    expect(await orgRows(probes({ username: "dev1" }), "acme", { forge: GITHUB, readStatus: status("error: 403", "other") })).toEqual([]);
    expect(await orgRows(probes({ username: "dev1" }), "acme", { forge: GITHUB, readStatus: async () => null })).toEqual([]);
    expect(await orgRows(probes({ username: "dev1" }), "acme", { forge: GITHUB, readStatus: status("Could not resolve host: github.com") })).toEqual([]);
  });
});

describe("isPushRefusal", () => {
  test("permission, token and branch-policy rejections require access repair", () => {
    for (const s of ["error: 403", "fatal: unable to access: The requested URL returned error: 403", "remote: Permission to acme/org.git denied to dev2.", "remote: GitLab: You are not allowed to push code to protected branches on this project.", "! [remote rejected] main -> main (protected branch hook declined)", "fatal: Authentication failed", "remote: Write access to repository not granted.", "remote: HTTP Basic: Access denied", "remote: Insufficient permissions", "remote: GH006: Protected branch update failed for refs/heads/main.", "remote: GH013: Repository rule violations found for refs/heads/main."]) expect(isPushRefusal(s)).toBe(true);
  });

  test("network, conflict and URL text do not ask for a new owner token", () => {
    for (const s of ["Could not resolve host", "! [rejected] main -> main (fetch first)", "! [rejected] main -> main (non-fast-forward)", "connection timed out", "fatal: unable to access 'https://gitlab.example.com/acme/403.git/': Could not resolve host", "fatal: unable to access 'https://gitlab.example.com/acme/protected-branch.git/': Failed to connect", "remote: Counting objects: 403, done.", "error: RPC failed; HTTP 502", "", "remote: pre-receive hook declined"]) expect(isPushRefusal(s)).toBe(false);
  });
});
