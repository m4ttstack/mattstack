import { describe, expect, test } from "bun:test";
import { row, type Row } from "../contract.ts";
import { composeForm, inviteRows, restoreRows, type FormRow, type InviteInputs } from "../form.ts";
import { intentPath, type InvitePointer } from "../intent.ts";
import type { PrepareRecord } from "../prepare.ts";
import { tokenCreateLink, tokenField } from "../token-create.ts";
import { fakeProbes } from "./fakes.ts";

const GITLAB = { provider: "gitlab" as const, host: "gitlab.com" };
const GITHUB = { provider: "github" as const, host: "github.com" };

function accountRow(id: string, status: Row["status"], detail: string): Row {
  return row({ id, kind: "account", title: id, why: "w", required: true, status, detail });
}

function prepare(over: Partial<PrepareRecord & { running: boolean }> = {}): PrepareRecord & { running: boolean } {
  return { stage: "macos", startedAt: "2026-10-30T09:00:00.000Z", pid: 4242, items: ["apple-clt"], failed: [], running: false, ...over };
}

function inputs(over: Partial<InviteInputs> = {}): InviteInputs {
  return {
    rows: new Map([["account.gitlab", accountRow("account.gitlab", "missing", "No GitLab account connected yet")]]),
    forge: GITLAB,
    forgeLogin: "janedoe",
    ghSignedIn: false,
    cltInstalled: true,
    prepare: null,
    confirmedHost: null,
    ...over,
  };
}

function pick(list: FormRow[], id: string): FormRow {
  const found = list.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id} in ${list.map((r) => r.id).join(", ")}`);
  return found;
}

describe("inviteRows", () => {
  test("a GitLab team always asks for a token, with Create token", () => {
    for (const ghSignedIn of [false, true]) {
      const token = pick(inviteRows(inputs({ ghSignedIn })), "forge.token");
      expect(token.title).toBe("GitLab");
      expect(token.subtext).toBe("Lets mattstack reach the team's repo and open MRs");
      expect(token.state).toBe("todo");
      expect(token.detail).toBe("No GitLab account connected yet");
      expect(token.action).toEqual({
        type: "connect",
        label: "Connect",
        integration: "gitlab",
        fields: [tokenField("gitlab", "member")],
        create: { label: "Create token", url: tokenCreateLink("gitlab", "member", "gitlab.com").url },
      });
      expect(token.optional).toBe(false);
    }
  });

  test("an invite's self-hosted GitLab host is shown, never confirmed for the joiner", () => {
    for (const host of ["gitlab.example.com", "--json"]) {
      const token = pick(inviteRows(inputs({ forge: { provider: "gitlab", host } })), "forge.token");
      expect(token.action).toMatchObject({ type: "connect", integration: "gitlab" });
      expect(token.action && "verb" in token.action).toBe(false);
      expect(token.action && "create" in token.action).toBe(false);
      expect(token.detail).toBe(`Connect ${host} from the terminal first`);
    }
  });

  test("Create token opens a self-hosted GitLab once the member confirmed that host", () => {
    const forge = { provider: "gitlab" as const, host: "gitlab.example.com" };
    const confirmed = pick(inviteRows(inputs({ forge, confirmedHost: "gitlab.example.com" })), "forge.token");
    expect(confirmed.action).toMatchObject({ create: { label: "Create token", url: tokenCreateLink("gitlab", "member", "gitlab.example.com").url } });
    expect(confirmed.detail).toBe("No GitLab account connected yet");
    const other = pick(inviteRows(inputs({ forge, confirmedHost: "gitlab.acme.dev" })), "forge.token");
    expect(other.action && "create" in other.action).toBe(false);
  });

  test("a GitHub team with a gh sign-in asks for nothing", () => {
    const rows = new Map([["account.github", accountRow("account.github", "ready", "Signed in through the gh CLI as janedoe")]]);
    expect(inviteRows(inputs({ forge: GITHUB, rows, ghSignedIn: true }))).toEqual([]);
  });

  test("a GitHub team without gh asks for a token", () => {
    const rows = new Map([["account.github", accountRow("account.github", "missing", "No GitHub account connected yet")]]);
    const token = pick(inviteRows(inputs({ forge: GITHUB, rows, ghSignedIn: false })), "forge.token");
    expect(token.title).toBe("GitHub");
    expect(token.subtext).toBe("Lets mattstack reach the team's repo and open PRs");
    expect(token.action).toMatchObject({ type: "connect", integration: "github", create: { label: "Create token", url: tokenCreateLink("github", "member", null).url } });
  });

  test("while Command Line Tools install in the background the invite section holds Join with a busy row", () => {
    const list = inviteRows(inputs({ cltInstalled: false, prepare: prepare({ running: true }) }));
    expect(list.map((r) => r.id)).toEqual(["tool.clt", "forge.token"]);
    const clt = pick(list, "tool.clt");
    expect(clt.state).toBe("busy");
    expect(clt.detail).toBe("Installing Command Line Tools…");
    expect(clt.action).toBeNull();
    expect(clt.watch).toBe(true);
    expect(clt.optional).toBe(false);
  });

  test("a failed background install offers Install with the reason", () => {
    const failed = prepare({ endedAt: "2026-10-30T09:20:00.000Z", failed: [{ tool: "apple-clt", detail: "softwareupdate found no Command Line Tools to install" }] });
    const clt = pick(inviteRows(inputs({ cltInstalled: false, prepare: failed })), "tool.clt");
    expect(clt.state).toBe("todo");
    expect(clt.detail).toBe("softwareupdate found no Command Line Tools to install");
    expect(clt.action).toEqual({ type: "install", label: "Install", tool: "apple-clt", via: "apple-clt" });
  });

  test("with git ready and a token stored every row is done", () => {
    const rows = new Map([["account.gitlab", accountRow("account.gitlab", "ready", "GitLab token works")]]);
    const list = inviteRows(inputs({ rows }));
    expect(list.map((r) => r.id)).toEqual(["forge.token"]);
    expect(list.every((r) => r.state === "done")).toBe(true);
    expect(list[0]!.detail).toBe("Connected as janedoe");
    expect(list[0]!.action).toBeNull();
  });
});

describe("restoreRows", () => {
  test("the restore section holds Restore while Command Line Tools install", () => {
    const list = restoreRows({ cltInstalled: false, prepare: prepare({ running: true }) });
    expect(list.map((r) => [r.id, r.state])).toEqual([["tool.clt", "busy"]]);
  });

  test("with git ready the restore section is empty", () => {
    expect(restoreRows({ cltInstalled: true, prepare: prepare({ running: true }) })).toEqual([]);
  });
});

describe("composeForm", () => {
  const POINTER: InvitePointer = {
    v: 2,
    team: "mithrandir",
    name: "Mithrandir",
    remote: "https://gitlab.com/acme/mithrandir-org.git",
    owner: "Jane Doe",
    forge: "gitlab.com",
    createdAt: "2026-10-30T08:00:00.000Z",
    username: "janedoe",
    teams: ["widgets"],
  };
  const NO_SECRETS = { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null };

  test("the invite section reads the invite's forge and never the tools group", async () => {
    const p = fakeProbes({
      home: "/fake-home",
      files: { [intentPath("/fake-home")]: JSON.stringify({ v: 1, at: POINTER.createdAt, mode: "join", join: { id: "a".repeat(32), keyB64: "k", pointer: POINTER } }) },
      exec: (argv) => (argv[0] === "xcode-select" || argv[0] === "git" ? { code: 0, stdout: "git version 2.50.1", stderr: "" } : { code: 1, stdout: "", stderr: "" }),
    });
    const form = await composeForm(p, { sections: ["invite"], secrets: NO_SECRETS, orgs: [] });
    expect(Object.keys(form.sections)).toEqual(["invite"]);
    expect(form.sections.invite?.map((r) => [r.id, r.state])).toEqual([["forge.token", "todo"]]);
    expect(form.team).toEqual({ slug: "mithrandir", name: "Mithrandir", invitedBy: "Jane Doe" });
    expect(p.calls.exec.some((argv) => argv[0] === "fast-browser")).toBe(false);
  });

  test("a self-hosted invite's token row never passes the pointer's host to connect", async () => {
    const pointer = { ...POINTER, remote: "https://gitlab.example.com/acme/mithrandir-org.git", forge: "gitlab.example.com" };
    const p = fakeProbes({
      home: "/fake-home",
      files: { [intentPath("/fake-home")]: JSON.stringify({ v: 1, at: pointer.createdAt, mode: "join", join: { id: "a".repeat(32), keyB64: "k", pointer } }) },
      exec: (argv) => (argv[0] === "xcode-select" || argv[0] === "git" ? { code: 0, stdout: "git version 2.50.1", stderr: "" } : { code: 1, stdout: "", stderr: "" }),
    });
    const form = await composeForm(p, { sections: ["invite"], secrets: NO_SECRETS, orgs: [] });
    const token = pick(form.sections.invite!, "forge.token");
    expect(token.detail).toBe("Connect gitlab.example.com from the terminal first");
    expect(token.action && "create" in token.action).toBe(false);
    expect(token.action && "verb" in token.action).toBe(false);
  });

  test("the restore section reads only this Mac's rows", async () => {
    const p = fakeProbes({ home: "/fake-home", exec: () => ({ code: 2, stdout: "", stderr: "" }) });
    const form = await composeForm(p, { sections: ["restore"], secrets: NO_SECRETS, orgs: [] });
    expect(form.sections.restore?.map((r) => [r.id, r.state])).toEqual([["tool.clt", "todo"]]);
    expect(p.calls.exec.some((argv) => argv[0] === "gh")).toBe(false);
  });
});
