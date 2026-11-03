import { describe, expect, test } from "bun:test";
import { join } from "path";
import { JQ_DIR, runJq } from "./jq.ts";

const BOARD_CWDS = join(JQ_DIR, "board-cwds.jq");
const HOME = "/Users/tester";
const REPO = "gitlab.com/acme/widgets";

interface Row { id: string; status: string; action: unknown }
const placeRow = (identity: string, checkoutPath: string | null, board: boolean): Row => ({
  id: `repos.place:${identity}`,
  status: "ready",
  action: { type: "place-repo", identity, checkoutPath, board: board ? "The board's review, respond and doctor agents start here" : null },
});

function verdict(rows: Row[], cwds: unknown, want = REPO): { kind: string; msg: string }[] {
  const status = { contract: 1, groups: [{ id: "repos", title: "Your repos", rows }] };
  return runJq(["-r", "--argjson", "cwds", JSON.stringify(cwds), "--arg", "want", want, "--arg", "home", HOME, "-f", BOARD_CWDS], JSON.stringify(status))
    .trim()
    .split("\n")
    .map((l) => {
      const [kind = "", msg = ""] = l.split("\t");
      return { kind, msg };
    });
}
const kinds = (v: { kind: string }[]) => v.map((x) => x.kind);

const PLACED = `${HOME}/Documents/GitHub/widgets`;
const all = (p: string) => ({ value: { review: p, respond: p, doctor: p } });

describe("board-cwds.jq", () => {
  test("all three folders on the placed checkout of the board's repo pass", () => {
    expect(kinds(verdict([placeRow(REPO, PLACED, true)], all(PLACED)))).toEqual(["ok"]);
  });

  test("a tilde path counts as the same folder", () => {
    expect(kinds(verdict([placeRow(REPO, PLACED, true)], all("~/Documents/GitHub/widgets")))).toEqual(["ok"]);
  });

  test("a folder that is a checkout but not the placed one fails", () => {
    const v = verdict([placeRow(REPO, PLACED, true)], all(`${HOME}/code/other`));
    expect(kinds(v)).toEqual(["bad"]);
    expect(v[0]!.msg).toContain(PLACED);
  });

  test("one of the three folders elsewhere fails", () => {
    const v = verdict([placeRow(REPO, PLACED, true)], { value: { review: PLACED, respond: PLACED, doctor: `${HOME}/x` } });
    expect(kinds(v)).toEqual(["bad"]);
  });

  test("no board.cwds at all fails", () => {
    expect(kinds(verdict([placeRow(REPO, PLACED, true)], {}))).toEqual(["bad"]);
  });

  test("a team that tracks no repo fails and says so", () => {
    const v = verdict([], all(PLACED));
    expect(kinds(v)).toEqual(["bad"]);
    expect(v[0]!.msg).toContain("tracks no repo");
  });

  test("the board's repo must be the one the walkthrough tracked", () => {
    const v = verdict([placeRow("gitlab.com/acme/gadgets", PLACED, true)], all(PLACED));
    expect(kinds(v)).toEqual(["bad"]);
    expect(v[0]!.msg).toContain(REPO);
  });

  test("with no repo named, the row that carries the board line is the board's repo", () => {
    expect(kinds(verdict([placeRow("gitlab.com/acme/gadgets", "/x", false), placeRow(REPO, PLACED, true)], all(PLACED), ""))).toEqual(["ok"]);
  });

  test("a board repo row with no placed checkout fails", () => {
    expect(kinds(verdict([placeRow(REPO, null, true)], all(PLACED)))).toEqual(["bad"]);
  });
});
