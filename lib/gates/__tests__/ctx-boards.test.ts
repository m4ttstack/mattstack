import { describe, expect, test } from "bun:test";
import { checkSource, fitOpen, GATE_CTX_LIMIT, proseOpen } from "../ctx.ts";

type Src = Record<string, any>;

const board = (over: Src = {}): Src => ({
  case: "retry-badge",
  slot: "after",
  path: "/Users/dev/.fast-browser/screenshots/run-1-retry-badge-after.png",
  caption: "The retry badge counts every retry",
  ...over,
});

const source = (ctx: Src): Src => ({
  context: { "gate-ctx": "boards@1", ...ctx },
  questions: [{ id: "public", multi: false, options: ["looks-fine", "hold"] }],
});

const twoBoards = (): Src =>
  source({
    summary: "Two boards are about to be attached to the MR.",
    boards: [board(), board({ case: "export-total", slot: "before", theme: "dark", path: "/tmp/e/export.png", caption: "The export total was off by one" })],
  });

describe("boards@1 is a gate-level shape", () => {
  test("a gate carrying boards with paths and captions passes", () =>
    expect(checkSource(twoBoards())).toEqual({ ok: true }));

  test("summary is optional", () =>
    expect(checkSource(source({ boards: [board()] }))).toEqual({ ok: true }));

  test("a crop of a redacted board is a slot", () =>
    expect(checkSource(source({ boards: [board({ slot: "crop" })] }))).toEqual({ ok: true }));

  test("a question cannot carry it", () => {
    const s: Src = { questions: [{ id: "q", context: { "gate-ctx": "boards@1", boards: [board()] }, options: ["a"] }] };
    expect(checkSource(s)).toEqual({
      ok: false,
      problems: ["q: gate-ctx must be one of thread@1, reply@1, findings@1, carryover@1, skipped@1"],
    });
  });
});

const rejects: [string, Src, string][] = [
  ["no boards", source({}), "gate: boards: required non-empty array"],
  ["an empty boards list", source({ boards: [] }), "gate: boards: required non-empty array"],
  ["a board without a case", source({ boards: [board({ case: "" })] }), "gate: boards[0].case: required non-empty string"],
  ["a slot outside the enum", source({ boards: [board({ slot: "pair" })] }), "gate: boards[0].slot: before|after|crop"],
  ["a board without a caption", source({ boards: [board({ caption: " " })] }), "gate: boards[0].caption: required non-empty string"],
  ["a theme outside the enum", source({ boards: [board({ theme: "sepia" })] }), "gate: boards[0].theme: light|dark when present"],
  ["a null summary", source({ summary: null, boards: [board()] }), "gate: summary: non-empty string when present"],
];

const PATH_RULE = "required absolute path to a .png, .jpg, .jpeg, .gif or .webp image";
const badPaths: [string, unknown][] = [
  ["a relative path", "shots/board.png"],
  ["a home-relative path", "~/.fast-browser/screenshots/board.png"],
  ["a URL", "https://example.test/board.png"],
  ["a file that is not an image", "/tmp/board.spec.json"],
  ["a path climbing out with ..", "/tmp/e/../../etc/board.png"],
  ["a number", 7],
];

describe("boards@1 rejects", () => {
  for (const [name, s, line] of rejects) {
    test(name, () => expect(checkSource(s)).toEqual({ ok: false, problems: [line] }));
  }
  for (const [name, path] of badPaths) {
    test(`${name} as a board path`, () =>
      expect(checkSource(source({ boards: [board({ path })] }))).toEqual({
        ok: false,
        problems: [`gate: boards[0].path: ${PATH_RULE}`],
      }));
  }
  test("an uppercase image extension is still an image", () =>
    expect(checkSource(source({ boards: [board({ path: "/tmp/e/BOARD.PNG" })] }))).toEqual({ ok: true }));
});

describe("boards@1 in the form and the fit", () => {
  test("the form reads the summary, then one line per board with its path", () =>
    expect(proseOpen(twoBoards() as any).context).toBe(
      [
        "Two boards are about to be attached to the MR.",
        "Look at each board: is there anything here that should not be public?",
        "- retry-badge/after: The retry badge counts every retry",
        "  /Users/dev/.fast-browser/screenshots/run-1-retry-badge-after.png",
        "- export-total/before/dark: The export total was off by one",
        "  /tmp/e/export.png",
      ].join("\n"),
    ));

  test("with no summary the form opens on the question", () =>
    expect(proseOpen(source({ boards: [board()] }) as any).context?.split("\n")[0]).toBe(
      "Look at each board: is there anything here that should not be public?",
    ));

  test("a dozen boards open structured, under the shared budget", () => {
    const boards = Array.from({ length: 12 }, (_, i) =>
      board({ case: `case-${i}`, path: `/Users/dev/.mattstack/work/run-1/evidence/abc123/run-1-case-${i}-after.png` }),
    );
    const fit = fitOpen(source({ summary: "Twelve boards.", boards }) as any);
    expect(fit.mode).toBe("structured");
    expect(fit.bytes).toBeLessThan(GATE_CTX_LIMIT);
    expect(JSON.parse(fit.context!)).toEqual({ "gate-ctx": "boards@1", summary: "Twelve boards.", boards });
  });
});
