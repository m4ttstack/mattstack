import { describe, expect, test } from "bun:test";
import { BOARDS_PER_GATE, boardsBudgetError, checkSource, fitOpen, PANE_PROSE_LIMIT, proseOpen } from "../ctx.ts";

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
  test("the form reads the summary, then one line per board with its path; the question is the form's own", () =>
    expect(proseOpen(twoBoards() as any).context).toBe(
      [
        "Two boards are about to be attached to the MR.",
        "- retry-badge/after: The retry badge counts every retry",
        "  /Users/dev/.fast-browser/screenshots/run-1-retry-badge-after.png",
        "- export-total/before/dark: The export total was off by one",
        "  /tmp/e/export.png",
      ].join("\n"),
    ));

  test("with no summary the form opens on the first board", () =>
    expect(proseOpen(source({ boards: [board()] }) as any).context?.split("\n")[0]).toBe(
      "- retry-badge/after: The retry badge counts every retry",
    ));

  test("a dozen boards open structured, within the pane budget", () => {
    const boards = Array.from({ length: 12 }, (_, i) =>
      board({ case: `case-${i}`, path: `/Users/dev/.mattstack/work/run-1/evidence/abc123/run-1-case-${i}-after.png` }),
    );
    const fit = fitOpen(source({ summary: "Twelve boards.", boards }) as any);
    expect(fit.mode).toBe("structured");
    expect(fit.pane.fits).toBe(true);
    expect(JSON.parse(fit.context!)).toEqual({ "gate-ctx": "boards@1", summary: "Twelve boards.", boards });
  });
});

/** A board as a real run records it: a run-folder path under a long home, a
    60-character claim, a theme. */
const realistic = (i: number): Src =>
  board({
    case: `order-card-delivery-window-${i}`,
    slot: "after",
    theme: "dark",
    path: `/Users/firstname.lastname/.mattstack/work/20261019-050000-cd34-1/evidence/0a1b2c3d4e5f/20261019-050000-cd34-1-order-card-delivery-window-${i}-after-dark.png`,
    caption: "The delivery window now sits under the order total on the card",
  });

describe("boards@1 against the pane budget", () => {
  const many = (n: number) => source({ boards: Array.from({ length: n }, (_, i) => realistic(i)) }) as any;

  test(`${BOARDS_PER_GATE} realistic boards, the most one gate carries, fit structured and open`, () => {
    const src = many(BOARDS_PER_GATE);
    const fit = fitOpen(src);
    expect(fit).toMatchObject({ mode: "structured", pane: { fits: true } });
    expect(boardsBudgetError(src, fit)).toBeNull();
  });

  test("25 boards are refused for the count, still structured, never prose", () => {
    const src = many(25);
    const fit = fitOpen(src);
    expect(fit.mode).toBe("structured");
    expect(boardsBudgetError(src, fit)).toBe(`boards@1: 25 boards; open at most ${BOARDS_PER_GATE} per gate`);
  });

  test("40 boards overflow the budget, stay structured, and are refused", () => {
    const src = many(40);
    const fit = fitOpen(src);
    expect(fit).toMatchObject({ mode: "structured", pane: { fits: false } });
    expect(JSON.parse(fit.context!)["gate-ctx"]).toBe("boards@1");
    expect(boardsBudgetError(src, fit)).toBe(`boards@1: 40 boards; open at most ${BOARDS_PER_GATE} per gate`);
  });

  test("a few boards whose captions alone overflow the budget are refused for the bytes", () => {
    const src = source({ boards: [board({ caption: "x".repeat(9000) })] }) as any;
    const fit = fitOpen(src);
    expect(fit).toMatchObject({ mode: "structured", pane: { fits: false } });
    expect(boardsBudgetError(src, fit)).toBe(`boards@1: 1 boards do not fit the ${PANE_PROSE_LIMIT}-byte budget`);
  });
});
