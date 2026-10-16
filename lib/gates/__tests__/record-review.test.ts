import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateQuestion } from "../../../packages/rt-client/src/commands.ts";
import type { GateCtxSource } from "../ctx.ts";
import { type AnswersMap, postSelection, respondPlanSelection, respondPostSelection } from "../record.ts";
import { buildReviewSource } from "../review-source.ts";

const ROOT = join(import.meta.dir, "../../../plugins/mattstack/attachments/review");
const RR = join(ROOT, "receive-review/tests/fixtures");
const RV = join(ROOT, "review/tests/fixtures");
const load = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

const planSource = (): GateCtxSource => load(RR, "plan-source.json");
const postSource = (): GateCtxSource => load(RR, "post-source.json");
const reviewSource = (): GateCtxSource => buildReviewSource(load(RV, "findings-v3.json"), load(RV, "extras.json"));

function storedFrom(source: GateCtxSource, dropContextOf: string[] = []): GateQuestion[] {
  return (source.questions as Record<string, any>[]).map((q) => {
    const stored: GateQuestion = { id: q.id, label: q.label, multi: q.multi, options: q.options };
    if (q.context !== undefined && !dropContextOf.includes(q.id)) stored.context = "rendered";
    return stored;
  });
}

describe("respondPlanSelection", () => {
  test("keys threads by the id in the value and keeps a verbatim reply as reply", () => {
    const a: AnswersMap = { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "approve" };
    const { selection, rows } = respondPlanSelection(a, { source: planSource() });
    expect(JSON.stringify(selection)).toBe(JSON.stringify({ threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }));
    expect(rows.map((r) => r.gate1)).toEqual(["fix", "reply"]);
    expect(rows[0]).toEqual({
      threadId: "T1",
      file: "queue/enqueue.ts:88",
      verdict: "valid",
      recommended: "fix",
      gate1: "fix",
      reply: "enqueue() now drops non-retryable jobs; added the missing check and a test.",
    });
    expect(rows[1]).toMatchObject({ threadId: "T2", verdict: "pushback", recommended: "reply", gate1: "reply" });
  });

  test("a textless reply on a direction card is an override", () => {
    const { selection, rows } = respondPlanSelection({ "thread-1": "reply:T1" }, { source: planSource() });
    expect(selection).toEqual({ threads: { T1: "reply" }, overrides: ["T1"] });
    expect(rows[0]?.gate1).toBe("override");
  });

  test("a note makes a verbatim reply an override and lands in notes", () => {
    const { selection } = respondPlanSelection({ "thread-2": { value: "reply:T2", note: "tone" } }, { source: planSource() });
    expect(JSON.stringify(selection)).toBe(JSON.stringify({ threads: { T2: "reply" }, overrides: ["T2"], notes: { T2: "tone" } }));
  });

  test("a question named in contextDropped is an override", () => {
    const { selection } = respondPlanSelection({ "thread-2": "reply:T2" }, { source: planSource(), contextDropped: ["thread-2"] });
    expect(selection).toEqual({ threads: { T2: "reply" }, overrides: ["T2"] });
  });

  test("contextDropped true drops every question", () => {
    const { selection } = respondPlanSelection({ "thread-2": "reply:T2" }, { source: planSource(), contextDropped: true });
    expect(selection).toEqual({ threads: { T2: "reply" }, overrides: ["T2"] });
  });

  test("a stored row lacking the context the source had is an override", () => {
    const source = planSource();
    const { selection } = respondPlanSelection({ "thread-2": "reply:T2" }, { source, storedQuestions: storedFrom(source, ["thread-2"]) });
    expect(selection).toEqual({ threads: { T2: "reply" }, overrides: ["T2"] });
    const kept = respondPlanSelection({ "thread-2": "reply:T2" }, { source, storedQuestions: storedFrom(source) });
    expect(kept.selection).toEqual({ threads: { T2: "reply" } });
  });

  test("with no source every textless reply is an override", () => {
    const { selection, rows } = respondPlanSelection({ "thread-2": "reply:T2" }, {});
    expect(selection).toEqual({ threads: { T2: "reply" }, overrides: ["T2"] });
    expect(rows[0]).toEqual({ threadId: "T2", file: "unknown", verdict: "unknown", recommended: "unknown", gate1: "override", reply: "none" });
  });

  test("an edited reply goes in texts and is not an override", () => {
    const { selection, rows } = respondPlanSelection({ "thread-2": { value: "reply:T2", text: "edited" } }, { source: planSource() });
    expect(selection).toEqual({ threads: { T2: "reply" }, texts: { T2: "edited" } });
    expect(rows[0]).toMatchObject({ gate1: "reply", reply: "edited" });
  });

  test("the stored row supplies the label and recommended option when there is no source", () => {
    const stored = storedFrom(planSource());
    const { rows } = respondPlanSelection({ "thread-1": "skip:T1" }, { storedQuestions: stored });
    expect(rows[0]).toMatchObject({ file: "queue/enqueue.ts:88", recommended: "fix", gate1: "skip", reply: "none" });
  });

  test("a label ending (recommended) marks the recommended verb", () => {
    const stored: GateQuestion[] = [
      { id: "thread-1", label: "a.ts", multi: false, options: [{ value: "reply:X", label: "Reply (Recommended)" }, { value: "fix:X", label: "fix" }] },
    ];
    const { rows } = respondPlanSelection({ "thread-1": "fix:X" }, { storedQuestions: stored });
    expect(rows[0]?.recommended).toBe("reply");
  });

  test("threads and rows follow thread-<n> order and ignore other keys", () => {
    const a: AnswersMap = { "thread-10": "skip:T10", foo: "bar", "thread-2": "fix:T2", "thread-1": "fix:T1" };
    const { selection, rows } = respondPlanSelection(a, { source: planSource() });
    expect(Object.keys(selection.threads as object)).toEqual(["T1", "T2", "T10"]);
    expect(rows.map((r) => r.threadId)).toEqual(["T1", "T2", "T10"]);
  });

  test("the key order is threads, texts, overrides, notes, code-changes", () => {
    const a: AnswersMap = {
      "code-changes": "revise",
      "thread-1": { value: "reply:T1", note: "softer" },
      "thread-2": { value: "reply:T2", text: "mine" },
    };
    const { selection } = respondPlanSelection(a, { source: planSource() });
    expect(Object.keys(selection)).toEqual(["threads", "texts", "overrides", "notes", "code-changes"]);
  });
});

describe("respondPostSelection", () => {
  test("every offered thread gets an entry; text rides a post, held is added", () => {
    const a: AnswersMap = { "thread-1": { value: ["post:T1", "resolve:T1"], text: "x" }, "thread-2": [], next: "proceed" };
    const selection = respondPostSelection(a, { source: postSource(), held: ["T1"] });
    expect(JSON.stringify(selection)).toBe(
      JSON.stringify({ threads: { T1: { post: true, resolve: true, text: "x" }, T2: { post: false, resolve: false } }, held: ["T1"] }),
    );
  });

  test("an unanswered offered thread records both false and an empty held is left out", () => {
    const selection = respondPostSelection({ "thread-1": ["post:T1"] }, { source: postSource(), held: [] });
    expect(selection).toEqual({ threads: { T1: { post: true, resolve: false }, T2: { post: false, resolve: false } } });
  });

  test("text without a post is dropped, a note is kept", () => {
    const a: AnswersMap = { "thread-1": { value: ["resolve:T1"], text: "x", note: "later" } };
    const selection = respondPostSelection(a, { source: postSource() });
    expect(JSON.stringify((selection.threads as Record<string, unknown>).T1)).toBe(
      JSON.stringify({ post: false, resolve: true, note: "later" }),
    );
  });

  test("offered threads come from the stored options when there is no source", () => {
    const stored = storedFrom(postSource());
    const selection = respondPostSelection({ "thread-2": ["post:T2"] }, { storedQuestions: stored });
    expect(selection).toEqual({ threads: { T1: { post: false, resolve: false }, T2: { post: true, resolve: false } } });
  });

  test("thread ids come from option values, never the question position", () => {
    const stored: GateQuestion[] = [
      { id: "thread-1", label: "x", multi: true, options: [{ value: "post:a:b", label: "post" }, { value: "resolve:a:b", label: "resolve" }] },
    ];
    expect(respondPostSelection({ "thread-1": ["post:a:b", "resolve:a:b"] }, { storedQuestions: stored })).toEqual({
      threads: { "a:b": { post: true, resolve: true } },
    });
    const source = postSource();
    const swapped: AnswersMap = { "thread-1": ["post:T2"] };
    expect(respondPostSelection(swapped, { source })).toEqual({
      threads: { T1: { post: false, resolve: false }, T2: { post: true, resolve: false } },
    });
  });

  test("a retired-shape post records unchanged", () => {
    const a = { replies: ["T1"], disposition: "resolve-addressed" } as unknown as AnswersMap;
    expect(respondPostSelection(a, { source: postSource() })).toBe(a);
    const chunked = { "replies-1": ["T1"], disposition: "post" } as unknown as AnswersMap;
    expect(respondPostSelection(chunked, {})).toBe(chunked);
  });
});

describe("postSelection", () => {
  test("unions findings, builds replies from the carryover card and restores from the skipped card", () => {
    const a: AnswersMap = {
      "thread-1": ["post:a1b2"],
      "findings-1": ["f4", "f2"],
      "findings-2": ["f5"],
      "skipped-1": ["restore:r1-f3"],
      outcome: "comment",
      next: "proceed",
    };
    expect(JSON.stringify(postSelection(a, { source: reviewSource() }))).toBe(
      JSON.stringify({
        findings: ["f4", "f2", "f5"],
        disposition: "comment",
        replies: [{ discussionId: "a1b2", resolve: false, body: "Confirmed, thanks." }],
        restored: [{ id: "r1-f3", changed: true }],
      }),
    );
  });

  test("an edited body wins, a resolve-only pick has no body, an unpicked thread no entry", () => {
    const a: AnswersMap = {
      "thread-1": { value: ["post:a1b2", "resolve:a1b2"], text: "mine" },
      "thread-2": ["resolve:c3d4"],
      "thread-3": [],
      "skipped-1": ["restore:r2-f1", "restore:zz"],
      outcome: "approve",
    };
    expect(postSelection(a, { source: reviewSource() })).toEqual({
      findings: [],
      disposition: "approve",
      replies: [
        { discussionId: "a1b2", resolve: true, body: "mine" },
        { discussionId: "c3d4", resolve: true },
      ],
      restored: [
        { id: "r2-f1", changed: false },
        { id: "zz", changed: false },
      ],
    });
  });

  test("a handed decision normalizes outcome to disposition", () => {
    expect(postSelection({ findings: ["f1"], outcome: "approve" } as unknown as AnswersMap, {})).toEqual({
      findings: ["f1"],
      disposition: "approve",
    });
    const replies = [{ discussionId: "d", resolve: true }];
    const restored = [{ id: "r", title: "t", body: "b", changed: false }];
    const handed = { findings: [], outcome: "comment", replies, restored } as unknown as AnswersMap;
    expect(postSelection(handed, {})).toEqual({ findings: [], disposition: "comment", replies, restored });
  });

  test("a handed outcome carrying a note records its value as the disposition", () => {
    const handed = { findings: ["f1"], outcome: { value: "approve", note: "ship it" } } as unknown as AnswersMap;
    expect(postSelection(handed, {})).toEqual({ findings: ["f1"], disposition: "approve" });
  });

  test("a legacy tiers answer gives levels", () => {
    expect(postSelection({ tiers: ["Critical"], outcome: "comment" }, {})).toEqual({ levels: ["Critical"], disposition: "comment" });
  });
});
