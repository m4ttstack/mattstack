import { describe, expect, test } from "bun:test";
import { parseReviewSubmit } from "../review-submit.ts";

describe("parseReviewSubmit", () => {
  const base = { outcome: "comment" as const, summary: "s", comments: [], replies: [] };
  const bad = (over: object, error: string) => expect(parseReviewSubmit({ ...base, ...over })).toEqual({ ok: false, error });

  test("accepts the minimal review", () => {
    expect(parseReviewSubmit(base)).toEqual({ ok: true, input: base });
  });
  test("accepts request_changes", () => {
    expect(parseReviewSubmit({ ...base, outcome: "request_changes" })).toEqual({ ok: true, input: { ...base, outcome: "request_changes" } });
  });
  test("refuses an unknown outcome", () => bad({ outcome: "reject" }, "outcome must be comment, approve or request_changes"));
  test("refuses a blank summary", () => bad({ summary: "  " }, "summary must be a non-empty string"));
  test("refuses a comment without a positive integer line", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 0 }] }, "comments[0]: body, path and a positive integer line are required"));
  test("refuses a bad oldLine", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 1, oldLine: -1 }] }, "comments[0]: invalid oldPath/oldLine"));
  test("refuses a reply that neither posts nor resolves", () =>
    bad({ replies: [{ discussionId: "d1", resolve: false }] }, "replies[0]: a reply needs a body or resolve: true"));
  test("refuses a blank reply body", () =>
    bad({ replies: [{ discussionId: "d1", body: " ", resolve: true }] }, "replies[0]: body must be non-empty when present"));
  test("refuses the same thread twice", () =>
    bad({ replies: [{ discussionId: "d1", resolve: true }, { discussionId: "d1", body: "x", resolve: false }] }, "replies[1]: discussion d1 appears more than once"));
  test("refuses more than 100 comments", () =>
    bad({ comments: Array.from({ length: 101 }, () => ({ body: "b", path: "a.ts", line: 1 })) }, "at most 100 comments and replies in total per review"));
  test("caps comments and replies together at 100", () => {
    const comments = Array.from({ length: 60 }, () => ({ body: "b", path: "a.ts", line: 1 }));
    const replies = (n: number) => Array.from({ length: n }, (_, i) => ({ discussionId: `d${i}`, resolve: true }));
    bad({ comments, replies: replies(41) }, "at most 100 comments and replies in total per review");
    expect(parseReviewSubmit({ ...base, comments, replies: replies(40) }).ok).toBe(true);
  });
  describe("expectedHeadSha", () => {
    const sha40 = "a".repeat(39) + "F";
    const sha64 = "AbCdEf01".repeat(8);
    test("accepts a 40-hex or 64-hex sha in either case and keeps it as given", () => {
      for (const sha of [sha40, sha40.toLowerCase(), sha64, sha64.toUpperCase()]) {
        expect(parseReviewSubmit({ ...base, expectedHeadSha: sha })).toEqual({ ok: true, input: { ...base, expectedHeadSha: sha } });
      }
    });
    test("refuses a short sha, a 41-character string and a non-string", () => {
      for (const expectedHeadSha of ["abc1234", "a".repeat(41), 5]) bad({ expectedHeadSha }, "expectedHeadSha must be a full commit sha");
    });
    test("a missing field leaves expectedHeadSha undefined", () => {
      const r = parseReviewSubmit(base);
      expect(r.ok && r.input.expectedHeadSha).toBeUndefined();
      expect(r.ok && "expectedHeadSha" in r.input).toBe(false);
    });
  });
});
