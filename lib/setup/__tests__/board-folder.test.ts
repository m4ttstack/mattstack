import { describe, expect, test } from "bun:test";
import { boardRepoIdentity, planBoardCwds, type BoardCwds } from "../board-folder.ts";

const WIDGETS = "gitlab.example.com/acme/widgets";
const GADGETS = "github.com/acme/gadgets";
const TARGET = "/Users/jane/code/widgets";
const all = (path: string): BoardCwds => ({ review: path, respond: path, doctor: path });
const install = (over: Partial<Parameters<typeof planBoardCwds>[0]>) =>
  planBoardCwds({ current: undefined, rtWrote: undefined, target: TARGET, mode: "install", exists: () => true, isTrackedCheckout: () => true, ...over });

describe("boardRepoIdentity", () => {
  test("the first board project picks its tracked repo by path, whatever the host", () => {
    expect(boardRepoIdentity(["acme/widgets"], [GADGETS, WIDGETS])).toBe(WIDGETS);
  });

  test("no board projects: the first tracked repo, as before", () => {
    expect(boardRepoIdentity(undefined, [GADGETS, WIDGETS])).toBe(GADGETS);
    expect(boardRepoIdentity([], [GADGETS, WIDGETS])).toBe(GADGETS);
    expect(boardRepoIdentity([], [])).toBeNull();
  });

  test("a project two tracked repos match on different hosts picks none", () => {
    expect(boardRepoIdentity(["acme/widgets"], [WIDGETS, "github.com/acme/widgets"])).toBeNull();
  });
});

describe("planBoardCwds", () => {
  test("install: an empty value is written", () => {
    expect(install({ current: undefined })).toEqual({ write: all(TARGET) });
    expect(install({ current: {} })).toEqual({ write: all(TARGET) });
  });

  test("install: the value rt wrote last is replaced", () => {
    expect(install({ current: all("/old/widgets"), rtWrote: all("/old/widgets") })).toEqual({ write: all(TARGET) });
  });

  test("install: a value set by hand is left alone", () => {
    expect(install({ current: all("/custom"), rtWrote: all("/old/widgets") })).toEqual({ leave: "hand-set" });
    expect(install({ current: all("/custom") })).toEqual({ leave: "hand-set" });
  });

  test("install: the target already in place writes nothing", () => {
    expect(install({ current: all(TARGET), rtWrote: all("/old/widgets") })).toEqual({ leave: "current" });
  });

  test("no board repo writes nothing", () => {
    expect(install({ target: null })).toEqual({ leave: "no-repo" });
  });

  test("migration: a missing, gone or untracked value is rewritten; a real tracked checkout is left", () => {
    const migrate = (over: Partial<Parameters<typeof planBoardCwds>[0]>) => install({ mode: "migration", ...over });
    expect(migrate({ current: undefined })).toEqual({ write: all(TARGET) });
    expect(migrate({ current: { review: "/a", respond: "/a" } })).toEqual({ write: all(TARGET) });
    expect(migrate({ current: all("/gone"), exists: (path) => path !== "/gone" })).toEqual({ write: all(TARGET) });
    expect(migrate({ current: all("/notes"), isTrackedCheckout: (path) => path !== "/notes" })).toEqual({ write: all(TARGET) });
    expect(migrate({ current: all("/custom") })).toEqual({ leave: "hand-set" });
    expect(migrate({ current: all(TARGET) })).toEqual({ leave: "current" });
  });
});
