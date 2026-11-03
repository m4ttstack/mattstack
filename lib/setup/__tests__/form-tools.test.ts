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
  return { plan: plan(rows), signIn: [], unacked: [], prepare: null, logins: {}, ...over };
}

const widgetMissing = (action: Action = INSTALL) => r("tool.team.widget-cli", "missing", "widget-cli is not installed", { action });

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
    expect(only(inputs([widgetMissing()]))).toMatchObject({ id: "tool.team.widget-cli", title: "widget-cli", subtext: "why tool.team.widget-cli", state: "todo", detail: "widget-cli is not installed", action: INSTALL, optional: false, watch: true });
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

  test("an install under way reads busy and a failed one keeps its reason", () => {
    const running: PrepareRecord & { running: boolean } = { stage: "accounts", startedAt: "2026-10-30T09:50:00.000Z", pid: 4242, items: ["widget-cli"], failed: [], running: true };
    expect(only(inputs([widgetMissing()], { prepare: running }))).toMatchObject({ state: "busy", action: null });
    const failed = { ...running, items: [], running: false, failed: [{ tool: "widget-cli", detail: "brew said no" }] };
    expect(only(inputs([widgetMissing()], { prepare: failed }))).toMatchObject({ state: "todo", detail: "brew said no", action: INSTALL });
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
