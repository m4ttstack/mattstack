import { describe, expect, test } from "bun:test";
import { DOCS_MOVES, resolveRedirect, rewriteLink } from "../lib/docs-moves.ts";

describe("resolveRedirect", () => {
  test("old home goes to the rt tab", () => {
    expect(resolveRedirect("/")).toBe("/rt");
  });
  test("reference pages keep their path under /rt", () => {
    expect(resolveRedirect("/reference/git/rebase")).toBe("/rt/reference/git/rebase");
    expect(resolveRedirect("/reference")).toBe("/rt/reference");
  });
  test("a trailing slash resolves like the bare path", () => {
    expect(resolveRedirect("/guides/daemon/")).toBe("/start/daemon");
    expect(resolveRedirect("/reference/cd/")).toBe("/rt/reference/cd");
  });
  test("guides split between tabs", () => {
    expect(resolveRedirect("/guides/common-flags")).toBe("/rt/guides/common-flags");
    expect(resolveRedirect("/guides/teams-and-invites")).toBe("/start/teams");
    expect(resolveRedirect("/guides/gates")).toBe("/skills/gates");
  });
  test("getting-started pages are renamed explicitly", () => {
    expect(resolveRedirect("/getting-started/just-me")).toBe("/start/setup");
    expect(resolveRedirect("/getting-started/first-commands")).toBe("/rt/first-commands");
  });
  test("an unknown path falls back to the docs home", () => {
    expect(resolveRedirect("/nope")).toBe("/");
  });
});

describe("rewriteLink", () => {
  test("keeps the anchor", () => {
    expect(rewriteLink("/reference/git/rebase#flags")).toBe("/rt/reference/git/rebase#flags");
    expect(rewriteLink("/guides/tray#quit")).toBe("/start/menu-bar-app#quit");
  });
  test("leaves external, relative and already-moved links alone", () => {
    expect(rewriteLink("https://github.com/m4ttstack")).toBe("https://github.com/m4ttstack");
    expect(rewriteLink("run")).toBe("run");
    expect(rewriteLink("/rt/reference/cd")).toBe("/rt/reference/cd");
  });
  test("gitq links are prefixed with /gitq, not mapped through rt's moves", () => {
    expect(rewriteLink("/concepts/cascade", { gitq: true })).toBe("/gitq/concepts/cascade");
    expect(rewriteLink("/guides/publish#draft", { gitq: true })).toBe("/gitq/guides/publish#draft");
    expect(rewriteLink("/", { gitq: true })).toBe("/gitq");
    expect(rewriteLink("/gitq/intro", { gitq: true })).toBe("/gitq/intro");
  });
});

test("every from is unique and every to is under a tab folder", () => {
  const froms = DOCS_MOVES.map((m) => m.from);
  expect(new Set(froms).size).toBe(froms.length);
  for (const m of DOCS_MOVES) expect(m.to).toMatch(/^\/(start|apps|rt|gitq|skills)(\/|$)/);
});
