import { describe, expect, test } from "bun:test";
import type { LoginSession } from "../cli-login.ts";
import { finalizePlan, row, type Action, type OrgRef, type Plan, type Row } from "../contract.ts";
import { allAnswered, composeForm, connectRows, extraRows, formOwnedIds, runFixes, type ConnectInputs, type FormRow } from "../form.ts";
import type { PrepareRecord } from "../prepare.ts";
import type { ToolRequirement } from "../requirements.ts";
import { tokenCreateLink, tokenField } from "../token-create.ts";
import { FAST_BROWSER_ADD_ACTION } from "../validators/tools.ts";
import { fakeProbes } from "./fakes.ts";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const JOIN: OrgRef = { slug: "mithrandir", name: "Mithrandir", mode: "join" };
const SOLO: OrgRef = { slug: "", name: "", mode: "none" };

const SLACK_OAUTH: Action = { type: "oauth", label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"] };
const LINEAR_CONNECT: Action = { type: "connect", label: "Connect", integration: "linear", fields: [{ name: "apiKey", label: "Linear API key", secret: true, hint: "lin_api_…" }] };
const CLAUDE_SIGNIN: Action = { type: "run", label: "Sign in to Claude", verb: ["setup", "claude", "connect"] };
const SDM_CONNECT: Action = { type: "connect", label: "Connect", integration: "sdm", fields: [{ name: "email", label: "StrongDM email", secret: false }] };
const HERDR_INSTALL: Action = { type: "install", label: "Install", tool: "herdr", via: "brew" };

function r(id: string, status: Row["status"], detail: string, over: Partial<Row> = {}): Row {
  return row({ id, kind: id.startsWith("account.") ? "account" : "tool", title: id, why: `why ${id}`, required: true, status, detail, ...over });
}

const DOPPLER: ToolRequirement = { name: "doppler", why: "Pulls your dev secrets", connect: { integration: "doppler" } };

function joinerRows(): Row[] {
  return [
    r("account.gitlab", "ready", "GitLab token works"),
    r("account.slack", "missing", "No Slack account connected yet", { action: SLACK_OAUTH, finishGated: true, waivable: false }),
    r("tool.claude", "ready", "Claude Code 2.1.0, signed in"),
    r("tool.team.doppler", "ready", "doppler 3.70.0"),
    r("account.doppler", "invalid", "Not signed in to Doppler", { required: false }),
    r("account.linear", "missing", "No Linear account connected yet", { action: LINEAR_CONNECT, finishGated: true, waivable: false }),
    r("tool.chrome", "ready", "Google Chrome installed"),
    r("tool.fast-browser-extension", "ready", "Loaded and paired", { required: false, finishGated: true, waivable: false }),
  ];
}

function plan(rows: Row[], team: OrgRef = JOIN): Plan {
  return finalizePlan(team, [{ id: "tools", title: "Tools", rows }], NOW);
}

function swap(rows: Row[], next: Row): Row[] {
  return rows.some((x) => x.id === next.id) ? rows.map((x) => (x.id === next.id ? next : x)) : [...rows, next];
}

function without(rows: Row[], ...ids: string[]): Row[] {
  return rows.filter((x) => !ids.includes(x.id));
}

function prepare(over: Partial<PrepareRecord & { running: boolean }> = {}): PrepareRecord & { running: boolean } {
  return { stage: "accounts", startedAt: "2026-10-30T09:50:00.000Z", pid: 4242, items: [], failed: [], running: true, ...over };
}

function session(tool: LoginSession["tool"], over: Partial<LoginSession> = {}): LoginSession {
  return { tool, pid: 777, startedAt: "2026-10-30T09:59:00.000Z", logPath: "/fake/log", fifoPath: "/fake/fifo", url: `https://example.com/${tool}/auth`, code: null, prompt: false, ...over };
}

function inputs(over: Partial<ConnectInputs> = {}): ConnectInputs {
  return {
    path: "join",
    plan: plan(joinerRows()),
    forge: { provider: "gitlab", host: "gitlab.com" },
    forgeLogin: "janedoe",
    signIn: [DOPPLER],
    prepare: null,
    logins: {},
    ...over,
  };
}

function pick(list: FormRow[], id: string): FormRow {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`no row ${id} in ${list.map((x) => x.id).join(", ")}`);
  return found;
}

describe("connectRows", () => {
  test("a joiner's rows come in the spec's order", () => {
    expect(connectRows(inputs()).map((x) => x.id)).toEqual(["forge", "slack", "claude", "signin.doppler", "linear", "fast-browser"]);
  });

  test("no Slack row when the team has none", () => {
    const rows = connectRows(inputs({ plan: plan(without(joinerRows(), "account.slack")) }));
    expect(rows.map((x) => x.id)).not.toContain("slack");
  });

  test("herdr installing in the background reads Installing, and a failed install offers the row's own Install", () => {
    const missing = swap(joinerRows(), r("tool.herdr", "missing", "herdr is not installed", { action: HERDR_INSTALL }));
    const busy = pick(connectRows(inputs({ plan: plan(missing), prepare: prepare({ items: ["herdr"] }) })), "tool.herdr");
    expect(busy.state).toBe("busy");
    expect(busy.detail).toBe("Installing…");
    expect(busy.action).toBeNull();
    expect(busy.optional).toBe(false);

    const failed = prepare({ running: false, endedAt: "2026-10-30T09:55:00.000Z", items: ["herdr"], failed: [{ tool: "herdr", detail: "brew install herdr failed" }] });
    const todo = pick(connectRows(inputs({ plan: plan(missing), prepare: failed })), "tool.herdr");
    expect(todo.state).toBe("todo");
    expect(todo.title).toBe("tool.herdr");
    expect(todo.subtext).toBe("why tool.herdr");
    expect(todo.detail).toBe("brew install herdr failed");
    expect(todo.action).toEqual(HERDR_INSTALL);
  });

  test("a pack tool rt cannot install shows its own Download", () => {
    const download: Action = { type: "open-url", label: "Download", url: "https://example.com/widget-cli" };
    const rows = connectRows(inputs({ plan: plan(swap(joinerRows(), r("tool.team.widget-cli", "missing", "widget-cli is not installed", { action: download }))) }));
    const extra = pick(rows, "tool.team.widget-cli");
    expect(extra.state).toBe("todo");
    expect(extra.action).toEqual(download);
    expect(rows.map((x) => x.id).indexOf("tool.team.widget-cli")).toBe(rows.map((x) => x.id).indexOf("linear") - 1);
  });

  test("a required StrongDM account shows with its email field", () => {
    const sdm = r("account.sdm", "missing", "No StrongDM account connected yet", { action: SDM_CONNECT });
    const extra = pick(connectRows(inputs({ plan: plan(swap(joinerRows(), sdm)) })), "account.sdm");
    expect(extra.action).toEqual(sdm.action);
    expect(extra.detail).toBe("No StrongDM account connected yet");
    expect(extra.optional).toBe(false);
  });

  test("rows a run sets up stay off the connect screen", () => {
    const rows = swap(swap(joinerRows(), r("tool.daemon", "missing", "Not running")), r("pack.widgets", "missing", "Not installed", { action: { type: "run", label: "Install plugins", verb: ["setup", "pack"] } }));
    const ids = connectRows(inputs({ plan: plan(rows) })).map((x) => x.id);
    expect(ids).not.toContain("tool.daemon");
    expect(ids).not.toContain("pack.widgets");
  });

  test("herdr installed without its Claude integration stays off the connect screen", () => {
    const allDone = joinerRows().map((x) => ({ ...x, status: "ready" as const }));
    const herdr = r("tool.herdr", "needs-you", "herdr 0.8.0, Claude integration not installed", {
      required: false,
      finishGated: true,
      action: { type: "run", label: "Install integration", verb: ["tools", "setup", "herdr"] },
    });
    const p = plan(swap(allDone, herdr));
    expect(p.finishBlockedBy).toContain("tool.herdr");
    const rows = connectRows(inputs({ plan: p }));
    expect(rows.map((x) => x.id)).not.toContain("tool.herdr");
    expect(allAnswered(rows)).toBe(true);
  });

  test("herdr too old still shows with its Upgrade", () => {
    const upgrade: Action = { type: "install", label: "Upgrade", tool: "herdr", via: "brew" };
    const rows = connectRows(inputs({ plan: plan(swap(joinerRows(), r("tool.herdr", "invalid", "herdr 0.6.0 is older than 0.7.5", { action: upgrade }))) }));
    expect(pick(rows, "tool.herdr").action).toEqual(upgrade);
  });

  test("a doctor remedy other than the store install keeps its own action and no waiting line", () => {
    const steps: Action = { type: "steps", label: "Show steps…", steps: ["Turn on Full Disk Access for mattstack in System Settings, then Re-check"] };
    const ext = r("tool.fast-browser-extension", "needs-you", "mattstack cannot read Chrome's profile", { required: false, finishGated: true, action: steps });
    const fb = pick(connectRows(inputs({ plan: plan(swap(joinerRows(), ext)) })), "fast-browser");
    expect(fb.state).toBe("todo");
    expect(fb.action).toEqual(steps);
    expect(fb.detail).toBe("mattstack cannot read Chrome's profile");
    expect(fb.waiting).toBeNull();
  });

  test("the forge row says the account came from the invite", () => {
    const forge = pick(connectRows(inputs()), "forge");
    expect(forge.state).toBe("done");
    expect(forge.title).toBe("GitLab");
    expect(forge.detail).toBe("Connected as janedoe from your invite");

    const created = pick(connectRows(inputs({ path: "create" })), "forge");
    expect(created.detail).toBe("Connected as janedoe");
  });

  test("the forge row prefers the login the forge itself vouched for", () => {
    const rows = swap(without(joinerRows(), "account.gitlab"), r("account.github", "ready", "Signed in through the gh CLI as jdoe-gh"));
    const forge = pick(connectRows(inputs({ plan: plan(rows), forge: { provider: "github", host: "github.com" }, path: "create" })), "forge");
    expect(forge.detail).toBe("Connected as jdoe-gh");
  });

  test("a forge without a token asks for one with Create token", () => {
    const rows = swap(joinerRows(), r("account.gitlab", "missing", "No GitLab account connected yet"));
    const forge = pick(connectRows(inputs({ plan: plan(rows), path: "create" })), "forge");
    expect(forge.state).toBe("todo");
    expect(forge.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "gitlab",
      fields: [tokenField("gitlab", "owner")],
      create: { label: "Create token", url: tokenCreateLink("gitlab", "owner", "gitlab.com").url },
    });
  });

  test("Slack follows the forge: MRs on GitLab, PRs on GitHub", () => {
    const gitlab = pick(connectRows(inputs()), "slack");
    expect(gitlab.subtext).toBe("Lets mattstack track and post MRs in Slack");
    expect(gitlab.action).toEqual(SLACK_OAUTH);
    expect(gitlab.waiting).toBe("Waiting for Slack…");
    expect(gitlab.watch).toBe(true);
    const github = pick(connectRows(inputs({ forge: { provider: "github", host: "github.com" } })), "slack");
    expect(github.subtext).toBe("Lets mattstack track and post PRs in Slack");

    const connected = pick(connectRows(inputs({ plan: plan(swap(joinerRows(), r("account.slack", "ready", "Connected to Acme"))) })), "slack");
    expect([connected.state, connected.detail, connected.action]).toEqual(["done", "Connected", null]);
  });

  test("Claude reads Installing while the background install runs", () => {
    const missing = swap(joinerRows(), r("tool.claude", "missing", "Claude Code is not installed", { action: { type: "install", label: "Install", tool: "claude", via: "brew" } }));
    const busy = pick(connectRows(inputs({ plan: plan(missing), prepare: prepare({ items: ["claude"] }) })), "claude");
    expect([busy.state, busy.detail, busy.action]).toEqual(["busy", "Installing…", null]);
    expect(busy.title).toBe("Claude");
    expect(busy.subtext).toBe("You know, to do agentic stuff.");

    const todo = pick(connectRows(inputs({ plan: plan(missing) })), "claude");
    expect(todo.state).toBe("todo");
    expect(todo.action).toEqual({ type: "install", label: "Install", tool: "claude", via: "vendor" });
  });

  test("Claude with a live sign-in waits and offers Paste code", () => {
    const signedOut = swap(joinerRows(), r("tool.claude", "needs-you", "Not signed in yet", { required: false, action: CLAUDE_SIGNIN }));
    const claude = pick(connectRows(inputs({ plan: plan(signedOut), logins: { claude: session("claude", { prompt: true }) } })), "claude");
    expect(claude.state).toBe("waiting");
    expect(claude.detail).toBe("Finish signing in in your browser");
    expect(claude.action).toEqual({ type: "form", label: "Paste code", verb: ["setup", "claude", "code"], fields: [{ name: "code", label: "Code from your browser", secret: true }] });
    expect(claude.watch).toBe(true);
  });

  test("a dead sign-in is back to Sign in to Claude", () => {
    const signedOut = swap(joinerRows(), r("tool.claude", "needs-you", "Not signed in yet", { required: false, action: CLAUDE_SIGNIN }));
    const claude = pick(connectRows(inputs({ plan: plan(signedOut), logins: {} })), "claude");
    expect(claude.state).toBe("todo");
    expect(claude.action).toEqual(CLAUDE_SIGNIN);
    expect(claude.optional).toBe(false);
  });

  test("a signed-in Claude is done with the row's detail", () => {
    const claude = pick(connectRows(inputs()), "claude");
    expect([claude.state, claude.detail]).toEqual(["done", "Claude Code 2.1.0, signed in"]);
  });

  test("a sign-in tool shows Doppler's code while its session waits", () => {
    const row = pick(connectRows(inputs({ logins: { doppler: session("doppler", { code: "ABC-123", url: "https://dashboard.doppler.com/workplace/auth/cli" }) } })), "signin.doppler");
    expect(row.title).toBe("Doppler");
    expect(row.subtext).toBe("Pulls your dev secrets");
    expect(row.state).toBe("waiting");
    expect(row.detail).toBe("Your code is ABC-123. Confirm it in your browser");
    expect(row.action).toEqual({ type: "open-url", label: "Open again", url: "https://dashboard.doppler.com/workplace/auth/cli" });
    expect(row.watch).toBe(true);
  });

  test("a sign-in tool walks Installing, Sign in, then done", () => {
    const missing = swap(joinerRows(), r("tool.team.doppler", "missing", "doppler is not installed", { action: { type: "install", label: "Install", tool: "doppler", via: "brew" } }));
    expect(pick(connectRows(inputs({ plan: plan(missing), prepare: prepare({ items: ["doppler"] }) })), "signin.doppler").state).toBe("busy");
    const install = pick(connectRows(inputs({ plan: plan(missing) })), "signin.doppler");
    expect([install.state, install.action]).toEqual(["todo", { type: "install", label: "Install", tool: "doppler", via: "brew" }]);

    const signIn = pick(connectRows(inputs()), "signin.doppler");
    expect(signIn.state).toBe("todo");
    expect(signIn.action).toEqual({ type: "run", label: "Sign in", verb: ["setup", "doppler", "connect"] });

    const done = pick(connectRows(inputs({ plan: plan(swap(joinerRows(), r("account.doppler", "ready", "Signed in to Doppler", { required: false }))) })), "signin.doppler");
    expect(done.state).toBe("done");
  });

  test("a sign-in tool with its own verb runs it, and the dev-servers line stands in for a blank why", () => {
    const tool: ToolRequirement = { name: "acme-api", why: "", connect: { verb: ["acme-api", "login"], label: "Log in" } };
    const rows = swap(joinerRows(), r("tool.team.acme-api", "ready", "acme-api 1.0.0"));
    const row = pick(connectRows(inputs({ plan: plan(rows), signIn: [DOPPLER, tool] })), "signin.acme-api");
    expect(row.title).toBe("acme-api");
    expect(row.subtext).toBe("For running your dev servers");
    expect(row.action).toEqual({ type: "run", label: "Log in", verb: ["acme-api", "login"] });
  });

  test("Linear shows only when the team uses it", () => {
    const linear = pick(connectRows(inputs()), "linear");
    expect(linear.subtext).toBe("So mattstack can read and write Linear tickets");
    expect(linear.action).toEqual({ ...LINEAR_CONNECT, create: { label: "Create token", url: "https://linear.app/settings/account/security" } });
    expect(connectRows(inputs({ plan: plan(without(joinerRows(), "account.linear")) })).map((x) => x.id)).not.toContain("linear");
  });

  test("no Chrome offers Get Chrome first", () => {
    const rows = swap(swap(joinerRows(), r("tool.chrome", "missing", "Google Chrome is not installed", { required: false })), r("tool.fast-browser-extension", "skipped", "Google Chrome is not installed, so there is nothing to load it into", { required: false }));
    const fb = pick(connectRows(inputs({ plan: plan(rows) })), "fast-browser");
    expect(fb.state).toBe("todo");
    expect(fb.action).toEqual({ type: "open-url", label: "Get Chrome", url: "https://www.google.com/chrome/" });
  });

  test("the extension added reads Added", () => {
    const fb = pick(connectRows(inputs()), "fast-browser");
    expect([fb.state, fb.detail, fb.action]).toEqual(["done", "Added", null]);
    expect(fb.title).toBe("Fast Browser");
  });

  test("the extension missing from Chrome offers Add to Chrome and waits for Chrome", () => {
    const ext = r("tool.fast-browser-extension", "needs-you", "Not installed in Chrome", { required: false, finishGated: true, action: FAST_BROWSER_ADD_ACTION });
    const fb = pick(connectRows(inputs({ plan: plan(swap(joinerRows(), ext)) })), "fast-browser");
    expect(fb.state).toBe("todo");
    expect(fb.action).toEqual(FAST_BROWSER_ADD_ACTION);
    expect(fb.waiting).toBe("Waiting for Chrome…");
    expect(fb.subtext).toBe("Lets agents drive your real Chrome");
    expect(fb.watch).toBe(true);
  });

  test("solo shows the code host as optional, then Claude and Fast Browser", () => {
    const rows = [
      r("account.github", "missing", "No GitHub account connected yet", { required: false }),
      r("tool.claude", "ready", "Claude Code 2.1.0, signed in"),
      r("tool.chrome", "ready", "Google Chrome installed"),
      r("tool.fast-browser-extension", "ready", "Loaded and paired", { required: false }),
    ];
    const list = connectRows(inputs({ path: "solo", plan: plan(rows, SOLO), forge: null, forgeLogin: null, signIn: [] }));
    expect(list.map((x) => x.id)).toEqual(["forge", "claude", "fast-browser"]);
    const forge = pick(list, "forge");
    expect(forge.title).toBe("GitHub");
    expect(forge.subtext).toBe("Optional. Lets mattstack open PRs and MRs");
    expect(forge.state).toBe("todo");
    expect(forge.optional).toBe(true);
    expect(allAnswered(list)).toBe(true);
  });

  test("on solo Fast Browser never holds Continue", () => {
    const rows = [
      r("account.github", "ready", "GitHub token works", { required: false }),
      r("tool.claude", "ready", "Claude Code 2.1.0, signed in"),
      r("tool.chrome", "missing", "Google Chrome is not installed", { required: false }),
    ];
    const list = connectRows(inputs({ path: "solo", plan: plan(rows, SOLO), forge: null, forgeLogin: null, signIn: [] }));
    expect(pick(list, "fast-browser").optional).toBe(true);
    expect(allAnswered(list)).toBe(true);
    expect(pick(connectRows(inputs({ plan: plan(swap(joinerRows(), rows[2]!)) })), "fast-browser").optional).toBe(false);
  });

  test("a creator sees the Slack app row before Slack", () => {
    const appRow = r("account.slack-app", "missing", "The team has no Slack app yet", {
      action: { type: "owner-once", label: "Create the team's Slack app…", integration: "slack", fields: [{ name: "configToken", label: "App configuration token", secret: true }] },
    });
    const waitingSlack = r("account.slack", "missing", "Waiting for the team's Slack app to be set up");
    const rows = swap(swap(joinerRows(), waitingSlack), appRow);
    const list = connectRows(inputs({ path: "create", plan: plan(rows) }));
    expect(list.map((x) => x.id).slice(0, 3)).toEqual(["forge", "slack-app", "slack"]);
    const app = pick(list, "slack-app");
    expect(app.title).toBe("Slack app");
    expect(app.subtext).toBe("Lets your team connect Slack. One owner makes it once");
    expect(app.action).toEqual(appRow.action);
    expect(app.optional).toBe(false);

    expect(connectRows(inputs({ path: "join", plan: plan(rows) })).map((x) => x.id)).not.toContain("slack-app");
  });

  test("a row nothing can be pressed on never holds Continue", () => {
    const stuck = r("account.sdm", "error", "rt does not know this integration");
    const doneRows = joinerRows().map((x) => ({ ...x, status: "ready" as const }));
    const list = connectRows(inputs({ plan: plan(swap(doneRows, stuck)) }));
    const extra = pick(list, "account.sdm");
    expect(extra.action).toBeNull();
    expect(extra.optional).toBe(true);
    expect(allAnswered(list)).toBe(true);
  });
});

describe("extraRows", () => {
  test("after a run only the rows a run sets up come back", () => {
    const rows = swap(swap(joinerRows(), r("tool.daemon", "missing", "Not running")), r("tool.herdr", "invalid", "herdr 0.6.0 is older than 0.7.5", { action: HERDR_INSTALL }));
    const p = plan(rows);
    const ids = (afterRun: boolean) => extraRows(p, formOwnedIds(p, [DOPPLER]), { afterRun, prepare: null }).map((x) => x.id);
    expect(ids(false)).toEqual(["tool.herdr"]);
    expect(ids(true)).toEqual(["tool.daemon"]);
  });

  test("the forms own every row they draw, and leave the backup to the run", () => {
    const rows = [
      ...joinerRows(),
      r("perm.fda", "missing", "x"),
      r("perm.notifications", "missing", "x"),
      r("tool.clt", "missing", "x"),
      r("account.slack-app", "missing", "x"),
      r("repos.place:gitlab.com/acme/acme-api", "needs-you", "x"),
      r("home.backup", "needs-you", "x"),
    ];
    const owned = formOwnedIds(plan(rows), [DOPPLER]);
    for (const id of ["perm.fda", "perm.notifications", "tool.clt", "account.gitlab", "account.slack-app", "account.slack", "tool.claude", "tool.team.doppler", "account.doppler", "account.linear", "tool.chrome", "tool.fast-browser-extension", "repos.place:gitlab.com/acme/acme-api"]) {
      expect(owned.has(id)).toBe(true);
    }
    expect(owned.has("home.backup")).toBe(false);
  });

  test("runFixes covers the run's own rows, packs, rows waiting for Install, and herdr's integration", () => {
    expect(runFixes(r("tool.daemon", "missing", ""))).toBe(true);
    expect(runFixes(r("home.backup", "needs-you", ""))).toBe(true);
    expect(runFixes(r("pack.widgets", "missing", ""))).toBe(true);
    expect(runFixes(r("tool.editor", "missing", "", { waitsForInstall: true }))).toBe(true);
    expect(runFixes(r("tool.herdr", "needs-you", ""))).toBe(true);
    expect(runFixes(r("tool.herdr", "missing", ""))).toBe(false);
    expect(runFixes(r("account.sdm", "missing", ""))).toBe(false);
  });
});

describe("composeForm", () => {
  const NO_SECRETS = { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null };

  const MAC_ANSWERS: Record<string, string> = { sw_vers: "26.0", uname: "arm64", rt: "rt 2.30.0" };

  test("a solo Mac with nothing installed gets the code host, Claude, herdr and Get Chrome", async () => {
    const p = fakeProbes({
      home: "/fake-home",
      now: NOW,
      exec: (argv) => (MAC_ANSWERS[argv[0]!] ? { code: 0, stdout: MAC_ANSWERS[argv[0]!]!, stderr: "" } : { code: 127, stdout: "", stderr: "" }),
    });
    const started = performance.now();
    const form = await composeForm(p, { sections: ["connect"], secrets: NO_SECRETS, orgs: [] });
    const elapsed = performance.now() - started;
    const list = form.sections.connect ?? [];
    expect(list.map((x) => x.id).filter((id) => id !== "tool.app")).toEqual(["forge", "claude", "tool.herdr", "fast-browser"]);
    expect(pick(list, "claude").action).toEqual({ type: "install", label: "Install", tool: "claude", via: "vendor" });
    expect(pick(list, "fast-browser").action).toMatchObject({ label: "Get Chrome" });
    expect(form.continueReady).toBe(false);
    expect(elapsed).toBeLessThan(5000);
  });
});
