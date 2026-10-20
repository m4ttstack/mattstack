import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSource, type FitResult, fitOpen, PANE_PROSE_LIMIT, proseOpen } from "../ctx.ts";
import { jqKeys, tojson, utf8Bytes } from "../jq.ts";
import { buildReviewSource, endTrunc, midTrunc, reviewSourceErrors } from "../review-source.ts";

const ROOT = join(import.meta.dir, "../../..");
const FIXTURE: Record<string, string> = {
  "findings-v1": "plugins/mattstack/attachments/review/review/tests/fixtures/findings-v1.json",
  "findings-v2": "plugins/mattstack/attachments/review/review/tests/fixtures/findings-v2.json",
  "findings-v3": "plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3.json",
  "findings-v3-drafts": "plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3-drafts.json",
  extras: "plugins/mattstack/attachments/review/review/tests/fixtures/extras.json",
};
type J = Record<string, any>;
const load = (name: string): J => JSON.parse(readFileSync(join(ROOT, FIXTURE[name]!), "utf8"));
const V1 = "findings-v1";
const V2 = "findings-v2";
const V3 = "findings-v3";
const DRAFTS = "findings-v3-drafts";
const X = "extras";

function mutated(name: string, f: (j: J) => void): J {
  const j = load(name);
  f(j);
  return j;
}

function build(findings: J, extras: J): J {
  expect(reviewSourceErrors(findings, extras)).toEqual([]);
  return buildReviewSource(findings, extras) as J;
}

const errs = (findings: J, extras: J): string => reviewSourceErrors(findings, extras).join("\n");
const degraded = (o: J): string => `${o.label}|${o.description}`;
const sortedKeys = (o: J): J => Object.fromEntries(jqKeys(o).map((k) => [k, o[k]]));
const fit = (out: J) => {
  expect(checkSource(out)).toEqual({ ok: true });
  return fitOpen(out as any);
};
const threadContexts = (r: { questions: J[] }): J[] =>
  r.questions.filter((q) => String(q.id).startsWith("thread-")).map((q) => JSON.parse(q.context));
const occurrences = (s: string, sub: string): number => s.split(sub).length - 1;
const paneThreads = (r: FitResult): { id: string; original: string; authorReply?: string; note: boolean }[] =>
  r.pane.questions
    .filter((q) => String(q.id).startsWith("thread-"))
    .map((q) => {
      const lines = (q.context as string).split("\n");
      const after = (p: string): string | undefined => lines.find((l) => l.startsWith(p))?.slice(p.length);
      return { id: String(q.id), original: after("You wrote: ")!, authorReply: after("Author replied: "), note: after("Checked: ") !== undefined };
    });

describe("version 2: structured source", () => {
  const out = build(load(V2), load(X));
  const q0 = out.questions[0];

  test("gate context is review@1 from the summary, counts, and re-review fields", () =>
    expect(tojson(out.context)).toBe(
      '{"gate-ctx":"review@1","reviewer":"renee","readiness":"with-fixes","summary":"the retry guard holds on the parity path only; the live path still re-enqueues.","findings":{"critical":1,"important":1,"minor":3},"round":2,"re_review":true,"prior":{"addressed":3,"still_open":1}}',
    ));
  test("findings go by tier, four per question, then the extras questions", () =>
    expect(tojson(out.questions.map((q: J) => [q.id, q.options.map((o: J) => o.value)]))).toBe(
      '[["findings-1",["f4","f2","f1","f3"]],["findings-2",["f5"]],["outcome",["comment","approve"]]]',
    ));
  test("every findings question asks the same thing", () =>
    expect(tojson([out.questions[0].label, out.questions[1].label])).toBe(
      '["Post which findings to !87?","Post which findings to !87?"]',
    ));
  test("extras questions ride verbatim", () => expect(out.questions.slice(2)).toEqual(load(X).questions));

  test("file-only anchor, no kind", () =>
    expect(degraded(q0.options[0])).toBe(
      "[Critical] permanent failures re-enqueue forever|queue/worker.ts · drop non-retryable jobs in the worker's catch block",
    ));
  test("file:line anchor with kind", () =>
    expect(degraded(q0.options[1])).toBe(
      "[Important] retry fix is parity wiring, not a live fix|queue/enqueue.ts:81 · move the retryable check ahead of the parity branch · kind:suggestion",
    ));
  test("kind is lowercased", () =>
    expect(q0.options[2].description).toBe("queue/enqueue.test.ts:132 · assert set membership · kind:nitpick"));
  test("fileLabel stands in for the anchor; kind spaces become hyphens", () =>
    expect(q0.options[3].description).toBe(
      "not inline-anchorable · say backoff in the README and name the base interval and the cap it grows to · kind:follow-up",
    ));
  test("a long title is middle-truncated to the 200-byte label cap", () => {
    const label = out.questions[1].options[0].label;
    expect(`${utf8Bytes(label)}|${label}`).toBe(
      "200|[Minor] the backoff schedule doubles from a 250 ms base with ±20 % jitter per attempt, so the tenth re… which outlasts the worker lease; renew the lease on each attempt or cap the schedule below it",
    );
  });

  test("entry carries body, evidence, disposition, kind and a file:line", () =>
    expect(tojson(q0.context.findings[1])).toBe(
      '{"id":"f2","severity":"important","title":"retry fix is parity wiring, not a live fix","body":"the guard only runs on the parity path; the live path still re-enqueues a permanently failed job.","file":"queue/enqueue.ts:81","fix":"move the retryable check ahead of the parity branch","evidence":"FAIL queue/enqueue.test.ts > live path drops permanent failures\\n  expected enqueue calls: 0\\n  received enqueue calls: 1","disposition":"still-open","kind":"suggestion"}',
    ));
  test("an entry with no kind omits the key", () => expect(Object.hasOwn(q0.context.findings[0], "kind")).toBe(false));
  test("a fileLabel is not a file", () => expect(Object.hasOwn(q0.context.findings[3], "file")).toBe(false));
  test("a file without a line stays bare", () => expect(q0.context.findings[0].file).toBe("queue/worker.ts"));
  test("titles are never truncated in the context", () =>
    expect(out.questions[1].context.findings[0].title).toBe(load(V2).findings[4].title));
  test("the source fits structured with the vendored gate-ctx.sh", () => expect(fit(out).mode).toBe("structured"));

  test("an over-long fix is shortened to the 1024-byte description cap, anchor and kind kept", () => {
    const o = build(
      mutated(V2, (j) => {
        j.findings[0].fix = "x".repeat(1100);
      }),
      load(X),
    );
    const d: string = o.questions[0].options[2].description;
    expect(
      `${utf8Bytes(d) <= 1024}|${d.startsWith("queue/enqueue.test.ts:132 · xxx")}|${d.endsWith("x… · kind:nitpick")}`,
    ).toBe("true|true|true");
  });

  describe("kind normalizes", () => {
    const o = build(
      mutated(V2, (j) => {
        j.findings[0].kind = " Needs_Work!";
      }),
      load(X),
    );
    test("kind normalizes to lowercase and hyphens", () =>
      expect(o.questions[0].options[2].description).toBe(
        "queue/enqueue.test.ts:132 · assert set membership · kind:needs-work",
      ));
    test("the entry's kind is the same normalized word", () =>
      expect(o.questions[0].context.findings[2].kind).toBe("needs-work"));
  });

  test("no fix: anchor and kind only", () => {
    const o = build(
      mutated(V2, (j) => {
        delete j.findings[0].fix;
      }),
      load(X),
    );
    expect(o.questions[0].options[2].description).toBe("queue/enqueue.test.ts:132 · kind:nitpick");
  });
  test("no anchor and no fix: no description", () => {
    const o = build(
      mutated(V2, (j) => {
        delete j.findings[2].fileLabel;
        delete j.findings[2].fix;
      }),
      load(X),
    );
    expect(Object.hasOwn(o.questions[0].options[3], "description")).toBe(false);
  });
  test("a clean review has no findings questions and empty counts", () => {
    const o = build(
      mutated(V2, (j) => {
        j.findings = [];
      }),
      load(X),
    );
    expect(`${tojson(o.questions.map((q: J) => q.id))}|${tojson(o.context.findings)}`).toBe('["outcome"]|{}');
  });
  test("reviewer and round only when the caller supplies them", () => {
    const o = build(
      load(V2),
      mutated(X, (j) => {
        delete j.reviewer;
        delete j.round;
      }),
    );
    expect(`${Object.hasOwn(o.context, "reviewer")}|${Object.hasOwn(o.context, "round")}`).toBe("false|false");
  });
});

describe("legacy (no version): no findings contexts, so fit goes prose", () => {
  const out = build(load(V1), load(X));
  test("legacy findings questions carry no context", () =>
    expect(tojson(out.questions.map((q: J) => Object.hasOwn(q, "context")))).toBe("[false,false]"));
  test("legacy options keep the degraded recipe", () =>
    expect(degraded(out.questions[0].options[0])).toBe(
      "[Critical] permanent failures re-enqueue forever|queue/worker.ts · drop non-retryable jobs in the worker's catch block · kind:suggestion",
    ));
  test("legacy is stored as whole-gate prose", () => {
    const r = fit(out);
    expect(`${r.mode}|${tojson(r.pane.trimmed)}`).toBe("prose|[]");
  });
});

describe("contract violations: one line per problem", () => {
  const cases: [string, J, J, string][] = [
    [
      "v2 entry without a body",
      mutated(V2, (j) => delete j.findings[1].body),
      load(X),
      "findings file: findings[1].body: required non-empty string",
    ],
    [
      "unknown version",
      mutated(V2, (j) => {
        j.version = 4;
      }),
      load(X),
      "findings file: version: 2 or 3 when present (absent is a legacy file)",
    ],
    [
      "lowercase tier",
      mutated(V2, (j) => {
        j.findings[0].tier = "minor";
      }),
      load(X),
      "findings file: findings[0].tier: Critical|Important|Minor",
    ],
    [
      "duplicate id",
      mutated(V2, (j) => {
        j.findings[1].id = "f1";
      }),
      load(X),
      "findings file: findings: id f1 appears more than once",
    ],
    [
      "disposition outside the enum",
      mutated(V2, (j) => {
        j.findings[0].disposition = "open";
      }),
      load(X),
      "findings file: findings[0].disposition: new|still-open|addressed-check",
    ],
    [
      "spaced readiness",
      mutated(V2, (j) => {
        j.summary.readiness = "with fixes";
      }),
      load(X),
      "findings file: summary.readiness: yes|no|with-fixes",
    ],
    [
      "extras without a target",
      load(V2),
      mutated(X, (j) => delete j.target),
      "extras: target: required non-empty string",
    ],
    [
      "round below 1",
      load(V2),
      mutated(X, (j) => {
        j.round = 0;
      }),
      "extras: round: integer of at least 1 when present",
    ],
    [
      "extras naming a findings question",
      load(V2),
      mutated(X, (j) => {
        j.questions.push({ id: "findings-9", options: [] });
      }),
      "extras: questions: findings-*, thread-* and skipped-* ids are built from the findings file",
    ],
  ];
  for (const [name, f, x, want] of cases) test(`${name} names the field`, () => expect(errs(f, x)).toBe(want));

  test("non-JSON findings file is not a JSON object", () =>
    expect(reviewSourceErrors("not json", load(X))).toEqual(["findings file: not a JSON object"]));
  test("non-object extras are not a JSON object", () =>
    expect(reviewSourceErrors(load(V2), [])).toEqual(["extras: not a JSON object"]));
});

describe("version 3: earlier threads become thread-N questions", () => {
  const out = build(load(V3), load(X));

  test("thread questions lead, then findings, then skipped, then extras", () =>
    expect(tojson(out.questions.map((q: J) => q.id))).toBe(
      '["thread-1","thread-2","thread-3","findings-1","skipped-1","skipped-2","outcome"]',
    ));
  test("a thread question offers exactly post and resolve for its discussion", () =>
    expect(tojson(out.questions[0].options.map((o: J) => o.value))).toBe('["post:a1b2","resolve:a1b2"]'));
  test("fixed recommends both", () =>
    expect(tojson(out.questions[0].options.map((o: J) => o.label))).toBe(
      '["Post reply (recommended)","Resolve thread (recommended)"]',
    ));
  test("pushback-accepted recommends both", () =>
    expect(tojson(out.questions[1].options.map((o: J) => o.label))).toBe(
      '["Post reply (recommended)","Resolve thread (recommended)"]',
    ));
  test("not-fixed recommends the reply only", () =>
    expect(tojson(out.questions[2].options.map((o: J) => o.label))).toBe('["Post reply (recommended)","Resolve thread"]'));
  test("the label is file:line, the file alone, or General thread", () =>
    expect(tojson(out.questions.slice(0, 3).map((q: J) => q.label))).toBe(
      '["queue/worker.ts:40","queue/enqueue.ts","General thread"]',
    ));
  test("the carryover context carries the whole card", () =>
    expect(tojson(sortedKeys(out.questions[0].context))).toBe(
      '{"authorReply":"dropped in the catch block now","call":"fixed","file":"queue/worker.ts:40","gate-ctx":"carryover@1","note":"worker.ts:40 returns before enqueue for non-retryable errors","original":"permanent failures re-enqueue forever","reply":"Confirmed, thanks.","round":1,"thread":"a1b2"}',
    ));
  test("a thread with no author reply and no file omits both keys", () =>
    expect(tojson(jqKeys(out.questions[2].context))).toBe('["call","gate-ctx","original","reply","round","thread"]'));
  test("thread questions are multi", () => expect(out.questions[0].multi).toBe(true));

  test("fit accepts carryover@1 and stays structured with thread questions", () => {
    const r = fit(out);
    expect(r.mode).toBe("structured");
    expect(JSON.parse(r.questions[0]!.context as string)["gate-ctx"]).toBe("carryover@1");
  });
  test("prose flattens a thread to its call, the reply and both sides", () =>
    expect(proseOpen(out as any).questions[0]!.context).toBe(
      "queue/worker.ts:40 · round 1 · fixed by author\nYou wrote: permanent failures re-enqueue forever\nAuthor replied: dropped in the catch block now\nChecked: worker.ts:40 returns before enqueue for non-retryable errors\nWill post as reply: Confirmed, thanks.",
    ));

  describe("many long threads: the pane prose trims carryover parts, the stored open stays whole", () => {
    const long = build(
      mutated(V3, (j) => {
        j.threads = Array.from({ length: 7 }, (_, i) => ({
          discussionId: `t${i}`,
          file: "queue/worker.ts",
          line: 10 + i,
          round: 1,
          call: "fixed",
          original: "o".repeat(280),
          authorReply: "a".repeat(640),
          note: "n".repeat(60),
          reply: "r".repeat(60),
        }));
      }),
      load(X),
    );
    test("seven 1.1 KB threads overflow the pane prose untrimmed", () =>
      expect(proseOpen(long as any).bytes).toBeGreaterThan(PANE_PROSE_LIMIT));
    const r = fit(long);
    test("seven long threads are stored structured and whole, and the pane prose fits", () => {
      expect(`${r.mode}|${r.pane.fits}`).toBe("structured|true");
      expect(threadContexts(r)).toEqual(long.questions.filter((q: J) => q.id.startsWith("thread-")).map((q: J) => q.context));
    });
    test("every note goes before any author reply shrinks", () => {
      const fields = r.pane.trimmed.map((t) => t.split(":")[1]);
      expect(fields.slice(0, 7).every((f) => f === "note")).toBe(true);
      expect(fields.slice(7).length > 0 && fields.slice(7).every((f) => f === "authorReply")).toBe(true);
    });
    test("every author reply stays: shrunk ones are shorter and keep both ends", () => {
      const shrunk = r.pane.trimmed.filter((t) => t.endsWith(":authorReply")).map((t) => t.split(":")[0]);
      const threads = paneThreads(r);
      expect(threads.every((t) => typeof t.authorReply === "string" && t.authorReply.length > 0)).toBe(true);
      for (const t of threads.filter((t) => shrunk.includes(t.id))) {
        const a = t.authorReply!;
        expect(a.length < 640 && a.startsWith("a") && a.endsWith("a") && a.includes(" ... ")).toBe(true);
      }
    });
    test("a shrunk thread keeps its original whole and drops only its note", () => {
      const id = r.pane.trimmed.filter((t) => t.endsWith(":authorReply"))[0]!.split(":")[0];
      const t = paneThreads(r).find((t) => t.id === id)!;
      expect(`${t.note}|${t.original.length === 280}`).toBe("false|true");
    });
    test("the findings keep their fix and evidence", () =>
      expect(r.pane.trimmed.filter((t) => t.startsWith("findings-"))).toEqual([]));
  });

  test("a reply shrunk more than once carries one marker and is named once", () => {
    const o = build(
      mutated(V3, (j) => {
        j.threads = Array.from({ length: 7 }, (_, i) => ({
          discussionId: `t${i}`,
          round: 1,
          call: "not-fixed",
          original: "o",
          authorReply: "a".repeat(2400),
          reply: "r",
        }));
      }),
      load(X),
    );
    const r = fit(o);
    const replies = paneThreads(r).map((t) => t.authorReply!);
    const oneMarker =
      replies.some((a) => a.length < 1200) &&
      replies.filter((a) => a.length < 2400).every((a) => occurrences(a, " ... ") === 1);
    expect(`${r.mode}|${oneMarker}|${r.pane.trimmed.length === new Set(r.pane.trimmed).size}`).toBe("structured|true|true");
  });

  describe("long originals", () => {
    const o = build(
      mutated(V3, (j) => {
        j.threads = Array.from({ length: 7 }, (_, i) => ({
          discussionId: `t${i}`,
          round: 1,
          call: "not-fixed",
          original: "o".repeat(1100),
          authorReply: "a",
          note: "n",
          reply: "r",
        }));
      }),
      load(X),
    );
    const r = fit(o);
    test("long originals are middle-truncated once notes are gone and replies are short", () =>
      expect(
        `${r.mode}|${r.pane.trimmed.some((t) => /:original$/.test(t))}|${paneThreads(r).every((t) => t.authorReply === "a")}`,
      ).toBe("structured|true|true"));
    test("a truncated original keeps both ends and is never empty", () => {
      const originals = paneThreads(r).map((t) => t.original);
      expect(originals.every((s) => s.length > 0 && s.startsWith("o") && s.endsWith("o"))).toBe(true);
      expect(originals.some((s) => s.includes(" ... "))).toBe(true);
    });
    test("each original is named once", () => {
      const named = r.pane.trimmed.filter((t) => t.endsWith(":original"));
      expect(named.length).toBe(new Set(named).size);
    });
  });

  test("an unknown call names the field", () =>
    expect(
      errs(
        mutated(V3, (j) => {
          j.threads[0].call = "still-open";
        }),
        load(X),
      ),
    ).toBe("findings file: threads[0].call: fixed|not-fixed|pushback-accepted|pushback-rejected"));
  test("a repeated discussion exits 1", () =>
    expect(
      errs(
        mutated(V3, (j) => {
          j.threads[1].discussionId = "a1b2";
        }),
        load(X),
      ),
    ).toBe("findings file: threads: discussion a1b2 appears more than once"));
  test("a thread needs its reply", () =>
    expect(errs(mutated(V3, (j) => delete j.threads[0].reply), load(X))).toBe(
      "findings file: threads[0].reply: required non-empty string",
    ));
  test("a v3 file with no threads is a first-round review", () => {
    const o = build(
      mutated(V3, (j) => {
        delete j.threads;
        delete j.skipped;
      }),
      load(X),
    );
    expect(tojson(o.questions.map((q: J) => q.id))).toBe('["findings-1","outcome"]');
  });
});

describe("skipped findings: restore:<id> options, none recommended", () => {
  const out = build(load(V3), load(X));
  const skipped = out.questions.filter((q: J) => q.id.startsWith("skipped-"));

  test("skipped chunks at four, in the order given", () =>
    expect(tojson(skipped.map((q: J) => [q.id, q.options.map((o: J) => o.value)]))).toBe(
      '[["skipped-1",["restore:r1-f3","restore:r1-f5","restore:r2-f1","restore:r2-f2"]],["skipped-2",["restore:r2-f4"]]]',
    ));
  test("no skipped option is recommended", () =>
    expect(skipped.flatMap((q: J) => q.options.filter((o: J) => /recommended/.test(o.label))).length).toBe(0));
  test("the option reads without a card: anchor, round, changed", () =>
    expect(out.questions[4].options[0].description).toBe("queue/retry.ts:3 · skipped in round 1 · code changed since"));
  test("an unanchored, unchanged one says only its round", () =>
    expect(out.questions[4].options[1].description).toBe("skipped in round 1"));
  test("the context entry lowercases severity and joins file:line", () =>
    expect(tojson(out.questions[4].context.skipped[0])).toBe(
      '{"id":"r1-f3","round":1,"severity":"minor","title":"unused import in the retry module","file":"queue/retry.ts:3","changed":true}',
    ));
  test("fit accepts skipped@1 and stays structured", () => expect(fit(out).mode).toBe("structured"));
  test("prose lists each skipped finding on a line", () =>
    expect((proseOpen(out as any).questions[4]!.context as string).split("\n")[0]).toBe(
      "[MINOR] unused import in the retry module (queue/retry.ts:3) · skipped in round 1 · code changed since",
    ));
  test("a repeated skipped id exits 1", () =>
    expect(
      errs(
        mutated(V3, (j) => {
          j.skipped[1].id = "r1-f3";
        }),
        load(X),
      ),
    ).toBe("findings file: skipped: id r1-f3 appears more than once"));
  test("changed is required", () =>
    expect(errs(mutated(V3, (j) => delete j.skipped[0].changed), load(X))).toBe(
      "findings file: skipped[0].changed: required boolean",
    ));
  test("an empty skipped list builds no question", () => {
    const o = build(
      mutated(V3, (j) => {
        j.skipped = [];
      }),
      load(X),
    );
    expect(o.questions.filter((q: J) => q.id.startsWith("skipped-")).length).toBe(0);
  });
});

describe("drafted comments ride whole, board-only", () => {
  const editable = () => mutated(X, (j) => (j.editable = true));
  const out = build(load(DRAFTS), editable());
  const entries = (o: J): J[] =>
    o.questions.filter((q: J) => q.id.startsWith("findings-")).flatMap((q: J) => q.context.findings);

  test("every finding's comment passes through whole", () => {
    const want = Object.fromEntries(load(DRAFTS).findings.map((f: J) => [f.id, f.comment]));
    expect(Object.fromEntries(entries(out).map((e) => [e.id, e.comment]))).toEqual(want);
  });
  test("the comment is the entry's last key", () => expect(Object.keys(entries(out)[0]!).at(-1)).toBe("comment"));
  test("review@1 carries editable and the whole summary comment", () => {
    expect(out.context.editable).toBe(true);
    expect(out.context.summaryComment).toBe(load(DRAFTS).summary.comment);
  });
  test("without editable the drafts still ride and editable is absent", () => {
    const o = build(load(DRAFTS), load(X));
    expect(`${Object.hasOwn(o.context, "editable")}|${o.context.summaryComment === load(DRAFTS).summary.comment}`).toBe("false|true");
  });
  test("a v3 file without drafts builds exactly what it did", () => {
    const o = build(load(V3), load(X));
    expect(tojson(jqKeys(o.context))).toBe('["findings","gate-ctx","prior","re_review","readiness","reviewer","round","summary"]');
    expect(entries(o).some((e) => Object.hasOwn(e, "comment"))).toBe(false);
  });
  test("the drafts source passes checkSource", () => expect(checkSource(out)).toEqual({ ok: true }));

  const rejects: [string, J, J, string][] = [
    ["an empty comment", mutated(DRAFTS, (j) => (j.findings[2].comment = "")), load(X), "findings file: findings[2].comment: non-empty string when present"],
    ["a numeric summary comment", mutated(DRAFTS, (j) => (j.summary.comment = 5)), load(X), "findings file: summary.comment: non-empty string when present"],
    ["editable as a string", load(DRAFTS), mutated(X, (j) => (j.editable = "yes")), "extras: editable: boolean when present"],
    [
      "editable with a finding that has no comment",
      mutated(DRAFTS, (j) => delete j.findings[4].comment),
      editable(),
      "extras: editable: needs a comment on every finding and a summary.comment",
    ],
    [
      "editable without a summary comment",
      mutated(DRAFTS, (j) => delete j.summary.comment),
      editable(),
      "extras: editable: needs a comment on every finding and a summary.comment",
    ],
  ];
  for (const [name, f, x, want] of rejects) test(`${name} names the field`, () => expect(errs(f, x)).toBe(want));
  test("editable over a file with no findings needs only the summary comment", () =>
    expect(errs(mutated(DRAFTS, (j) => (j.findings = [])), editable())).toBe(""));
});

describe("truncation helpers", () => {
  test("midTrunc stays codepoint-safe under the byte cap", () => {
    const s = midTrunc("é".repeat(150), 200);
    expect(utf8Bytes(s) <= 200).toBe(true);
    expect(occurrences(s, "…")).toBe(1);
  });
  test("endTrunc below three bytes is empty", () => expect(endTrunc("abc", 2)).toBe(""));
});
