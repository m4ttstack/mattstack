import { describe, expect, test } from "bun:test";

import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { pickAdminToken, readAdminToken, readPeeredBoards, readStoredAdminToken, revokeBoard } from "../board-peers.ts";
import { orgClones, orgToken } from "./org-token-fixtures.ts";

const secrets =
  (values: Record<string, string>) =>
  async (key: string): Promise<string | null> =>
    values[key] ?? null;

const HOME = "/fake-home";
const ORG_FILE = orgToken("a");
const ORG_LOCAL = orgToken("b");
const ORG_ENV = orgToken("c");
const MASTER = "the-relay-operators-own-token";

/** A Mac with exactly one org clone, so tokens kept on this Mac count. */
const oneOrg = (opts: Parameters<typeof fakeProbes>[0] = {}) => {
  const clones = orgClones(HOME, "acme");
  return fakeProbes({ home: HOME, ...opts, dirs: { ...clones.dirs, ...opts.dirs }, files: { ...clones.files, ...opts.files } });
};

const twoOrgs = (opts: Parameters<typeof fakeProbes>[0] = {}) => {
  const clones = orgClones(HOME, "acme", "beta");
  return fakeProbes({ home: HOME, ...opts, dirs: { ...clones.dirs, ...opts.dirs }, files: { ...clones.files, ...opts.files } });
};

const thunk = (value: string | null, calls?: string[], name = "own") => async (): Promise<string | null> => {
  calls?.push(name);
  return value;
};

describe("pickAdminToken", () => {
  test("pickAdminToken prefers the file's org token over own sources", async () => {
    const calls: string[] = [];
    expect(await pickAdminToken(ORG_FILE, [thunk(ORG_LOCAL, calls)], true)).toBe(ORG_FILE);
    expect(calls).toEqual([]);
  });

  test("uses an own org token on a one-org Mac", async () => {
    expect(await pickAdminToken(null, [thunk(null), thunk(ORG_LOCAL)], true)).toBe(ORG_LOCAL);
    expect(await pickAdminToken("", [thunk(ORG_LOCAL)], true)).toBe(ORG_LOCAL);
  });

  test("never uses an own master", async () => {
    expect(await pickAdminToken(null, [thunk(MASTER), thunk(MASTER)], true)).toBeNull();
    expect(await pickAdminToken(null, [thunk(MASTER), thunk(ORG_LOCAL)], true)).toBe(ORG_LOCAL);
  });

  test("uses the file's master only when nothing else gives an org token", async () => {
    expect(await pickAdminToken(MASTER, [thunk(null), thunk("another-master")], true)).toBe(MASTER);
    expect(await pickAdminToken(MASTER, [thunk(ORG_LOCAL)], true)).toBe(ORG_LOCAL);
    expect(await pickAdminToken(MASTER, [], false)).toBe(MASTER);
  });

  test("on a two-org Mac ignores own sources", async () => {
    const calls: string[] = [];
    expect(await pickAdminToken(null, [thunk(ORG_LOCAL, calls)], false)).toBeNull();
    expect(await pickAdminToken(MASTER, [thunk(ORG_LOCAL, calls)], false)).toBe(MASTER);
    expect(await pickAdminToken(ORG_FILE, [thunk(ORG_LOCAL, calls)], false)).toBe(ORG_FILE);
    expect(calls).toEqual([]);
  });

  test("does not call a later own thunk once an org token is found", async () => {
    const calls: string[] = [];
    const throwing = async (): Promise<string | null> => {
      calls.push("later");
      throw new Error("keychain locked");
    };
    expect(await pickAdminToken(null, [thunk(ORG_ENV, calls, "first"), throwing], true)).toBe(ORG_ENV);
    expect(calls).toEqual(["first"]);
  });

  test("a read that throws before any org token is found reaches the caller", async () => {
    const throwing = async (): Promise<string | null> => {
      throw new Error("keychain locked");
    };
    await expect(pickAdminToken(MASTER, [throwing, thunk(ORG_LOCAL)], true)).rejects.toThrow("keychain locked");
  });
});

describe("readPeeredBoards", () => {
  test("the admin token lists every board, canonically", async () => {
    const p = oneOrg({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "Alice " }, { username: "bob" }] }), headers: {} }) });
    const peered = await readPeeredBoards(p, secrets({ switchboardAdminToken: ORG_LOCAL }), null);
    expect([...peered!].sort()).toEqual(["alice", "bob"]);
    expect(p.calls.fetch[0]).toEndWith("/boards");
  });

  test("a peered board's own token lists its peers", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["carol"] }), headers: {} }) });
    const peered = await readPeeredBoards(p, secrets({ switchboardToken: "board" }), null);
    expect([...peered!]).toEqual(["carol"]);
    expect(p.calls.fetch[0]).toEndWith("/peers");
  });

  test("a board that keeps its token in its own .env still asks, the way the board reads it", async () => {
    const p = fakeProbes({
      home: "/home/x",
      files: { "/home/x/.mattstack/board/.env": "SWITCHBOARD_TOKEN=from-env\n" },
      fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["dana"] }), headers: {} }),
    });
    const peered = await readPeeredBoards(p, secrets({}), null);
    expect([...peered!]).toEqual(["dana"]);
    expect(p.calls.fetchInits[0]?.init?.headers?.Authorization).toBe("Bearer from-env");
  });

  test("no token, an error or a malformed body all read as unknown", async () => {
    expect(await readPeeredBoards(fakeProbes({}), secrets({}), null)).toBeNull();
    const failing = oneOrg({ fetch: async () => ({ status: 401, body: "", headers: {} }) });
    expect(await readPeeredBoards(failing, secrets({ switchboardAdminToken: ORG_LOCAL }), null)).toBeNull();
    expect(failing.calls.fetch[0]).toEndWith("/boards");
    const malformed = oneOrg({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: 3 }] }), headers: {} }) });
    expect(await readPeeredBoards(malformed, secrets({ switchboardAdminToken: ORG_LOCAL }), null)).toBeNull();
    expect(malformed.calls.fetch[0]).toEndWith("/boards");
  });

  test("a master kept on this Mac is never sent: the board's own token asks instead", async () => {
    const p = oneOrg({
      env: { SWITCHBOARD_ADMIN_TOKEN: MASTER },
      fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["erin"] }), headers: {} }),
    });
    const peered = await readPeeredBoards(p, secrets({ switchboardAdminToken: MASTER, switchboardToken: "board" }), null);
    expect([...peered!]).toEqual(["erin"]);
    expect(p.calls.fetchInits.map((c) => c.init?.headers?.Authorization)).toEqual(["Bearer board"]);
  });
});

describe("the admin-only file", () => {
  const listing = (opts: Parameters<typeof fakeProbes>[0] = {}) => oneOrg({ ...opts, fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "dev1" }] }), headers: {} }) });
  const adminFile = (value: string | null) => ({ org: "acme", read: async (org: string, key: string) => (org === "acme" && key === "switchboardAdminToken" ? value : null) });

  test("an admin whose token is only in the org's admin-only file lists every board", async () => {
    const p = listing();
    expect([...(await readPeeredBoards(p, secrets({}), adminFile(ORG_FILE)))!]).toEqual(["dev1"]);
    expect(p.calls.fetchInits[0]!.init?.headers?.Authorization).toBe(`Bearer ${ORG_FILE}`);
  });

  test("readStoredAdminToken never looks at the environment or the board's .env", async () => {
    expect(await readStoredAdminToken(secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(null))).toBe(ORG_LOCAL);
    expect(await readStoredAdminToken(secrets({}), adminFile(ORG_FILE))).toBe(ORG_FILE);
  });

  test("readStoredAdminToken leaves a throwing local read to its caller; readAdminToken swallows it", async () => {
    const throwing = async () => { throw new Error("keychain locked"); };
    await expect(readStoredAdminToken(throwing, adminFile(null))).rejects.toThrow("keychain locked");
    expect(await readAdminToken(oneOrg(), throwing, adminFile(null))).toBeNull();
  });

  test("readStoredAdminToken on a two-org Mac reads only the file", async () => {
    const calls: string[] = [];
    const local = async (key: string) => {
      calls.push(key);
      return ORG_LOCAL;
    };
    expect(await readStoredAdminToken(local, adminFile(null), false)).toBeNull();
    expect(await readStoredAdminToken(local, adminFile(ORG_FILE), false)).toBe(ORG_FILE);
    expect(calls).toEqual([]);
  });

  test("the admin-only file is read before this Mac's own secret", async () => {
    expect(await readAdminToken(oneOrg(), secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(ORG_FILE))).toBe(ORG_FILE);
  });

  test("a Mac that cannot open it falls through to its own secret", async () => {
    expect(await readAdminToken(oneOrg(), secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(null))).toBe(ORG_LOCAL);
  });

  test("a reader that throws falls through too", async () => {
    const failing = {
      org: "acme",
      read: async (): Promise<string | null> => {
        throw new Error("sops crashed");
      },
    };
    expect(await readAdminToken(oneOrg(), secrets({ switchboardAdminToken: ORG_LOCAL }), failing)).toBe(ORG_LOCAL);
  });

  test("among this Mac's own sources the environment comes first, then the board's .env, then rt's secret", async () => {
    const boardEnv = { [`${HOME}/.mattstack/board/.env`]: `SWITCHBOARD_ADMIN_TOKEN=${ORG_ENV}\n` };
    expect(await readAdminToken(oneOrg({ env: { SWITCHBOARD_ADMIN_TOKEN: ORG_ENV }, files: boardEnv }), secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(null))).toBe(ORG_ENV);
    expect(await readAdminToken(oneOrg({ files: boardEnv }), secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(null))).toBe(ORG_ENV);
  });

  test("a master in the environment, the board's .env or rt's secret is never used, and the file's master is", async () => {
    const boardEnv = { [`${HOME}/.mattstack/board/.env`]: `SWITCHBOARD_ADMIN_TOKEN=${MASTER}\n` };
    const p = oneOrg({ env: { SWITCHBOARD_ADMIN_TOKEN: MASTER }, files: boardEnv });
    expect(await readAdminToken(p, secrets({ switchboardAdminToken: MASTER }), adminFile(null))).toBeNull();
    expect(await readAdminToken(p, secrets({ switchboardAdminToken: MASTER }), adminFile("the-file-master"))).toBe("the-file-master");
  });
});

describe("a Mac with two org clones", () => {
  const adminFile = (value: string | null) => ({ org: "beta", read: async (org: string, key: string) => (org === "beta" && key === "switchboardAdminToken" ? value : null) });

  test("never uses an org token kept on this Mac, for either org", async () => {
    const p = twoOrgs({ env: { SWITCHBOARD_ADMIN_TOKEN: ORG_ENV } });
    expect(await readAdminToken(p, secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(null))).toBeNull();
    expect(await readAdminToken(p, secrets({ switchboardAdminToken: ORG_LOCAL }), adminFile(ORG_FILE))).toBe(ORG_FILE);
  });

  test("remove reads the named org's file alone, and with none says it holds no token", async () => {
    const p = twoOrgs({ env: { SWITCHBOARD_ADMIN_TOKEN: ORG_ENV }, fetch: async () => ({ status: 404, body: "", headers: {} }) });
    expect(await revokeBoard(p, secrets({ switchboardAdminToken: ORG_LOCAL }), "dev1", adminFile(null))).toEqual({ kind: "no-admin-token" });
    expect(p.calls.fetch).toEqual([]);
  });

  test("status reads the named org's file alone", async () => {
    const p = twoOrgs({ fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["dev2"] }), headers: {} }) });
    await readPeeredBoards(p, secrets({ switchboardAdminToken: ORG_LOCAL, switchboardToken: "board" }), adminFile(null));
    expect(p.calls.fetchInits.map((c) => c.init?.headers?.Authorization)).toEqual(["Bearer board"]);
  });
});
