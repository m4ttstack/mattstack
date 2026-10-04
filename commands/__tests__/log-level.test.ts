import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { logLevelBlocks } from "../daemon.ts";

test("set names the new level; show is a row", () => {
  expect(renderPlain(logLevelBlocks({ ok: true, level: "debug" }, true).print)).toBe("[ok] Set the daemon's log level to debug\n");
  expect(renderPlain(logLevelBlocks({ ok: true, level: "info" }, false).print)).toBe("log level: info\n");
});

test("a daemon error is a failure titled in its words", () => {
  expect(logLevelBlocks({ ok: false, error: "bad level: loud" }, true).failure).toEqual({ title: "bad level: loud" });
});
