import { describe, expect, test } from "bun:test";

import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { readAdminToken, readPeeredBoards, readStoredAdminToken } from "../board-peers.ts";

const secrets =
  (values: Record<string, string>) =>
  async (key: string): Promise<string | null> =>
    values[key] ?? null;

describe("readPeeredBoards", () => {
  test("the admin token lists every board, canonically", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "Alice " }, { username: "bob" }] }), headers: {} }) });
    const peered = await readPeeredBoards(p, secrets({ switchboardAdminToken: "admin" }), null);
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
    const failing = fakeProbes({ fetch: async () => ({ status: 401, body: "", headers: {} }) });
    expect(await readPeeredBoards(failing, secrets({ switchboardAdminToken: "admin" }), null)).toBeNull();
    const malformed = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: 3 }] }), headers: {} }) });
    expect(await readPeeredBoards(malformed, secrets({ switchboardAdminToken: "admin" }), null)).toBeNull();
  });
});

describe("the admin-only file", () => {
  const listing = () => fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "dev1" }] }), headers: {} }) });
  const adminFile = (value: string | null) => ({ org: "acme", read: async (org: string, key: string) => (org === "acme" && key === "switchboardAdminToken" ? value : null) });

  test("an admin whose token is only in the org's admin-only file lists every board", async () => {
    const p = listing();
    expect([...(await readPeeredBoards(p, secrets({}), adminFile("admin-file")))!]).toEqual(["dev1"]);
    expect(p.calls.fetchInits[0]!.init?.headers?.Authorization).toBe("Bearer admin-file");
  });

  test("readStoredAdminToken never looks at the environment or the board's .env", async () => {
    expect(await readStoredAdminToken(secrets({ switchboardAdminToken: "admin-local" }), adminFile(null))).toBe("admin-local");
    expect(await readStoredAdminToken(secrets({}), adminFile("admin-file"))).toBe("admin-file");
  });

  test("readStoredAdminToken leaves a throwing local read to its caller; readAdminToken swallows it", async () => {
    const throwing = async () => { throw new Error("keychain locked"); };
    await expect(readStoredAdminToken(throwing, adminFile(null))).rejects.toThrow("keychain locked");
    expect(await readAdminToken(fakeProbes({}), throwing, adminFile(null))).toBeNull();
  });

  test("the admin-only file is read before this Mac's own secret", async () => {
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), adminFile("admin-file"))).toBe("admin-file");
  });

  test("a Mac that cannot open it falls through to its own secret", async () => {
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), adminFile(null))).toBe("admin-local");
  });

  test("a reader that throws falls through too", async () => {
    const failing = {
      org: "acme",
      read: async (): Promise<string | null> => {
        throw new Error("sops crashed");
      },
    };
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), failing)).toBe("admin-local");
  });

  test("the environment still comes first", async () => {
    expect(await readAdminToken(fakeProbes({ env: { SWITCHBOARD_ADMIN_TOKEN: "env-admin" } }), secrets({}), adminFile("admin-file"))).toBe("env-admin");
  });
});
