import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource, fitOpen, proseOpen, type GateCtxSource } from "../ctx.ts";
import { tojson } from "../jq.ts";
import { buildReviewSource, reviewSourceErrors } from "../review-source.ts";

const ROOT = join(import.meta.dir, "../../..");
const REVIEW_DIR = join(ROOT, "plugins/mattstack/attachments/review");
const GC = join(ROOT, "plugins/mattstack/attachments/review/receive-review/scripts/gate-ctx.sh");
const RS = join(ROOT, "plugins/mattstack/attachments/review/review/scripts/review-source.sh");
const RR = join(REVIEW_DIR, "receive-review/tests/fixtures");
const RV = join(REVIEW_DIR, "review/tests/fixtures");

const TMP = mkdtempSync(join(tmpdir(), "gate-parity-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: TMP, TMPDIR: TMP };

type J = any;
/** A jq filter from a shell suite, or a hostile edit written here. */
type Mutation = string | ((j: J) => void);

const fixture = (dir: string, name: string): string => readFileSync(join(dir, `${name}.json`), "utf8");

function jq(filter: string, input: string): string {
  const r = Bun.spawnSync(["jq", "-c", filter], { stdin: Buffer.from(input), env: ENV });
  if (r.exitCode !== 0) throw new Error(`jq ${filter}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** The exact bytes both sides read: the script gets them on disk or stdin, the port parses them. */
function apply(base: string, m?: Mutation): string {
  if (m === undefined) return base;
  if (typeof m === "string") return jq(m, base);
  const j = JSON.parse(base);
  m(j);
  return JSON.stringify(j);
}

const lines = (s: string): string[] => s.split("\n").filter((l) => l !== "");

// ---------------------------------------------------------------------------
// review-source.sh inputs: the fixtures, every test-review-source.sh mutation,
// and the hostile cases.

interface RsCase {
  name: string;
  findings: string;
  extras: string;
  f?: Mutation;
  x?: Mutation;
}

const big = (n: number, ch: string) => ch.repeat(n);
const RS_CASES: RsCase[] = [
  { name: "v1", findings: "findings-v1", extras: "extras" },
  { name: "v2", findings: "findings-v2", extras: "extras" },
  { name: "v3", findings: "findings-v3", extras: "extras" },
  ...(
    [
      ["v2 over-long fix", "findings-v2", '.findings[0].fix = ("x" * 1100)'],
      ["v2 kind needs work", "findings-v2", '.findings[0].kind = " Needs_Work!"'],
      ["v2 no fix", "findings-v2", "del(.findings[0].fix)"],
      ["v2 no anchor and no fix", "findings-v2", "del(.findings[2].fileLabel, .findings[2].fix)"],
      ["v2 clean review", "findings-v2", ".findings = []"],
      ["v2 entry without a body", "findings-v2", "del(.findings[1].body)"],
      ["v2 unknown version", "findings-v2", ".version = 4"],
      ["v2 lowercase tier", "findings-v2", '.findings[0].tier = "minor"'],
      ["v2 duplicate id", "findings-v2", '.findings[1].id = "f1"'],
      ["v2 disposition outside the enum", "findings-v2", '.findings[0].disposition = "open"'],
      ["v2 spaced readiness", "findings-v2", '.summary.readiness = "with fixes"'],
      [
        "v3 seven long threads",
        "findings-v3",
        '.threads = [range(7) as $i | {discussionId: "t\\($i)", file: "queue/worker.ts", line: (10 + $i), round: 1, call: "fixed", original: ("o" * 280), authorReply: ("a" * 640), note: ("n" * 60), reply: ("r" * 60)}]',
      ],
      [
        "v3 long author replies",
        "findings-v3",
        '.threads = [range(7) as $i | {discussionId: "t\\($i)", round: 1, call: "not-fixed", original: "o", authorReply: ("a" * 2400), reply: "r"}]',
      ],
      [
        "v3 long originals",
        "findings-v3",
        '.threads = [range(7) as $i | {discussionId: "t\\($i)", round: 1, call: "not-fixed", original: ("o" * 1100), authorReply: "a", note: "n", reply: "r"}]',
      ],
      ["v3 unknown call", "findings-v3", '.threads[0].call = "still-open"'],
      ["v3 repeated discussion", "findings-v3", '.threads[1].discussionId = "a1b2"'],
      ["v3 thread without reply", "findings-v3", "del(.threads[0].reply)"],
      ["v3 no threads or skipped", "findings-v3", "del(.threads, .skipped)"],
      ["v3 repeated skipped id", "findings-v3", '.skipped[1].id = "r1-f3"'],
      ["v3 skipped without changed", "findings-v3", "del(.skipped[0].changed)"],
      ["v3 empty skipped", "findings-v3", ".skipped = []"],
    ] as const
  ).map(([name, findings, f]) => ({ name, findings, extras: "extras", f })),
  ...(
    [
      ["extras without reviewer and round", "del(.reviewer, .round)"],
      ["extras without a target", "del(.target)"],
      ["extras round below 1", ".round = 0"],
      ["extras naming a findings question", '.questions += [{"id": "findings-9", "options": []}]'],
    ] as const
  ).map(([name, x]) => ({ name, findings: "findings-v2", extras: "extras", x })),
  {
    name: "hostile non-BMP title",
    findings: "findings-v2",
    extras: "extras",
    f: (j) => (j.findings[0].title = big(60, "𝄞")),
  },
  {
    name: "hostile [Minor] label exactly 200 bytes",
    findings: "findings-v2",
    extras: "extras",
    f: (j) => (j.findings[0].title = big(96, "é")),
  },
  {
    name: "hostile [Minor] label 201 bytes",
    findings: "findings-v2",
    extras: "extras",
    f: (j) => (j.findings[0].title = `${big(96, "é")}x`),
  },
  {
    name: "hostile kind with NEL and BOM",
    findings: "findings-v2",
    extras: "extras",
    f: (j) => (j.findings[0].kind = "a\u0085b c﻿d"),
  },
  {
    name: "hostile DEL in a title",
    findings: "findings-v2",
    extras: "extras",
    f: (j) => (j.findings[0].title = "a\u007fb"),
  },
];

const rsInputs = new Map<string, { findings: string; extras: string }>();
function rsInput(c: RsCase) {
  let v = rsInputs.get(c.name);
  if (!v) {
    v = { findings: apply(fixture(RV, c.findings), c.f), extras: apply(fixture(RV, c.extras), c.x) };
    rsInputs.set(c.name, v);
  }
  return v;
}

const rsRuns = new Map<string, { exitCode: number; stdout: string; stderr: string }>();
function runRs(c: RsCase) {
  let r = rsRuns.get(c.name);
  if (!r) {
    const { findings, extras } = rsInput(c);
    const dir = mkdtempSync(join(TMP, "rs-"));
    const fp = join(dir, "findings.json");
    const xp = join(dir, "extras.json");
    writeFileSync(fp, findings);
    writeFileSync(xp, extras);
    const p = Bun.spawnSync(["sh", RS, fp, xp], { env: ENV });
    r = { exitCode: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
    rsRuns.set(c.name, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// gate-ctx.sh inputs: the fixtures, every test-gate-ctx.sh mutation, every
// review-source.sh output above, and the hostile cases.

interface GcCase {
  name: string;
  source: () => string;
}

const PLAN = "plan-source";
const POST = "post-source";
const REVIEW = "review-source";
const SKIPPED_Q =
  '{"id": "skipped-1", "multi": true, "context": {"gate-ctx": "skipped@1", "skipped": [{"id": "r1-f3", "round": 1, "severity": "minor", "title": "unused import in the retry module", "changed": true}, {"id": "r1-f5", "round": 1, "severity": "important", "title": "the lease renewal has no test", "changed": false}]}, "options": [{"value": "restore:r1-f5", "label": "[Important] the lease renewal has no test"}]}';
const SKIPPED_TWICE_Q =
  '{"id": "skipped-1", "multi": true, "context": {"gate-ctx": "skipped@1", "skipped": [{"id": "r1-f3", "round": 1, "severity": "minor", "title": "unused import in the retry module", "changed": true}, {"id": "r1-f3", "round": 1, "severity": "minor", "title": "unused import in the retry module", "changed": true}]}, "options": [{"value": "restore:r1-f3", "label": "[Minor] unused import in the retry module"}, {"value": "restore:r1-f3", "label": "[Minor] unused import in the retry module"}]}';

const GC_MUTATIONS: [string, string, Mutation | undefined][] = [
  ["plan", PLAN, undefined],
  ["post", POST, undefined],
  ["review", REVIEW, undefined],
  ["unknown keys pass through", PLAN, '.questions[0].context.extra = {"x": 1} | .context.future = "later"'],
  ["reply.kind none", PLAN, '.questions[0].context.reply = {"kind": "none"}'],
  ["plan without thread-1 points", PLAN, "del(.questions[0].context.claim.points)"],
  ["three fixes", POST, '.context.fixes = [{"sha": "a1"}, {"sha": "b2"}, {"sha": "c3"}]'],
  [
    "review optional fields absent",
    REVIEW,
    'del(.questions[0].context.findings[2].disposition, .questions[0].context.findings[3].fix) | .context = {"gate-ctx": "review@1", "readiness": "yes", "summary": "clean enough.", "findings": {}}',
  ],
  ["review without evidence", REVIEW, "del(.questions[].context.findings?[]?.evidence)"],
  [
    "review without evidence or fix",
    REVIEW,
    "del(.questions[].context.findings?[]?.evidence, .questions[].context.findings?[]?.fix)",
  ],
  ["legacy findings questions", REVIEW, '(.questions[] | select(.id | startswith("findings-"))) |= del(.context)'],
  ["one findings question without a context", REVIEW, "del(.questions[1].context)"],
  [
    "findings-* question with thread@1",
    REVIEW,
    '.questions[0].context = {"gate-ctx": "thread@1", "author": "renee", "severity": "non-blocking", "claim": {"summary": "clean enough."}, "verdict": {"call": "valid"}, "reply": {"kind": "none"}}',
  ],
  [
    "a clean review",
    REVIEW,
    '.context = {"gate-ctx": "review@1", "readiness": "yes", "summary": "no issues found.", "findings": {}} | .questions = [.questions[2]]',
  ],
  ["missing reviewer", PLAN, "del(.context.reviewer)"],
  ["severity outside the enum", PLAN, '.questions[0].context.severity = "major"'],
  ["verbatim reply without text", PLAN, '.questions[1].context.reply = {"kind": "verbatim"}'],
  ["retired verdict word", PLAN, '.questions[1].context.verdict.call = "invalid"'],
  ["question shape at gate level", PLAN, '.context["gate-ctx"] = "thread@1"'],
  ["unknown version", PLAN, '.questions[0].context["gate-ctx"] = "thread@2"'],
  ["null optional", PLAN, ".context.round = null"],
  ["points as a string", PLAN, '.questions[0].context.claim.points = "one"'],
  ["reply joins no option", POST, '.questions[0].context.thread = "TX"'],
  ["a third option on a reply", POST, '.questions[1].options += ["skip:T2"]'],
  [
    "a carryover question without exactly post and resolve",
    POST,
    '.questions[0].context = {"gate-ctx": "carryover@1", "thread": "T1", "round": 1, "call": "fixed", "original": "permanent failures re-enqueue forever", "reply": "Confirmed, thanks."} | .questions[0].options = ["post:T1", "skip:T1"]',
  ],
  ["post without a replies count", POST, "del(.context.replies)"],
  ["sha on a plain reply", POST, '.questions[1].context.sha = "x"'],
  ["a reply without text", POST, "del(.questions[0].context.text)"],
  ["verb outside the enum", POST, '.questions[1].context.verb = "skip"'],
  ["a reply question that is not multi", POST, ".questions[0].multi = false"],
  ["a reply question with no multi", POST, "del(.questions[1].multi)"],
  [
    "a thread offered twice",
    POST,
    '.questions[1].context.thread = "T1" | .questions[1].context.verb = "reply" | .questions[1].options = ["post:T1", "resolve:T1"]',
  ],
  ["whitespace-only reply text", POST, '.questions[0].context.text = "   "'],
  ["the retired replies shape", POST, '.questions[0].context = {"gate-ctx": "replies@1", "replies": []}'],
  ["missing readiness", REVIEW, "del(.context.readiness)"],
  ["spaced readiness", REVIEW, '.context.readiness = "with fixes"'],
  ["missing summary", REVIEW, "del(.context.summary)"],
  ["a count as a string", REVIEW, '.context.findings.minor = "3"'],
  ["prior missing still_open", REVIEW, '.context.prior = {"addressed": 3}'],
  ["re_review as a string", REVIEW, '.context.re_review = "yes"'],
  ["round below 1", REVIEW, ".context.round = 0"],
  ["entry without a body", REVIEW, "del(.questions[0].context.findings[1].body)"],
  ["report-cased severity", REVIEW, '.questions[0].context.findings[0].severity = "Critical"'],
  ["disposition outside the enum", REVIEW, '.questions[0].context.findings[2].disposition = "open"'],
  ["null evidence", REVIEW, ".questions[0].context.findings[0].evidence = null"],
  ["an option with no entry", REVIEW, '.questions[0].options += [{"value": "f7", "label": "[Minor] extra"}]'],
  [
    "an entry with no option",
    REVIEW,
    '.questions[1].context.findings += [.questions[1].context.findings[0] | .id = "f8"]',
  ],
  [
    "a duplicated entry id",
    REVIEW,
    '.questions[0].context.findings[3].id = "f1" | .questions[0].options[3].value = "f1"',
  ],
  ["findings shape at gate level", REVIEW, '.context["gate-ctx"] = "findings@1"'],
  ["review shape on a question", REVIEW, '.questions[0].context["gate-ctx"] = "review@1"'],
  ["a skipped entry with no restore option", REVIEW, `.questions += [${SKIPPED_Q}]`],
  ["a repeated skipped id", REVIEW, `.questions += [${SKIPPED_TWICE_Q}]`],
  ["hostile DEL in claim.summary", PLAN, (j) => (j.questions[0].context.claim.summary = "a\u007fb")],
  ["hostile non-BMP finding title", REVIEW, (j) => (j.questions[0].context.findings[0].title = big(60, "𝄞"))],
  ["hostile ideographic-space reply.text", PLAN, (j) => (j.questions[0].context.reply.text = "　")],
];

const GC_CASES: GcCase[] = [
  ...GC_MUTATIONS.map(([name, base, m]) => ({ name, source: () => apply(fixture(RR, base), m) })),
  ...RS_CASES.filter((c) => runRs(c).exitCode === 0).map((c) => ({
    name: `review-source ${c.name}`,
    source: () => runRs(c).stdout,
  })),
];

type Mode = { name: string; args: (src: GateCtxSource) => string[] };
const MODES: Mode[] = [
  { name: "fit", args: () => ["fit"] },
  { name: "fit --limit 900", args: () => ["fit", "--limit", "900"] },
  { name: "fit --limit 300", args: () => ["fit", "--limit", "300"] },
  { name: "fit --limit <its own structured bytes>", args: (s) => ["fit", "--limit", String(fitOpen(s).bytes)] },
  { name: "prose", args: () => ["prose"] },
];

function portOpen(src: GateCtxSource, args: string[]) {
  return args[0] === "prose" ? proseOpen(src) : fitOpen(src, args[2] === undefined ? undefined : Number(args[2]));
}

test("jq is on PATH", () => {
  expect(Bun.which("jq"), "jq is required for the gate-ctx parity test").toBeTruthy();
});

describe("review-source.sh parity", () => {
  for (const c of RS_CASES) {
    test(c.name, () => {
      const { findings, extras } = rsInput(c);
      const r = runRs(c);
      const f = JSON.parse(findings);
      const x = JSON.parse(extras);
      const errors = reviewSourceErrors(f, x);
      if (r.exitCode === 0) {
        expect(errors).toEqual([]);
        expect(r.stdout).toBe(`${tojson(buildReviewSource(f, x))}\n`);
      } else {
        expect(r.exitCode).toBe(1);
        expect(errors).toEqual(lines(r.stderr));
      }
    });
  }
});

describe("gate-ctx.sh parity", () => {
  for (const c of GC_CASES) {
    for (const mode of MODES) {
      test(`${c.name} | ${mode.name}`, () => {
        const text = c.source();
        expect(text).not.toBe("");
        const src = JSON.parse(text) as GateCtxSource;
        const check = checkSource(src);
        const args = check.ok ? mode.args(src) : ["fit"];
        const r = Bun.spawnSync(["sh", GC, ...args], { stdin: Buffer.from(text), env: ENV });
        if (r.exitCode === 0) {
          expect(check).toEqual({ ok: true });
          expect(r.stdout.toString()).toBe(`${tojson(portOpen(src, args))}\n`);
        } else {
          expect(r.exitCode).toBe(1);
          expect(check.ok ? [] : check.problems).toEqual(lines(r.stderr.toString()));
        }
      });
    }
  }
});
