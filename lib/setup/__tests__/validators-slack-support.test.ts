import { describe, expect, test } from "bun:test";
import { rowsToChecks, verifyBlocks } from "../../../commands/verify.ts";
import { renderPlain } from "../../ui/out-plain.ts";
import { applyExpectations, ROW_TARGETS } from "../expectations.ts";
import { finalizePlan, type Action, type Group, type Row } from "../contract.ts";
import { SLACK_SUPPORT_SCOPES } from "../slack-app.ts";
import { outcomeFromChecks } from "../steps/verify.ts";
import { accountRows, type SecretPresence } from "../validators/accounts.ts";
import { SLACK_SUPPORT_ROW_ID, slackSupportRow } from "../validators/slack-support.ts";
import { setupStatePath } from "../state.ts";
import type { TeamSnapshot } from "../team-settings.ts";
import { fakeProbes } from "./fakes.ts";

const CONNECT: Action = { type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect", "--support-chat"] };
const DEFAULTS = ["channels:read", "groups:read", "channels:history", "groups:history", "reactions:read", "reactions:write", "chat:write"];

function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return { slug: "acme", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null, ...overrides };
}

const SLACK_TEAM = team({ integrations: { slack: { clientId: "abc", appId: "A0TEAM" } } });

function secrets(stored: Record<string, string> = {}): SecretPresence {
  return { has: async (domain, key) => stored[`${domain}.${key}`] ?? null };
}

function slackFetch(scopes: string[]) {
  return async () => ({ status: 200, body: JSON.stringify({ ok: true, team: "Acme" }), headers: { "x-oauth-scopes": scopes.join(",") } });
}

const TOKEN = secrets({ "board.slackToken": "tok" });

function group(r: Row): Group[] {
  return [{ id: "accounts", title: "Accounts", rows: [r] }];
}

describe("slackSupportRow", () => {
  test("says the token is your Slack token", () => {
    expect(slackSupportRow({ slack: { kind: "no-app" } }).why).toBe("Lets your Slack token read your DMs. Only people running support chats need it.");
  });

  test("states plainly what the token gains and who needs it, in every state", () => {
    const rows = [
      slackSupportRow({ slack: { kind: "no-app" } }),
      slackSupportRow({ slack: { kind: "not-connected" } }),
      slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS } }),
      slackSupportRow({ slack: { kind: "connected", scopes: [...DEFAULTS, ...SLACK_SUPPORT_SCOPES] } }),
    ];
    for (const r of rows) {
      expect(r.id).toBe(SLACK_SUPPORT_ROW_ID);
      expect(r.title).toBe("Slack support chat");
      expect(r.why).toContain("read your DMs");
      expect(r.why).toContain("support chats");
      expect(r.required).toBe(false);
    }
  });

  test("no team app says so, with nothing to press", () => {
    const r = slackSupportRow({ slack: { kind: "no-app" } });
    expect(r).toMatchObject({ status: "skipped", detail: "Your team has no Slack app yet", action: null });
  });

  test("not connected points at Slack's own row, with nothing to press", () => {
    const r = slackSupportRow({ slack: { kind: "not-connected" } });
    expect(r).toMatchObject({ status: "skipped", detail: "Connect Slack first", action: null });
  });

  test("a failed check is not an offer", () => {
    const r = slackSupportRow({ slack: { kind: "unchecked" } });
    expect(r).toMatchObject({ status: "skipped", detail: "Could not check Slack", action: null });
  });

  test("connected without the scopes offers Connect through the support-chat connect", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS } });
    expect(r.status).toBe("skipped");
    expect(r.detail).toBe("Off. Connect to approve it in Slack");
    expect(r.action).toEqual(CONNECT);
  });

  test("an unknown grant is still an offer: connecting is what finds out", () => {
    expect(slackSupportRow({ slack: { kind: "connected", scopes: [] } }).action).toEqual(CONNECT);
  });

  test("one of the four missing still offers Connect", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: [...DEFAULTS, "im:read", "im:write", "users:read"] } });
    expect(r.action).toEqual(CONNECT);
  });

  test("a short grant names what is missing and the app's OAuth page, and keeps Connect for after the fix", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS }, shortGrant: SLACK_SUPPORT_SCOPES, appId: "A0TEAM" });
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe(
      "Slack app is missing scopes. Ask its owner to add im:history, im:read, im:write, users:read under User Token Scopes at https://api.slack.com/apps/A0TEAM/oauth, then connect again",
    );
    expect(r.action).toEqual(CONNECT);
  });

  test("a short grant without an app id still says where to go", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS }, shortGrant: ["im:history"] });
    expect(r.detail).toContain("add im:history under User Token Scopes at https://api.slack.com/apps (your app's OAuth & Permissions page)");
  });

  test("a recorded short grant names only what the token still lacks", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: [...DEFAULTS, "im:history"] }, shortGrant: ["im:history", "im:read"], appId: "A0TEAM" });
    expect(r.detail).toContain("add im:read under");
  });

  test("a disconnected Mac drops the short grant: Slack's own row comes first", () => {
    const r = slackSupportRow({ slack: { kind: "not-connected" }, shortGrant: SLACK_SUPPORT_SCOPES, appId: "A0TEAM" });
    expect(r).toMatchObject({ status: "skipped", detail: "Connect Slack first", action: null });
  });

  test("all four scopes read ready, whatever a stale short grant says", () => {
    const r = slackSupportRow({ slack: { kind: "connected", scopes: [...DEFAULTS, ...SLACK_SUPPORT_SCOPES] }, shortGrant: SLACK_SUPPORT_SCOPES, appId: "A0TEAM" });
    expect(r).toMatchObject({ status: "ready", detail: "Ready for support chats", action: null });
  });
});

describe("the row's target", () => {
  const offer = slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS } });
  const short = slackSupportRow({ slack: { kind: "connected", scopes: DEFAULTS }, shortGrant: SLACK_SUPPORT_SCOPES });

  test("it is a Settings row", () => {
    expect(ROW_TARGETS[SLACK_SUPPORT_ROW_ID]).toBe("settings");
  });

  test("it never blocks Install or Finish, in any state", () => {
    for (const r of [offer, short, slackSupportRow({ slack: { kind: "not-connected" } })]) {
      const groups = applyExpectations(group(r));
      const out = groups[0]!.rows[0]!;
      expect(out.required).toBe(false);
      expect(out.finishGated).toBeUndefined();
      expect(out.waivable).toBeUndefined();
      const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, groups);
      expect(plan.canInstall).toBe(true);
      expect(plan.requiredMissing).toEqual([]);
      expect(plan.finishBlockedBy).toEqual([]);
    }
  });

  test("a person who never opted in reads as skipped in rt verify, with no warning", () => {
    const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, applyExpectations(group(offer)));
    expect(rowsToChecks(plan, { ci: false })).toEqual([{ name: SLACK_SUPPORT_ROW_ID, status: "skip", detail: "Off. Connect to approve it in Slack (Connect)", severity: "info" }]);
  });

  test("the update run's verify says nothing about it, even after a short grant", () => {
    const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, applyExpectations(group(short)));
    const rows = plan.groups.flatMap((g) => g.rows);
    const outcome = outcomeFromChecks(rowsToChecks(plan, { ci: false }), rows);
    expect(outcome.state).toBe("done");
    expect(outcome.detail).not.toContain("Slack");
  });

  test("rt verify's next line keeps the flag, or it would reconnect without asking for the scopes", () => {
    const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, applyExpectations(group(short)));
    expect(renderPlain(verifyBlocks(plan, { ci: false }))).toContain("rt setup slack connect --support-chat");
  });
});

describe("accountRows", () => {
  const pick = (rows: Row[]) => rows.find((r) => r.id === SLACK_SUPPORT_ROW_ID);

  test("sits right after the Slack row", async () => {
    const rows = await accountRows(fakeProbes(), SLACK_TEAM, [], secrets(), null);
    const ids = rows.map((r) => r.id);
    expect(ids[ids.indexOf("account.slack") + 1]).toBe(SLACK_SUPPORT_ROW_ID);
  });

  test("an unreadable setup state can't fail the row", async () => {
    const probes = fakeProbes();
    const readFile = probes.readFile;
    probes.readFile = (path) => {
      if (path === setupStatePath("/fake-home")) throw new Error("no read");
      return readFile(path);
    };
    const r = pick(await accountRows(probes, SLACK_TEAM, [], secrets(), null));
    expect(r?.detail).toBe("Connect Slack first");
  });

  test("a short grant of the wrong shape reads as no short grant", async () => {
    for (const stored of ["im:read", 3, { im: true }, [1, null]]) {
      const files = { [setupStatePath("/fake-home")]: JSON.stringify({ v: 2, slackSupportShort: stored }) };
      const r = pick(await accountRows(fakeProbes({ files, fetch: slackFetch(DEFAULTS) }), SLACK_TEAM, [], TOKEN, null));
      expect(r?.status).toBe("skipped");
    }
  });

  test("a team with no Slack app says so", async () => {
    const r = pick(await accountRows(fakeProbes(), team(), [], secrets(), null));
    expect(r?.detail).toBe("Your team has no Slack app yet");
  });

  test("a Just me Mac has no team to ask, so no row", async () => {
    expect(pick(await accountRows(fakeProbes(), team({ slug: "" }), [], secrets(), null, {}, true))).toBeUndefined();
  });

  test("no token yet asks for Slack first", async () => {
    const r = pick(await accountRows(fakeProbes(), SLACK_TEAM, [], secrets(), null));
    expect(r).toMatchObject({ status: "skipped", detail: "Connect Slack first", action: null });
  });

  test("a rejected token asks for Slack first", async () => {
    const fetch = async () => ({ status: 200, body: JSON.stringify({ ok: false, error: "invalid_auth" }), headers: {} });
    const r = pick(await accountRows(fakeProbes({ fetch }), SLACK_TEAM, [], TOKEN, null));
    expect(r?.detail).toBe("Connect Slack first");
  });

  test("an unreachable Slack is a failed check, not an offer", async () => {
    const fetch = async () => ({ status: 0, body: "", headers: {} });
    const r = pick(await accountRows(fakeProbes({ fetch }), SLACK_TEAM, [], TOKEN, null));
    expect(r).toMatchObject({ status: "skipped", detail: "Could not check Slack", action: null });
  });

  test("a secrets store that throws fails only this check", async () => {
    const broken: SecretPresence = { has: async () => { throw new Error("no key"); } };
    const r = pick(await accountRows(fakeProbes(), SLACK_TEAM, [], broken, null));
    expect(r).toMatchObject({ status: "skipped", detail: "Could not check Slack", action: null });
  });

  test("a token without the scopes offers Connect", async () => {
    const r = pick(await accountRows(fakeProbes({ fetch: slackFetch(DEFAULTS) }), SLACK_TEAM, [], TOKEN, null));
    expect(r?.action).toEqual(CONNECT);
  });

  test("a token with all four reads ready", async () => {
    const r = pick(await accountRows(fakeProbes({ fetch: slackFetch([...DEFAULTS, ...SLACK_SUPPORT_SCOPES]) }), SLACK_TEAM, [], TOKEN, null));
    expect(r?.status).toBe("ready");
  });

  test("a short grant on this Mac's record names what's missing", async () => {
    const files = { [setupStatePath("/fake-home")]: JSON.stringify({ v: 2, slackSupportShort: ["im:history"] }) };
    const r = pick(await accountRows(fakeProbes({ files, fetch: slackFetch(DEFAULTS) }), SLACK_TEAM, [], TOKEN, null));
    expect(r?.status).toBe("needs-you");
    expect(r?.detail).toContain("add im:history under User Token Scopes at https://api.slack.com/apps/A0TEAM/oauth");
  });

  test("Slack's row and this one share one sign-in check", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return { status: 200, body: JSON.stringify({ ok: true, team: "Acme" }), headers: { "x-oauth-scopes": DEFAULTS.join(",") } };
    };
    await accountRows(fakeProbes({ fetch }), SLACK_TEAM, [], TOKEN, null);
    expect(calls).toBe(1);
  });
});
