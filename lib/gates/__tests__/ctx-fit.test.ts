import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FitResult, fitOpen, PANE_PROSE_LIMIT, proseOpen, type RenderedOpen } from "../ctx.ts";
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

const parsed = (r: RenderedOpen, i: number): any => JSON.parse(r.questions[i]!.context as string);
const qctx = (r: RenderedOpen, i: number): string => r.questions[i]!.context as string;
const contextOrNull = (q: Record<string, unknown>): unknown => q.context ?? null;
const dropEntryFields = (s: Src, fields: string[]): Src => {
  for (const q of s.questions) for (const e of q.context?.findings ?? []) for (const f of fields) delete e[f];
  return s;
};

const paneBytes = (p: FitResult["pane"]): number =>
  (p.context === undefined ? 0 : utf8Bytes(p.context)) +
  p.questions.reduce((n, q) => n + (typeof q.context === "string" ? utf8Bytes(q.context) : 0), 0);

describe("the pane budget: what is stored stays whole, the pane prose is fitted", () => {
  const big = (): Src =>
    mutated(PLAN, (s) => {
      s.questions[0].context.claim.points = Array.from({ length: 40 }, (_, i) => `point ${i}: ${"p".repeat(1100)}`);
    });
  const src = big();
  const out = fitOpen(big());

  test("the source carries 40 KB of structured context", () =>
    expect(utf8Bytes(JSON.stringify(src.questions[0].context))).toBeGreaterThan(40 * 1024));
  test("the stored open is structured and untrimmed", () => {
    expect(out.mode).toBe("structured");
    expect(JSON.parse(out.context!)).toEqual(src.context);
    expect(out.questions.map((q) => (q.context ? JSON.parse(q.context as string) : null))).toEqual(
      src.questions.map(contextOrNull),
    );
  });
  test("the pane prose is within PANE_PROSE_LIMIT", () => {
    expect(out.pane.fits).toBe(true);
    expect(paneBytes(out.pane)).toBeLessThan(PANE_PROSE_LIMIT);
  });
  test("the pane prose names what it trimmed", () => expect(out.pane.trimmed).toEqual(["thread-1:points"]));
  test("the pane prose keeps the reply direction whole", () =>
    expect(out.pane.questions[0]!.context as string).toContain(src.questions[0].context.reply.text));
  test("an open under the budget has the untrimmed prose as its pane", () => {
    const prose = proseOpen(load(PLAN));
    expect(fitOpen(load(PLAN)).pane).toEqual({
      context: prose.context,
      questions: prose.questions,
      fits: true,
      trimmed: [],
      contextDropped: false,
      droppedContexts: [],
    });
  });
});

describe("structured, under budget: contexts round-trip exactly", () => {
  const src = load(PLAN);
  const out = fitOpen(load(PLAN));

  test("plan fit is structured", () => expect(out.mode).toBe("structured"));
  test("plan fit trims nothing", () => expect(out.pane.trimmed).toEqual([]));
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
  test("bytes is the stored total", () => {
    const qs = out.questions.filter((q) => q.context != null).map((q) => utf8Bytes(q.context as string));
    expect(out.bytes).toBe(utf8Bytes(out.context!) + qs.reduce((a, b) => a + b, 0));
  });
  test("the pane prose fits", () => expect(out.pane.fits).toBe(true));

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

  test("output keys are in the script's order", () => {
    expect(Object.keys(out)).toEqual(["mode", "context", "questions", "bytes", "pane"]);
    expect(Object.keys(out.pane)).toEqual(["context", "questions", "fits", "trimmed", "contextDropped", "droppedContexts"]);
  });
});

describe("pane over budget: points from the longest thread, then notes, never reply.text", () => {
  const FULL = proseOpen(load(PLAN)).bytes;
  const NOPOINTS = proseOpen(mutated(PLAN, (s) => delete s.questions[0].context.claim.points)).bytes;
  const pq = (r: FitResult, i: number): string => r.pane.questions[i]!.context as string;

  test("trim drops the longest thread's points first", () => {
    const r = fitOpen(load(PLAN), FULL);
    expect(r.pane.trimmed).toEqual(["thread-1:points"]);
    expect(pq(r, 0)).not.toContain("- permanent failures carry retryable");
    expect(pq(r, 0)).toStartWith("[BLOCKING] renee: the retry queue");
    expect(paneBytes(r.pane)).toBeLessThan(FULL);
  });

  test("notes go after every thread's points", () => {
    const r = fitOpen(load(PLAN), NOPOINTS);
    expect(r.pane.trimmed).toEqual(["thread-1:points", "thread-2:note"]);
    const s = load(PLAN);
    expect(pq(r, 0)).toContain(s.questions[0].context.reply.text);
    expect(pq(r, 1)).toContain(s.questions[1].context.reply.text);
  });

  test("the pane prose flattens the gate context", () =>
    expect(fitOpen(load(PLAN), NOPOINTS).pane.context!.split(" · ")[0]).toBe("Responding to renee's review"));

  test("untrimmed prose wins when it fits", () => {
    const r = fitOpen(
      mutated(PLAN, (s) => delete s.questions[0].context.claim.points),
      NOPOINTS + 1,
    );
    expect(`${JSON.stringify(r.pane.trimmed)}|${/confirmed against the checkout/.test(pq(r, 0))}`).toBe("[]|true");
  });

  describe("an open no trimmed prose can fit drops whole question contexts from the pane", () => {
    const r = fitOpen(load(PLAN), 300);
    const withContext = load(PLAN).questions.filter((q) => q.context !== undefined);
    test("it fits after the drops and says it dropped", () =>
      expect(`${r.pane.fits}|${r.pane.contextDropped}|${paneBytes(r.pane) < 300}`).toBe("true|true|true"));
    test("each dropped question has no pane context; the rest keep theirs", () => {
      for (const q of withContext) {
        const pane = r.pane.questions.find((p) => p.id === q.id)!;
        expect(pane.context === undefined).toBe(r.pane.droppedContexts.includes(q.id));
      }
    });
    test("the largest pane context goes first", () => {
      const long = mutated(PLAN, (s) => (s.questions[1].context.reply.text = "r".repeat(3000)));
      expect(fitOpen(long, 2000).pane.droppedContexts).toEqual(["thread-2"]);
    });
    test("equal pane contexts go in position order", () => {
      const twins = mutated(PLAN, (s) => {
        s.questions[0].context.reply.text = "r".repeat(3000);
        s.questions[1].context = structuredClone(s.questions[0].context);
      });
      expect(fitOpen(twins, 5000).pane.droppedContexts).toEqual(["thread-1"]);
    });
    test("the stored open keeps every context", () =>
      expect(r.questions.every((q, i) => (q.context === undefined) === (load(PLAN).questions[i].context === undefined))).toBe(true));
  });

  test("past every question context, the gate context leaves the pane too", () => {
    const r = fitOpen(load(PLAN), 1);
    expect(`${r.pane.context === undefined}|${r.pane.contextDropped}|${r.pane.fits}`).toBe("true|true|true");
    expect(r.pane.questions.every((q) => q.context === undefined)).toBe(true);
    expect(r.context).toBeDefined();
  });

  test("the stored open stays structured and whole at any limit", () => {
    const r = fitOpen(load(PLAN), 300);
    expect(r).toMatchObject({ mode: "structured", context: fitOpen(load(PLAN)).context, questions: fitOpen(load(PLAN)).questions });
  });
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

  const PROSE = proseOpen(load(REVIEW)).bytes;
  test("trim drops the largest evidence first", () =>
    expect(fitOpen(load(REVIEW), PROSE).pane.trimmed).toEqual(["findings-1:f2:evidence"]));

  const NOEV = proseOpen(dropEntryFields(load(REVIEW), ["evidence"])).bytes;
  test("every evidence goes, largest first, before any fix", () =>
    expect(fitOpen(load(REVIEW), NOEV + 1).pane.trimmed).toEqual([
      "findings-1:f2:evidence",
      "findings-2:f5:evidence",
      "findings-1:f4:evidence",
    ]));
  const atNoev = fitOpen(load(REVIEW), NOEV);
  test("then the largest fix", () =>
    expect(atNoev.pane.trimmed).toEqual([
      "findings-1:f2:evidence",
      "findings-2:f5:evidence",
      "findings-1:f4:evidence",
      "findings-1:f3:fix",
    ]));
  describe("at the bytes left after the largest fix", () => {
    const r = fitOpen(load(REVIEW), paneBytes(atNoev.pane));
    test("equal fixes go in position order", () => expect(r.pane.trimmed[4]).toBe("findings-1:f4:fix"));
    test("trimmed entries keep title, file and body", () => {
      const p = (r.pane.questions[0]!.context as string) + (r.pane.questions[1]!.context as string);
      for (const q of src.questions.slice(0, 2))
        for (const f of q.context.findings) for (const k of ["title", "file", "body"]) if (f[k]) expect(p).toContain(f[k]);
    });
    test("the stored open keeps every fix and evidence", () => expect(r.questions).toEqual(out.questions));
  });

  describe("a review whose smallest prose is at the limit", () => {
    const MIN = proseOpen(dropEntryFields(load(REVIEW), ["evidence", "fix"])).bytes;
    test("fits one byte over it with every body whole", () => {
      const r = fitOpen(load(REVIEW), MIN + 1);
      expect(r.pane.fits).toBe(true);
      const p = (r.pane.questions[0]!.context as string) + (r.pane.questions[1]!.context as string);
      for (const q of src.questions.slice(0, 2)) for (const f of q.context.findings) expect(p).toContain(f.body);
    });
    test("at it the pane drops a whole context, and the open is still stored structured", () => {
      const r = fitOpen(load(REVIEW), MIN);
      expect(`${r.mode}|${r.pane.contextDropped}|${r.pane.droppedContexts.length > 0}`).toBe("structured|true|true");
    });
  });

  describe("findings questions without contexts (a legacy findings file) are stored as prose", () => {
    const r = fitOpen(
      mutated(REVIEW, (s) => {
        for (const q of s.questions) if (q.id.startsWith("findings-")) delete q.context;
      }),
    );
    test("mode, trimmed and fits", () =>
      expect(`${r.mode}|${JSON.stringify(r.pane.trimmed)}|${r.pane.fits}`).toBe("prose|[]|true"));
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
