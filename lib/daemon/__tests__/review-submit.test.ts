import { describe, expect, test } from "bun:test";
import { parseReviewSubmit } from "../review-submit.ts";

describe("parseReviewSubmit", () => {
  const base = { outcome: "comment" as const, summary: "s", comments: [], replies: [] };
  const bad = (over: object, error: string) => expect(parseReviewSubmit({ ...base, ...over })).toEqual({ ok: false, error });

  test("accepts the minimal review", () => {
    expect(parseReviewSubmit(base)).toEqual({ ok: true, input: base });
  });
  test("refuses anything but comment or approve", () => bad({ outcome: "request_changes" }, "outcome must be comment or approve"));
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
});
