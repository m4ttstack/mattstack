import { describe, expect, test } from "bun:test";
import type { RunDecisionRow } from "../../../packages/rt-client/src/commands.ts";
import {
  buildOutcome,
  mrRole,
  parseMrRef,
  postedFromDecisions,
  readCachedOutcome,
  writeCachedOutcome,
  type CachedOutcome,
} from "../outcome.ts";

const decision = (scope: string, selection: unknown, decidedAt = 1): RunDecisionRow => ({
  contract: "review-post@1", scope, selection: JSON.stringify(selection), decided_by: "console", decided_at: decidedAt,
});

const cached = (over: Partial<CachedOutcome> = {}): CachedOutcome => ({
  iid: 405, state: "merged", mergedAt: 5000, ci: "success", posted: null, checkedAt: 6000, ...over,
});

describe("parseMrRef", () => {
  test("reads a merge request url, a !iid and a bare iid", () => {
    const url = "https://gitlab.acme.test/acme/web/-/merge_requests/405";
    expect(parseMrRef(url)).toEqual({ iid: 405, url });
    expect(parseMrRef(`${url}/diffs?x=1`)).toEqual({ iid: 405, url: `${url}/diffs?x=1` });
    expect(parseMrRef("!405")).toEqual({ iid: 405, url: null });
    expect(parseMrRef(" 405 ")).toEqual({ iid: 405, url: null });
  });

  test("junk, empty and zero are null", () => {
    for (const v of ["", "  ", null, undefined, "not an mr", "!x", "0", "https://example.test/issues/9"]) {
      expect(parseMrRef(v)).toBeNull();
    }
  });
});

describe("mrRole", () => {
  test("ship and watch-ci on a work run own the mr", () => {
    expect(mrRole("ship", "feature")).toBe("own");
    expect(mrRole("watch-ci", "work")).toBe("own");
  });

  test("review and receive-review reviewed it", () => {
    expect(mrRole("review", "review")).toBe("reviewed");
    expect(mrRole("receive-review", "respond")).toBe("reviewed");
  });

  test("ship on a review run is not its own mr; other writers are neither", () => {
    expect(mrRole("ship", "review")).toBeNull();
    expect(mrRole("plan", "feature")).toBeNull();
    expect(mrRole(null, "feature")).toBeNull();
  });
});

describe("postedFromDecisions", () => {
  test("takes the latest post-scoped decision with a string disposition", () => {
    expect(postedFromDecisions([
      decision("post", { findings: 3, disposition: "comment" }, 1),
      decision("post", { findings: 3, disposition: "request changes" }, 2),
      decision("run", { disposition: "ignored" }, 3),
    ])).toBe("request changes");
  });

  test("none, malformed or non-string disposition is null", () => {
    expect(postedFromDecisions([])).toBeNull();
    expect(postedFromDecisions([decision("post", { findings: 1 })])).toBeNull();
    expect(postedFromDecisions([decision("post", { disposition: 4 })])).toBeNull();
    expect(postedFromDecisions([{ ...decision("post", {}), selection: "{nope" }])).toBeNull();
  });
});

describe("buildOutcome", () => {
  test("a running work run with no mr is just its status", () => {
    expect(buildOutcome({ status: "running", work_type: "feature" }, null, [], null)).toEqual({ status: "running" });
  });

  test("a finished work run folds the cached mr state and ci in", () => {
    expect(buildOutcome({ status: "done", work_type: "feature" }, { value: "!405", produced_by: "ship" }, [], cached())).toEqual({
      status: "done",
      mr: { iid: 405, state: "merged", url: null, mergedAt: 5000 },
      ci: "success",
    });
  });

  test("no cache entry leaves the mr state unknown", () => {
    expect(buildOutcome({ status: "done", work_type: "feature" }, { value: "!405", produced_by: "ship" }, [], null)).toEqual({
      status: "done",
      mr: { iid: 405, state: "unknown", url: null },
    });
  });

  test("a cache entry for a different iid is ignored", () => {
    const out = buildOutcome({ status: "done", work_type: "feature" }, { value: "!406", produced_by: "ship" }, [], cached());
    expect(out.mr).toEqual({ iid: 406, state: "unknown", url: null });
    expect(out.ci).toBeUndefined();
  });

  test("a review run reports the reviewed mr and its post, never an own mr", () => {
    const url = "https://gitlab.acme.test/acme/web/-/merge_requests/77";
    const out = buildOutcome(
      { status: "done", work_type: "review" },
      { value: url, produced_by: "review" },
      [decision("post", { findings: 3, disposition: "request changes" })],
      cached({ iid: 77, state: "merged" }),
    );
    expect(out).toEqual({ status: "done", reviewed: { iid: 77, url, posted: "request changes" } });
    expect(out.mr).toBeUndefined();
  });

  test("a review run without a post decision falls back to the cached post", () => {
    const out = buildOutcome(
      { status: "done", work_type: "review" },
      { value: "!77", produced_by: "review" },
      [],
      cached({ iid: 77, posted: "approve" }),
    );
    expect(out.reviewed).toEqual({ iid: 77, url: null, posted: "approve" });
  });

  test("a review run with neither is posted null", () => {
    const out = buildOutcome({ status: "done", work_type: "review" }, { value: "!77", produced_by: "review" }, [], null);
    expect(out.reviewed).toEqual({ iid: 77, url: null, posted: null });
  });

  test("an unknown run status reads as done", () => {
    expect(buildOutcome({ status: "weird", work_type: "feature" }, null, [], null).status).toBe("done");
    expect(buildOutcome({ status: "failed", work_type: "feature" }, null, [], null).status).toBe("failed");
    expect(buildOutcome({ status: "abandoned", work_type: "feature" }, null, [], null).status).toBe("abandoned");
  });

  test("an mr field written by another stage yields no mr", () => {
    expect(buildOutcome({ status: "done", work_type: "feature" }, { value: "!405", produced_by: "plan" }, [], cached())).toEqual({ status: "done" });
  });
});

describe("cached outcome kv", () => {
  test("round-trips by run id; a missing run is null", () => {
    expect(readCachedOutcome("20260101-000000-zzzz")).toBeNull();
    writeCachedOutcome("20260101-000000-zzzz", cached());
    expect(readCachedOutcome("20260101-000000-zzzz")).toEqual(cached());
  });
});
