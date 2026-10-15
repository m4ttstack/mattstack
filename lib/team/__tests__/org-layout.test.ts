import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { ORG_MARKER_REL } from "../org-marker.ts";
import { ORG_LAYOUT, READABLE_LAYOUTS } from "../org-marker.ts";
import { layoutAbove, layoutSentence, orgLayoutState, pickedCloneReady, orgLayoutWaitingError, updateSentence, WAITING_SENTENCE } from "../org-layout.ts";

const H = "/h";
const orgs = `${H}/.mattstack/orgs`;
const marker = (role: "org" | "team", org: string, layout?: number) => JSON.stringify({ role, org, ...(layout !== undefined ? { layout } : {}) });

function home(clones: Record<string, { marker: string; orgStore?: boolean }>) {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = { [orgs]: Object.keys(clones) };
  for (const [name, c] of Object.entries(clones)) {
    files[`${orgs}/${name}/.git/config`] = "[remote \"origin\"]\n";
    files[`${orgs}/${name}/${ORG_MARKER_REL}`] = c.marker;
    if (c.orgStore) files[`${orgs}/${name}/mattstack/org/settings.org.jsonc`] = "{}";
  }
  return fakeProbes({ home: H, files, dirs });
}

describe("orgLayoutState", () => {
  test("none without a clone", () => {
    expect(orgLayoutState(fakeProbes({ home: H }))).toEqual({ kind: "none" });
  });
  test("ready for a converted clone", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 3), orgStore: true } }))).toEqual({ kind: "ready", slug: "acme", layout: 3 });
  });
  test("waiting for the one-team layout moved under orgs/", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("team", "acme") } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 1 });
  });
  test("waiting for a layout above ORG_LAYOUT", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 5), orgStore: true } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 5 });
  });
  test("a layout 2 marker reads waiting, a layout 3 marker reads ready", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 2), orgStore: true } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 2 });
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 3), orgStore: true } }))).toEqual({ kind: "ready", slug: "acme", layout: 3 });
  });
  test("a marker with no layout reads waiting", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme"), orgStore: true } })).kind).toBe("waiting");
  });
  test("a one-team marker beside an org store is still waiting", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("team", "acme"), orgStore: true } })).kind).toBe("waiting");
  });
  test("an org marker without its store is waiting on layout 2", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme") } }))).toEqual({ kind: "waiting", slug: "acme", dir: `${orgs}/acme`, layout: 2 });
  });
  test("the first clone by name decides", () => {
    const p = home({ zeta: { marker: marker("team", "zeta") }, acme: { marker: marker("org", "acme", 3), orgStore: true } });
    expect(orgLayoutState(p)).toEqual({ kind: "ready", slug: "acme", layout: 3 });
  });
  test("a store-less waiting clone sorting first does not hide a ready one", () => {
    const p = home({ aaa: { marker: marker("team", "aaa") }, bbb: { marker: marker("org", "bbb", 3), orgStore: true } });
    expect(orgLayoutState(p)).toEqual({ kind: "ready", slug: "bbb", layout: 3 });
  });
  test("a store-holding waiting clone sorting first wins over a later ready one", () => {
    const p = home({ aaa: { marker: marker("org", "aaa", 5), orgStore: true }, bbb: { marker: marker("org", "bbb", 3), orgStore: true } });
    expect(orgLayoutState(p)).toEqual({ kind: "waiting", slug: "aaa", dir: `${orgs}/aaa`, layout: 5 });
  });
  test("a folder without .git/config or without a marker is not a clone", () => {
    const p = fakeProbes({ home: H, dirs: { [orgs]: ["stray", "half"] }, files: { [`${orgs}/half/.git/config`]: "" } });
    expect(orgLayoutState(p)).toEqual({ kind: "none" });
  });
});

describe("sentences", () => {
  test("below ORG_LAYOUT is the waiting sentence", () => {
    expect(layoutSentence({ kind: "waiting", slug: "acme", dir: "/x", layout: 1 })).toBe(WAITING_SENTENCE);
  });
  test("above names both numbers", () => {
    expect(updateSentence(5)).toBe("Your org uses layout 5 and this app reads up to 4. Update the app.");
    expect(layoutSentence({ kind: "waiting", slug: "acme", dir: "/x", layout: 5 })).toBe(updateSentence(5));
  });
  test("the error carries the sentence and no next command", () => {
    const err = orgLayoutWaitingError({ kind: "waiting", slug: "acme", dir: "/x", layout: 1 });
    expect(err.code).toBe("org-layout-waiting");
    expect(err.message).toBe(WAITING_SENTENCE);
    expect(err.next).toBeUndefined();
  });
});

describe("layout 4 with layout 3 readable", () => {
  test("a layout 4 clone reads ready on layout 4", () => {
    expect(orgLayoutState(home({ acme: { marker: marker("org", "acme", 4), orgStore: true } }))).toEqual({ kind: "ready", slug: "acme", layout: 4 });
  });
  test("the readable layouts contain ORG_LAYOUT", () => {
    expect(READABLE_LAYOUTS).toContain(ORG_LAYOUT);
  });
  test("layouts 3 and 4 are both ready; 2 and 5 wait", () => {
    expect(pickedCloneReady({ layout: 3, hasStore: true })).toBe(true);
    expect(pickedCloneReady({ layout: 4, hasStore: true })).toBe(true);
    expect(pickedCloneReady({ layout: 2, hasStore: true })).toBe(false);
    expect(pickedCloneReady({ layout: 5, hasStore: true })).toBe(false);
    expect(pickedCloneReady({ layout: 4, hasStore: false })).toBe(false);
  });
  test("a tip on layout 4 is not above this rt; 5 is", () => {
    expect(layoutAbove({ code: 0, stdout: '{"role":"org","org":"acme","layout":4}', stderr: "" })).toBeNull();
    expect(layoutAbove({ code: 0, stdout: '{"role":"org","org":"acme","layout":5}', stderr: "" })).toEqual({ layout: 5 });
  });
});
