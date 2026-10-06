import { describe, expect, test } from "bun:test";

import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { readPeeredBoards } from "../board-peers.ts";

const secrets =
  (values: Record<string, string>) =>
  async (key: string): Promise<string | null> =>
    values[key] ?? null;

describe("readPeeredBoards", () => {
  test("the admin token lists every board, canonically", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "Alice " }, { username: "bob" }] }), headers: {} }) });
    const peered = await readPeeredBoards(p, secrets({ switchboardAdminToken: "admin" }));
    expect([...peered!].sort()).toEqual(["alice", "bob"]);
    expect(p.calls.fetch[0]).toEndWith("/boards");
  });

  test("a peered board's own token lists its peers", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["carol"] }), headers: {} }) });
    const peered = await readPeeredBoards(p, secrets({ switchboardToken: "board" }));
    expect([...peered!]).toEqual(["carol"]);
    expect(p.calls.fetch[0]).toEndWith("/peers");
  });

  test("a board that keeps its token in its own .env still asks, the way the board reads it", async () => {
    const p = fakeProbes({
      home: "/home/x",
      files: { "/home/x/.mattstack/board/.env": "SWITCHBOARD_TOKEN=from-env\n" },
      fetch: async () => ({ status: 200, body: JSON.stringify({ peers: ["dana"] }), headers: {} }),
    });
    const peered = await readPeeredBoards(p, secrets({}));
    expect([...peered!]).toEqual(["dana"]);
    expect(p.calls.fetchInits[0]?.init?.headers?.Authorization).toBe("Bearer from-env");
  });

  test("no token, an error or a malformed body all read as unknown", async () => {
    expect(await readPeeredBoards(fakeProbes({}), secrets({}))).toBeNull();
    const failing = fakeProbes({ fetch: async () => ({ status: 401, body: "", headers: {} }) });
    expect(await readPeeredBoards(failing, secrets({ switchboardAdminToken: "admin" }))).toBeNull();
    const malformed = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: 3 }] }), headers: {} }) });
    expect(await readPeeredBoards(malformed, secrets({ switchboardAdminToken: "admin" }))).toBeNull();
  });
});
