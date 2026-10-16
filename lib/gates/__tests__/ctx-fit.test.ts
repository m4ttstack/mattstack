import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FitResult, fitOpen, proseOpen } from "../ctx.ts";
import { utf8Bytes } from "../jq.ts";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURE: Record<string, string> = {
  plan: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/plan-source.json",
  post: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/post-source.json",
  review: "plugins/mattstack/attachments/review/receive-review/tests/fixtures/review-source.json",
};
type Src = Record<string, any> & { questions: any[] };
const load = (name: string): Src => JSON.parse(readFileSync(join(ROOT, FIXTURE[name]!), "utf8"));
const PLAN = "plan";
const POST = "post";
const REVIEW = "review";

function mutated(fixture: string, f: (s: Src) => void): Src {
  const s = load(fixture);
  f(s);
  return s;
}

const parsed = (r: FitResult, i: number): any => JSON.parse(r.questions[i]!.context as string);
const qctx = (r: FitResult, i: number): string => r.questions[i]!.context as string;
const contextOrNull = (q: Record<string, unknown>): unknown => q.context ?? null;
const dropEntryFields = (s: Src, fields: string[]): Src => {
  for (const q of s.questions) for (const e of q.context?.findings ?? []) for (const f of fields) delete e[f];
  return s;
};

describe("structured, under budget: contexts round-trip exactly", () => {
  const src = load(PLAN);
  const out = fitOpen(load(PLAN));

  test("plan fit is structured", () => expect(out.mode).toBe("structured"));
  test("plan fit trims nothing", () => expect(out.trimmed).toEqual([]));
  test("gate context round-trips", () => expect(JSON.parse(out.context!)).toEqual(src.context));
  test("question contexts round-trip", () => {
    const got = out.questions.map((q) => {
      const c = contextOrNull(q);
      return c ? JSON.parse(c as string) : c;
    });
    expect(got).toEqual(src.questions.map(contextOrNull));
  });
  test("options untouched", () =>
    expect(out.questions.map((q) => q.options)).toEqual(src.questions.map((q: Src) => q.options)));
  test("bytes is the shared-budget total", () => {
    const qs = out.questions.filter((q) => q.context != null).map((q) => utf8Bytes(q.context as string));
    expect(out.bytes).toBe(utf8Bytes(out.context!) + qs.reduce((a, b) => a + b, 0));
  });
  test("structured open fits", () => expect(out.fits).toBe(true));

  test("post fit is structured", () => expect(fitOpen(load(POST)).mode).toBe("structured"));
  test("reply contexts round-trip", () => {
    const r = fitOpen(load(POST));
    const s = load(POST);
    expect([parsed(r, 0), parsed(r, 1)]).toEqual([s.questions[0].context, s.questions[1].context]);
  });

  test("unknown keys pass through", () => {
    const r = fitOpen(
      mutated(PLAN, (s) => {
        s.questions[0].context.extra = { x: 1 };
        s.context.future = "later";
      }),
    );
    expect(`${JSON.stringify(parsed(r, 0).extra)}|${JSON.parse(r.context!).future}`).toBe('{"x":1}|later');
  });

  test("reply.kind none needs no text", () =>
    expect(fitOpen(mutated(PLAN, (s) => (s.questions[0].context.reply = { kind: "none" }))).mode).toBe("structured"));

  test("output keys are in the script's order", () =>
    expect(Object.keys(out)).toEqual(["mode", "trimmed", "context", "questions", "bytes", "fits"]));
});

describe("over budget: points from the longest thread, then notes, never reply.text", () => {
  test("trim drops the longest thread's points first", () => {
    const r = fitOpen(load(PLAN), 1000);
    expect(r.trimmed).toEqual(["thread-1:points"]);
    const c = parsed(r, 0);
    expect(c.claim.points).toBeUndefined();
    expect(c.claim.summary.length).toBeGreaterThan(0);
    expect(r.bytes).toBeLessThan(1000);
  });

  test("notes go after every thread's points", () => {
    const r = fitOpen(load(PLAN), 900);
    expect(r.trimmed).toEqual(["thread-1:points", "thread-2:note"]);
    const s = load(PLAN);
    expect([parsed(r, 0).reply.text, parsed(r, 1).reply.text]).toEqual([
      s.questions[0].context.reply.text,
      s.questions[1].context.reply.text,
    ]);
  });

  describe("no fit falls back to prose for the whole gate", () => {
    const r = fitOpen(load(PLAN), 700);
    const s = load(PLAN);
    test("mode is prose", () => expect(r.mode).toBe("prose"));
    test("prose fallback flattens the gate context", () =>
      expect(r.context!.split(" · ")[0]).toBe("Responding to renee's review"));
    test("prose fallback keeps every reply text whole", () => {
      expect(qctx(r, 0)).toContain(s.questions[0].context.reply.text);
      expect(qctx(r, 1)).toContain(s.questions[1].context.reply.text);
    });
    test("prose fallback flattens the trimmed source when the full prose is over", () =>
      expect(r.trimmed).toEqual(["thread-1:points", "thread-2:note", "thread-1:note"]));
    test("prose fallback fits", () => expect(r.fits && r.bytes < 700).toBe(true));
  });

  test("untrimmed prose wins when it fits", () => {
    const r = fitOpen(
      mutated(PLAN, (s) => delete s.questions[0].context.claim.points),
      700,
    );
    expect(`${JSON.stringify(r.trimmed)}|${/confirmed against the checkout/.test(qctx(r, 0))}`).toBe("[]|true");
  });

  test("an open no prose can fit reports that it does not fit", () =>
    expect(fitOpen(load(PLAN), 300).fits).toBe(false));
});

describe("prose flattening: exact text", () => {
  const plan = proseOpen(load(PLAN));
  test("prose gate line", () =>
    expect(plan.context).toBe(
      "Responding to renee's review · round 1 · 2 threads, 1 blocking · 1 valid, 1 pushback · fresh-context adjudicated",
    ));
  test("prose thread with points and a direction", () =>
    expect(qctx(plan, 0)).toBe(`[BLOCKING] renee: the retry queue re-enqueues a job that already failed permanently.
- permanent failures carry retryable: false, but enqueue() never reads it
- violates the queue-contract doc; the other three callers all check it
Verdict: valid -- confirmed against the checkout
Reply direction: enqueue() now drops non-retryable jobs; added the missing check and a test.`));
  test("prose thread with a verbatim reply", () =>
    expect(qctx(plan, 1)).toBe(`[NON-BLOCKING] renee: nit: the README should call this a backoff, not a delay.
Verdict: pushback -- the doc describes a fixed delay; there is no backoff in the code
Will post as reply: the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay; backoff would describe behavior the code does not have.`));
  test("prose leaves context-free questions alone", () => expect("context" in plan.questions[2]!).toBe(false));

  const post = proseOpen(load(POST));
  test("prose post line", () =>
    expect(post.context).toBe("Posting replies to renee's review · round 1 · 2 replies · fix pushed ab12cd3"));
  test("prose fix reply line", () =>
    expect(qctx(post, 0)).toBe(
      "queue/enqueue.ts:88 FIX · ab12cd3: Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test.",
    ));
  test("prose reply line", () =>
    expect(qctx(post, 1)).toBe(
      "queue/README.md:12 REPLY: the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay.",
    ));
  test("three or more fixes collapse", () => {
    const r = proseOpen(mutated(POST, (s) => (s.context.fixes = [{ sha: "a1" }, { sha: "b2" }, { sha: "c3" }])));
    expect(r.context).toBe("Posting replies to renee's review · round 1 · 2 replies · 3 fixes pushed");
  });
});

describe("review-post: review@1 gate, findings@1 per findings-* question", () => {
  const src = load(REVIEW);
  const out = fitOpen(load(REVIEW));
  const FULL = out.bytes;

  test("review fit is structured", () => expect(out.mode).toBe("structured"));
  test("review contexts round-trip", () => {
    expect(JSON.parse(out.context!)).toEqual(src.context);
    const got = out.questions.map((q) => {
      const c = contextOrNull(q);
      return c ? JSON.parse(c as string) : c;
    });
    expect(got).toEqual(src.questions.map(contextOrNull));
  });
  test("review options untouched", () =>
    expect(out.questions.map((q) => q.options)).toEqual(src.questions.map((q: Src) => q.options)));

  test("optional review and entry fields may all be absent", () => {
    const r = fitOpen(
      mutated(REVIEW, (s) => {
        delete s.questions[0].context.findings[2].disposition;
        delete s.questions[0].context.findings[3].fix;
        s.context = { "gate-ctx": "review@1", readiness: "yes", summary: "clean enough.", findings: {} };
      }),
    );
    expect(r.mode).toBe("structured");
  });

  test("trim drops the largest evidence first", () =>
    expect(fitOpen(load(REVIEW), FULL).trimmed).toEqual(["findings-1:f2:evidence"]));

  const NOEV = fitOpen(dropEntryFields(load(REVIEW), ["evidence"])).bytes;
  test("every evidence goes, largest first, before any fix", () =>
    expect(fitOpen(load(REVIEW), NOEV + 1).trimmed).toEqual([
      "findings-1:f2:evidence",
      "findings-2:f5:evidence",
      "findings-1:f4:evidence",
    ]));
  const atNoev = fitOpen(load(REVIEW), NOEV);
  test("then the largest fix", () =>
    expect(atNoev.trimmed).toEqual([
      "findings-1:f2:evidence",
      "findings-2:f5:evidence",
      "findings-1:f4:evidence",
      "findings-1:f3:fix",
    ]));
  describe("at the bytes left after the largest fix", () => {
    const r = fitOpen(load(REVIEW), atNoev.bytes);
    test("equal fixes go in position order", () => expect(r.trimmed[4]).toBe("findings-1:f4:fix"));
    test("trimmed entries keep title, file and body", () => {
      const pick = (fs: Src[]) => fs.map(({ title, file, body }) => ({ title, file, body }));
      expect([...pick(parsed(r, 0).findings), ...pick(parsed(r, 1).findings)]).toEqual([
        ...pick(src.questions[0].context.findings),
        ...pick(src.questions[1].context.findings),
      ]);
    });
  });

  describe("a review that cannot fit structured goes prose for the whole gate", () => {
    const MIN = fitOpen(dropEntryFields(load(REVIEW), ["evidence", "fix"])).bytes;
    const r = fitOpen(load(REVIEW), MIN);
    test("mode and fits", () => expect(`${r.mode}|${r.fits}`).toBe("prose|true"));
    test("prose keeps every body whole", () => {
      const p = qctx(r, 0) + qctx(r, 1);
      for (const q of src.questions.slice(0, 2)) for (const f of q.context.findings) expect(p).toContain(f.body);
    });
  });

  describe("findings questions without contexts (a legacy findings file) fit as prose", () => {
    const r = fitOpen(
      mutated(REVIEW, (s) => {
        for (const q of s.questions) if (q.id.startsWith("findings-")) delete q.context;
      }),
    );
    test("mode, trimmed and fits", () => expect(`${r.mode}|${JSON.stringify(r.trimmed)}|${r.fits}`).toBe("prose|[]|true"));
    test("the legacy open carries no question contexts", () =>
      expect(r.questions.map((q) => "context" in q)).toEqual([false, false, false]));
  });

  test("one findings question without a context sends the whole gate prose", () =>
    expect(fitOpen(mutated(REVIEW, (s) => delete s.questions[1].context)).mode).toBe("prose"));

  test("a findings-* question carrying a thread@1 context (not findings@1) fits as prose", () => {
    const r = fitOpen(
      mutated(REVIEW, (s) => {
        s.questions[0].context = {
          "gate-ctx": "thread@1",
          author: "renee",
          severity: "non-blocking",
          claim: { summary: "clean enough." },
          verdict: { call: "valid" },
          reply: { kind: "none" },
        };
      }),
    );
    expect(r.mode).toBe("prose");
  });

  const prose = proseOpen(load(REVIEW));
  test("prose review block", () =>
    expect(prose.context).toBe(`Review by renee · round 2 · re-review · prior: 3 addressed, 1 still open
Ready to merge: with-fixes -- the retry guard holds on the parity path only; the live path still re-enqueues.
Critical (1), Important (1), Minor (3)`));
  test("prose findings block", () =>
    expect(qctx(prose, 0).split("\n\n").slice(2).join("\n\n")).toBe(`[MINOR] test over-specifies the ordering (queue/enqueue.test.ts:132) · new
asserts exact call order where the contract only promises the set.
Fix: assert set membership

[MINOR] README still says delay · addressed-check
the README describes a fixed delay; the queue now backs off exponentially.
Fix: say backoff in the README and name the base interval and the cap it grows to`));
  test("prose evidence keeps its lines", () =>
    expect(qctx(prose, 0).split("\n\n")[1]!.split("\n").slice(3).join("\n")).toBe(`Evidence: FAIL queue/enqueue.test.ts > live path drops permanent failures
  expected enqueue calls: 0
  received enqueue calls: 1`));
  test("a clean review's prose", () => {
    const r = proseOpen(
      mutated(REVIEW, (s) => {
        s.context = { "gate-ctx": "review@1", readiness: "yes", summary: "no issues found.", findings: {} };
        s.questions = [s.questions[2]];
      }),
    );
    expect(r.context).toBe("Ready to merge: yes -- no issues found.\nNo findings");
  });
});
