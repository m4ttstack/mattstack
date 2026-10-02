import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { compileBlocks, compileFailure, misplacedFailure } from "../skills.ts";

test("a compile lists each verb, with its warnings under it", () => {
  expect(
    renderPlain(
      compileBlocks(
        [
          { name: "watch-ci", side: "skills", files: 3, warnings: ["slot forge is bound but unused"] },
          { name: "ship", side: "attachments", files: 1, warnings: [] },
        ],
        true,
      ),
    ),
  ).toBe("[warning] Compiled watch-ci  3 files in skills/\n  note: slot forge is bound but unused\n[ok] Compiled ship  1 file in attachments/\n");
});

test("a row with only informational notes is done, and the note is not labelled twice", () => {
  expect(
    renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 1, warnings: ["note: acme:qa-gates is surface-internal; inlined"] }], true)),
  ).toBe("[ok] Compiled watch-ci  1 file in skills/\n  note: acme:qa-gates is surface-internal; inlined\n");
});

test("two warnings are one note, one line each", () => {
  expect(renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 2, warnings: ["first thing", "note: second thing"] }], true))).toBe(
    "[warning] Compiled watch-ci  2 files in skills/\n  note: first thing\n        second thing\n",
  );
});

test("a dry run says what it would write", () => {
  expect(renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 3, warnings: [] }], false))).toBe("[not yet] watch-ci  would write 3 files\n");
});

test("an empty compile says so", () => {
  expect(renderPlain(compileBlocks([], true))).toBe("[skipped] Nothing to compile  this pack has no verbs\n");
});

test("compile failures are one failure with every message under it", () => {
  expect(renderPlain([out.failure(compileFailure(['verb "a": slot "forge" has no binding', 'verb "b": engine not found']))])).toBe(
    '2 verbs did not compile\n  verb "a": slot "forge" has no binding\n  verb "b": engine not found\n',
  );
  expect(compileFailure(["only one"]).title).toBe("1 verb did not compile");
});

test("a misplaced skill names the fix", () => {
  expect(renderPlain([out.failure(misplacedFailure(["helper"]))])).toBe(
    "helper is in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n",
  );
  expect(renderPlain([out.failure(misplacedFailure(["a", "b"]))])).toBe(
    "2 skills are in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n  a\n  b\n",
  );
});
