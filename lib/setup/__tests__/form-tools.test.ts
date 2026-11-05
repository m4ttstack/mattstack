import { describe, expect, test } from "bun:test";
import { finalizePlan, row, type Action, type Plan, type Row } from "../contract.ts";
import { onlyTeamToolsBlock, toolsForm, toolsRows, unackedTools, type FormRow, type ToolsInputs } from "../form.ts";
import type { PrepareRecord } from "../prepare-record.ts";
import type { ToolRequirement } from "../requirements.ts";

const NOW = new Date("2026-10-30T10:00:00.000Z");

const DOPPLER: ToolRequirement = { name: "doppler", why: "Pulls your dev secrets", connect: { integration: "doppler" } };
const ACME_LOGIN: ToolRequirement = { name: "acme-api", why: "", connect: { verb: ["acme-api", "login"], label: "Log in" } };
const WIDGET: ToolRequirement = { name: "widget-cli", why: "Builds the widgets" };

const INSTALL: Action = { type: "install", label: "Install", tool: "widget-cli", via: "brew" };
const DOWNLOAD: Action = { type: "open-url", label: "Download", url: "https://example.com/widget-cli" };
const STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Install widget-cli", "Then re-run rt setup status"] };

function r(id: string, status: Row["status"], detail: string, over: Partial<Row> = {}): Row {
  return row({ id, kind: id.startsWith("account.") ? "account" : "tool", title: id.replace("tool.team.", ""), why: `why ${id}`, required: true, status, detail, ...over });
}

function plan(rows: Row[]): Plan {
  return finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, [{ id: "tools", title: "Tools", rows }], NOW);
}

function inputs(rows: Row[], over: Partial<ToolsInputs> = {}): ToolsInputs {
  return { plan: plan(rows), tools: [], signIn: [], unacked: [], prepare: null, logins: {}, ...over };
}

const widgetMissing = (action: Action = INSTALL) => r("tool.team.widget-cli", "missing", "widget-cli is not installed", { action });

const RUNNING: PrepareRecord & { running: boolean } = { stage: "accounts", startedAt: "2026-10-30T09:50:00.000Z", pid: 4242, items: [], failed: [], running: true };
const FAILED = { ...RUNNING, running: false, failed: [{ tool: "widget-cli", detail: "brew said no" }] };

function only(i: ToolsInputs): FormRow {
  const rows = toolsRows(i);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("onlyTeamToolsBlock", () => {
  test("team tool rows and their own accounts are the team-tool set", () => {
    expect(onlyTeamToolsBlock(plan([widgetMissing()]), [])).toBe(true);
    expect(onlyTeamToolsBlock(plan([r("tool.team.doppler", "missing", "no"), r("account.doppler", "invalid", "no")]), [DOPPLER])).toBe(true);
  });

  test("a finish-gated team tool counts", () => {
    expect(onlyTeamToolsBlock(plan([{ ...widgetMissing(), finishGated: true, waivable: false }]), [])).toBe(true);
  });

  test("an account no sign-in tool owns does not", () => {
    expect(onlyTeamToolsBlock(plan([widgetMissing(), r("account.slack", "missing", "no")]), [])).toBe(false);
    expect(onlyTeamToolsBlock(plan([r("account.doppler", "invalid", "no")]), [])).toBe(false);
  });

  test("a pack row does not", () => {
    expect(onlyTeamToolsBlock(plan([widgetMissing(), r("pack.widgets", "missing", "no")]), [])).toBe(false);
  });

  test("nothing blocking leaves no blocker outside the set", () => {
    expect(onlyTeamToolsBlock(plan([r("tool.team.widget-cli", "ready", "widget-cli 1.0.0")]), [])).toBe(true);
  });
});

describe("unackedTools", () => {
  const tools = [WIDGET, DOPPLER, { ...ACME_LOGIN, optional: true }];

  test("a told name outside acked and still required", () => {
    expect(unackedTools({ pending: [], told: ["widget-cli", "doppler"], acked: ["doppler"] }, tools)).toEqual(["widget-cli"]);
  });

  test("a pending name was never told", () => {
    expect(unackedTools({ pending: ["widget-cli"], told: [], acked: [] }, tools)).toEqual([]);
  });

  test("a removed or optional tool drops out", () => {
    expect(unackedTools({ pending: [], told: ["gone", "acme-api"], acked: [] }, tools)).toEqual([]);
  });
});

describe("toolsRows", () => {
  test("the tools section draws an Install row for a missing tool", () => {
    expect(only(inputs([widgetMissing()]))).toMatchObject({ id: "tool.team.widget-cli", title: "widget-cli", subtext: "why tool.team.widget-cli", state: "todo", detail: "", action: INSTALL, waiting: "Installing…", optional: false, watch: true });
  });

  test("only a row whose action is an install carries the Installing line", () => {
    expect(only(inputs([widgetMissing(DOWNLOAD)])).waiting).toBeNull();
    expect(only(inputs([widgetMissing(STEPS)])).waiting).toBeNull();
    const signedOut = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "invalid", "Not signed in to Doppler", { required: false })];
    expect(only(inputs(signedOut, { signIn: [DOPPLER], unacked: ["doppler"] })).waiting).toBeNull();
    const missing = r("tool.team.doppler", "missing", "doppler is not installed", { action: { ...INSTALL, tool: "doppler" } });
    expect(only(inputs([missing, r("account.doppler", "invalid", "no", { required: false })], { signIn: [DOPPLER] })).waiting).toBe("Installing…");
  });

  test("a row whose detail would repeat its button carries an empty detail, never null, which the tray's String field cannot decode", () => {
    const signedOut = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "invalid", "Not signed in to Doppler", { required: false })];
    expect(only(inputs(signedOut, { signIn: [DOPPLER], unacked: ["doppler"] })).detail).toBe("");
    expect(only(inputs([r("tool.team.doppler", "missing", "doppler is not installed", { action: { ...INSTALL, tool: "doppler" } }), r("account.doppler", "invalid", "no", { required: false })], { signIn: [DOPPLER] })).detail).toBe("");
    expect(only(inputs([r("tool.team.acme-api", "ready", "acme-api 1.0.0")], { signIn: [ACME_LOGIN], unacked: ["acme-api"] })).detail).toBe("");
  });

  test("a real fault keeps its text", () => {
    expect(only(inputs([r("tool.team.widget-cli", "error", "widget-cli did not answer in time")])).detail).toBe("widget-cli did not answer in time");
    expect(only(inputs([r("tool.team.widget-cli", "invalid", "widget-cli 1.0.0 is older than 2.0.0", { action: { ...INSTALL, label: "Upgrade" } })])).detail).toBe("widget-cli 1.0.0 is older than 2.0.0");
    const unreachable = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "error", "doppler did not answer", { required: false })];
    expect(only(inputs(unreachable, { signIn: [DOPPLER], unacked: ["doppler"] })).detail).toBe("doppler did not answer");
  });

  test("a tool with no sign-in and no brew offers Download or Show steps", () => {
    expect(only(inputs([widgetMissing(DOWNLOAD)])).action).toEqual(DOWNLOAD);
    expect(only(inputs([widgetMissing(STEPS)])).action).toEqual(STEPS);
  });

  test("a sign-in tool, once installed, offers its sign-in", () => {
    const rows = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "invalid", "Not signed in to Doppler", { required: false })];
    const drawn = only(inputs(rows, { signIn: [DOPPLER], unacked: ["doppler"] }));
    expect(drawn).toMatchObject({ id: "tool.team.doppler", title: "Doppler", subtext: "Pulls your dev secrets", state: "todo", action: { type: "run", label: "Sign in", verb: ["setup", "doppler", "connect"] }, optional: false });
  });

  test("a sign-in tool still missing offers its install, then its signed-in row is done", () => {
    const missing = r("tool.team.doppler", "missing", "doppler is not installed", { action: { ...INSTALL, tool: "doppler" } });
    expect(only(inputs([missing, r("account.doppler", "invalid", "no", { required: false })], { signIn: [DOPPLER] })).action).toMatchObject({ type: "install", tool: "doppler" });
    const signed = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "ready", "Signed in to Doppler", { required: false })];
    expect(only(inputs(signed, { signIn: [DOPPLER], unacked: ["doppler"] }))).toMatchObject({ id: "tool.team.doppler", state: "done", detail: "Signed in to Doppler" });
  });

  test("a verb sign-in has no check, so its row never holds Done", () => {
    const drawn = only(inputs([r("tool.team.acme-api", "ready", "acme-api 1.0.0")], { signIn: [ACME_LOGIN], unacked: ["acme-api"] }));
    expect(drawn).toMatchObject({ id: "tool.team.acme-api", state: "todo", optional: true, action: { type: "run", label: "Log in", verb: ["acme-api", "login"] } });
    expect(toolsForm([drawn]).allDone).toBe(true);
  });

  test("an install under way reads busy", () => {
    expect(only(inputs([widgetMissing()], { prepare: { ...RUNNING, items: ["widget-cli"] } }))).toMatchObject({ state: "busy", action: null });
  });

  test("a failed install reads failed: Retry runs the same install, Show steps carries the manual route", () => {
    const drawn = only(inputs([widgetMissing()], { prepare: FAILED, tools: [{ ...WIDGET, install: { url: "https://example.com/widget-cli" } }] }));
    expect(drawn).toMatchObject({ state: "todo", tone: "failed", detail: "brew said no", action: { ...INSTALL, label: "Retry" }, waiting: "Installing…", optional: false });
    expect(drawn.secondary).toEqual({ type: "steps", label: "Show steps…", steps: ["Download it from https://example.com/widget-cli"] });
  });

  test("a press failure reads failed, ahead of a background failure", () => {
    const pressed = { ...FAILED, pressFailed: [{ tool: "widget-cli", detail: "brew said no again" }] };
    expect(only(inputs([widgetMissing()], { prepare: pressed }))).toMatchObject({ tone: "failed", detail: "brew said no again", action: { label: "Retry" } });
    const pressOnly = { ...RUNNING, running: false, pressFailed: [{ tool: "widget-cli", detail: "brew said no again" }] };
    expect(only(inputs([widgetMissing()], { prepare: pressOnly }))).toMatchObject({ tone: "failed", detail: "brew said no again" });
  });

  test("a press failure on a row with no install to re-run keeps its text and action", () => {
    const pressOnly = { ...RUNNING, running: false, pressFailed: [{ tool: "widget-cli", detail: "brew said no again" }] };
    expect(only(inputs([widgetMissing(DOWNLOAD)], { prepare: pressOnly }))).toMatchObject({ detail: "brew said no again", action: DOWNLOAD });
  });

  test("a link that is not https never becomes the manual route", () => {
    const http = only(inputs([widgetMissing()], { prepare: FAILED, tools: [{ ...WIDGET, install: { url: "http://example.com/widget-cli" } }] }));
    expect("secondary" in http).toBe(false);
  });

  test("a failed sign-in tool's install reads failed too", () => {
    const missing = r("tool.team.doppler", "missing", "doppler is not installed", { action: { ...INSTALL, tool: "doppler" } });
    const prepare = { ...FAILED, failed: [{ tool: "doppler", detail: "brew said no" }] };
    expect(only(inputs([missing, r("account.doppler", "invalid", "no", { required: false })], { signIn: [DOPPLER], prepare }))).toMatchObject({ tone: "failed", detail: "brew said no", action: { label: "Retry", tool: "doppler" } });
  });

  test("a failed tool with no steps to show has Retry alone", () => {
    const drawn = only(inputs([widgetMissing()], { prepare: FAILED, tools: [WIDGET] }));
    expect(drawn).toMatchObject({ tone: "failed", action: { label: "Retry" } });
    expect("secondary" in drawn).toBe(false);
    expect("secondary" in only(inputs([widgetMissing()], { prepare: FAILED }))).toBe(false);
  });

  test("a failed row holds Done", () => {
    expect(toolsForm(toolsRows(inputs([widgetMissing()], { prepare: FAILED }))).allDone).toBe(false);
  });

  test("a failure on a row with no install to re-run keeps its text and its action, with no failed mark", () => {
    const drawn = only(inputs([widgetMissing(DOWNLOAD)], { prepare: FAILED }));
    expect(drawn).toMatchObject({ detail: "brew said no", action: DOWNLOAD });
    expect(drawn.tone).toBeUndefined();
  });

  test("a stale failure on a tool that is now installed marks nothing", () => {
    const rows = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.doppler", "invalid", "Not signed in to Doppler", { required: false })];
    const drawn = only(inputs(rows, { signIn: [DOPPLER], unacked: ["doppler"], prepare: { ...FAILED, failed: [{ tool: "doppler", detail: "brew said no" }] } }));
    expect(drawn).toMatchObject({ detail: "", action: { label: "Sign in" } });
    expect(drawn.tone).toBeUndefined();
    const pressed = only(inputs(rows, { signIn: [DOPPLER], unacked: ["doppler"], prepare: { ...RUNNING, running: false, pressFailed: [{ tool: "doppler", detail: "brew said no" }] } }));
    expect(pressed).toMatchObject({ detail: "", action: { label: "Sign in" } });
    expect(pressed.tone).toBeUndefined();
  });

  test("a resolved told tool stays as a done row beside the one still missing", () => {
    const rows = [r("tool.team.doppler", "ready", "doppler 3.70.0", { title: "doppler" }), widgetMissing()];
    const drawn = toolsRows(inputs(rows, { unacked: ["doppler"] }));
    expect(drawn.map((x) => [x.id, x.state])).toEqual([["tool.team.doppler", "done"], ["tool.team.widget-cli", "todo"]]);
    expect(drawn[0]).toMatchObject({ detail: "doppler 3.70.0", action: null, optional: false });
  });

  test("a ready tool nobody was told about, and other rows, stay off the section", () => {
    const rows = [r("tool.team.doppler", "ready", "doppler 3.70.0"), r("account.slack", "missing", "no"), r("tool.herdr", "missing", "no")];
    expect(toolsRows(inputs(rows))).toEqual([]);
  });
});

describe("toolsForm", () => {
  const open = (id: string): FormRow => ({ id, title: id, subtext: "", state: "todo", detail: "", action: INSTALL, waiting: null, watch: true, optional: false });
  const done = (id: string): FormRow => ({ ...open(id), state: "done", action: null });

  test("one row", () => {
    expect(toolsForm([open("a")])).toEqual({ heading: "One new tool for your team", allDone: false });
  });

  test("two rows, one of them done", () => {
    expect(toolsForm([done("a"), open("b")])).toEqual({ heading: "2 new tools for your team", allDone: false });
  });

  test("all done", () => {
    expect(toolsForm([done("a"), done("b")])).toEqual({ heading: "You're all set", allDone: true });
  });
});
