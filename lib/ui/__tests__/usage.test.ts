import { test, expect } from "bun:test";
import * as out from "../out.ts";
import { captureOut } from "./capture-out.ts";
import { usageFailure } from "../usage.ts";

test("the usage line is the next command, never part of the title", () => {
  expect(usageFailure("Which tool?", "rt tools install <tool>")).toEqual({ title: "Which tool?", next: { text: "rt tools install <tool>", role: "command" } });
});

test("a why rides along", () => {
  expect(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto.")).toEqual({
    title: "Which branch?",
    why: "This needs the branch to rebase onto.",
    next: { text: "rt git rebase onto <branch>", role: "command" },
  });
});

test("a leading usage: is dropped, so the --json string can be passed as it is", () => {
  expect(usageFailure("Which tool?", "usage: rt tools install <tool> [--json]").next).toEqual({ text: "rt tools install <tool> [--json]", role: "command" });
  expect(usageFailure("Which tool?", "  Usage:   rt tools install <tool>").next).toEqual({ text: "rt tools install <tool>", role: "command" });
});

test("off a terminal it reads title, why, then the command", () => {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    out.fail(usageFailure("Which branch?", "rt git rebase onto <branch>", "This needs the branch to rebase onto."));
    expect(io.stderr()).toBe("Which branch?\n  why: This needs the branch to rebase onto.\n  next: rt git rebase onto <branch>\n");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});
