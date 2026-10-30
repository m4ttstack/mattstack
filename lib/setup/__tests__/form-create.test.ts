import { describe, expect, test } from "bun:test";
import { row, type Row } from "../contract.ts";
import { composeForm, createRows, type CreateInputs, type FormRow } from "../form.ts";
import type { PrepareRecord } from "../prepare.ts";
import { tokenCreateLink, tokenField } from "../token-create.ts";
import { fakeProbes } from "./fakes.ts";

const GITLAB = { provider: "gitlab" as const, host: "gitlab.example.com" };
const GITHUB = { provider: "github" as const, host: "github.com" };

function accountRow(id: string, status: Row["status"], detail: string): Row {
  return row({ id, kind: "account", title: id, why: "w", required: true, status, detail });
}

function prepare(over: Partial<PrepareRecord & { running: boolean }> = {}): PrepareRecord & { running: boolean } {
  return { stage: "macos", startedAt: "2026-10-30T09:00:00.000Z", pid: 4242, items: ["apple-clt"], failed: [], running: false, ...over };
}

function inputs(over: Partial<CreateInputs> = {}): CreateInputs {
  return {
    rows: new Map([["account.gitlab", accountRow("account.gitlab", "missing", "No GitLab account connected yet")]]),
    forge: GITLAB,
    ghSignedIn: false,
    cltInstalled: true,
    prepare: null,
    ...over,
  };
}

function pick(list: FormRow[], id: string): FormRow {
  const found = list.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id} in ${list.map((r) => r.id).join(", ")}`);
  return found;
}

describe("createRows", () => {
  test("the create section asks for an owner-scoped token with Create token", () => {
    const token = pick(createRows(inputs()), "forge.token");
    expect(token.title).toBe("GitLab");
    expect(token.subtext).toBe("Lets mattstack reach the team's repo and open MRs");
    expect(token.state).toBe("todo");
    expect(token.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "gitlab",
      fields: [tokenField("gitlab", "owner")],
      create: { label: "Create token", url: tokenCreateLink("gitlab", "owner", "gitlab.example.com").url },
    });

    const github = pick(createRows(inputs({ forge: GITHUB, rows: new Map([["account.github", accountRow("account.github", "missing", "No GitHub account connected yet")]]) })), "forge.token");
    expect(github.subtext).toBe("Lets mattstack reach the team's repo and open PRs");
    expect(github.action).toMatchObject({ fields: [tokenField("github", "owner")], create: { label: "Create token", url: tokenCreateLink("github", "owner", "github.com").url } });
  });

  test("GitHub with gh signed in asks for no token", () => {
    const rows = new Map([["account.github", accountRow("account.github", "ready", "Signed in through the gh CLI as janedoe")]]);
    expect(createRows(inputs({ forge: GITHUB, rows, ghSignedIn: true }))).toEqual([]);
  });

  test("Create team waits for Command Line Tools", () => {
    const list = createRows(inputs({ cltInstalled: false, prepare: prepare({ running: true }) }));
    expect(list.map((r) => [r.id, r.state])).toEqual([["tool.clt", "busy"], ["forge.token", "todo"]]);
  });

  test("a stored token reads as connected", () => {
    const rows = new Map([["account.gitlab", accountRow("account.gitlab", "ready", "GitLab token works")]]);
    expect(createRows(inputs({ rows })).map((r) => [r.id, r.state, r.detail])).toEqual([["forge.token", "done", "Connected"]]);
  });
});

describe("composeForm create section", () => {
  const NO_SECRETS = { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null };

  test("reads the chosen forge and host, and only this Mac's rows and the accounts", async () => {
    const p = fakeProbes({
      home: "/fake-home",
      exec: (argv) => (argv[0] === "xcode-select" || argv[0] === "git" ? { code: 0, stdout: "git version 2.50.1", stderr: "" } : { code: 1, stdout: "", stderr: "" }),
    });
    const form = await composeForm(p, { sections: ["create"], create: { forge: "gitlab", host: "gitlab.example.com" }, secrets: NO_SECRETS, orgs: [] });
    expect(Object.keys(form.sections)).toEqual(["create"]);
    const token = pick(form.sections.create!, "forge.token");
    expect(token.action).toMatchObject({ create: { url: tokenCreateLink("gitlab", "owner", "gitlab.example.com").url } });
    expect(form.stage).toBeNull();
    expect(p.calls.exec.some((argv) => argv[0] === "fast-browser")).toBe(false);
  });

  test("a GitLab create with no host reads gitlab.com", async () => {
    const p = fakeProbes({ home: "/fake-home", exec: () => ({ code: 0, stdout: "git version 2.50.1", stderr: "" }) });
    const form = await composeForm(p, { sections: ["create"], create: { forge: "gitlab", host: null }, secrets: NO_SECRETS, orgs: [] });
    expect(pick(form.sections.create!, "forge.token").action).toMatchObject({ create: { url: tokenCreateLink("gitlab", "owner", "gitlab.com").url } });
  });
});
