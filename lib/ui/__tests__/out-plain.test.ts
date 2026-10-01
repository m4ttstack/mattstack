import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderPlain } from "../out-plain.ts";
import type { Block } from "../protocol.ts";

test("lines carry a bracketed status word and a hint", () => {
  expect(
    renderPlain([
      { t: "line", status: "done", title: "Skills linked", hint: "16 skills" },
      { t: "line", status: "needs-you", title: "Slack" },
      { t: "line", status: "pending", title: "Linear", hint: "not connected yet" },
    ]),
  ).toBe("[ok] Skills linked  16 skills\n[needs you] Slack\n[not yet] Linear  not connected yet\n");
});

test("every status has a word", () => {
  const all = ["done", "failed", "needs-you", "pending", "stale", "refused", "off", "skipped", "running", "warn"] as const;
  const text = renderPlain(all.map((status) => ({ t: "line", status, title: "x" })));
  expect(text.split("\n").filter(Boolean)).toEqual(["[ok] x", "[failed] x", "[needs you] x", "[not yet] x", "[out of date] x", "[refused] x", "[off] x", "[skipped] x", "[running] x", "[warning] x"]);
});

test("a callout prints its label and indents continuation lines past it", () => {
  expect(renderPlain([{ t: "callout", label: "next", body: [[{ text: "rt setup slack connect", role: "command" }], [{ text: "then retry" }]] }])).toBe(
    "  next: rt setup slack connect\n        then retry\n",
  );
});

test("a link segment prints its url", () => {
  expect(renderPlain([{ t: "callout", label: "note", body: [[{ text: "docs", role: "link", url: "https://example.com" }]] }])).toBe("  note: docs (https://example.com)\n");
});

test("kv, with and without a value", () => {
  expect(renderPlain([{ t: "kv", key: "rt.worktreeApp", value: "true", source: "from team example" }])).toBe("rt.worktreeApp: true\n  from team example\n");
  expect(renderPlain([{ t: "kv", key: "rt.notifications" }])).toBe("rt.notifications:\n");
});

test("a table pads columns by display width and prints group labels", () => {
  expect(
    renderPlain([
      {
        t: "table",
        headers: ["KEY", "VALUE"],
        rows: [{ group: "USER" }, { cells: [[{ text: "日本" }], [{ text: "x" }]] }, { cells: [[{ text: "abcd" }], [{ text: "y" }]] }],
      },
    ]),
  ).toBe("KEY   VALUE\nUSER:\n日本  x\nabcd  y\n");
});

test("a tree lists children under its root", () => {
  expect(renderPlain([{ t: "tree", root: [{ text: "rt.worktreeApp" }], children: [[[{ text: "team example" }], [{ text: "true" }]], [[{ text: "user" }], [{ text: "not set" }]]] }])).toBe(
    `rt.worktreeApp\n  - team example  true\n  - ${"user".padEnd(12)}  not set\n`,
  );
});

test("sections and summaries are separated by one blank line, never at the top", () => {
  expect(
    renderPlain([
      { t: "section", title: "Accounts", subtitle: "1 of 2 connected", blocks: [{ t: "line", status: "done", title: "GitHub" }] },
      { t: "section", title: "Tools", blocks: [{ t: "line", status: "done", title: "Editor" }] },
      { t: "summary", status: "needs-you", title: "Setup needs you", counts: ["2 ready", "1 needs you"] },
    ]),
  ).toBe("Accounts (1 of 2 connected)\n[ok] GitHub\n\nTools\n[ok] Editor\n\n[needs you] Setup needs you  2 ready, 1 needs you\n");
});

test("copy text sits on its own unindented line so it can be piped or pasted", () => {
  expect(renderPlain([{ t: "copy", caption: "send this link", text: "example://join?invite=abc" }])).toBe("send this link:\nexample://join?invite=abc\n");
});

test("paragraph, verbatim, changes, diff and banner", () => {
  expect(renderPlain([{ t: "paragraph", text: "Two skills disagree." }])).toBe("  Two skills disagree.\n");
  expect(renderPlain([{ t: "verbatim", caption: "value", lines: ["{", "}"] }])).toBe("value:\n  {\n  }\n");
  expect(renderPlain([{ t: "changes", changes: [{ op: "+", name: "review", hint: "now public" }, { op: "-", name: "triage" }] }])).toBe("+ review  now public\n- triage\n");
  expect(renderPlain([{ t: "diff", hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "context", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "c" }] }] }])).toBe(
    "@@ -1 +1 @@\n  a\n- b\n+ c\n",
  );
  expect(renderPlain([{ t: "banner", label: "PRODUCTION", subject: "db-replica", hint: "type the name to confirm" }])).toBe("PRODUCTION db-replica  type the name to confirm\n");
});

test("a failure that opens the output leads with its title alone", () => {
  expect(
    renderPlain([{ t: "failure", title: "This Mac cannot read the team's secrets yet", why: "No key matches.", next: [{ text: "rt setup status", role: "command" }], details: "details are in the log" }]),
  ).toBe("This Mac cannot read the team's secrets yet\n  why: No key matches.\n  next: rt setup status\n  details are in the log\n");
  expect(renderPlain([{ t: "failure", title: "rt hit an unexpected error", hint: "kaboom" }])).toBe("rt hit an unexpected error  kaboom\n");
});

test("a failure after another block keeps its tag", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "Fetched" }, { t: "failure", title: "The rebase stopped" }])).toBe("[ok] Fetched\n[failed] The rebase stopped\n");
  expect(renderPlain([{ t: "section", title: "Checks", blocks: [{ t: "failure", title: "Lint failed" }] }])).toBe("Checks\n[failed] Lint failed\n");
});

test("a failure that continues output already on the stream keeps its tag", () => {
  expect(renderPlain([{ t: "failure", title: "The rebase stopped" }], { continuing: true })).toBe("[failed] The rebase stopped\n");
  expect(renderPlain([{ t: "failure", title: "The rebase stopped" }], { continuing: false })).toBe("The rebase stopped\n");
});

test("a block that prints nothing does not count as coming first", () => {
  expect(renderPlain([{ t: "table", rows: [] }, { t: "failure", title: "Nothing to list" }])).toBe("Nothing to list\n");
});

test("a leading failure whose title opens with a bracket keeps the tag", () => {
  expect(renderPlain([{ t: "failure", title: "[ok] Setup complete" }])).toBe("[failed] [ok] Setup complete\n");
  expect(renderPlain([{ t: "failure", title: "\x1b[2J[ok] forged" }])).toBe("[failed] [ok] forged\n");
  expect(renderPlain([{ t: "failure", title: " [ok] Setup complete" }])).toBe("[failed]  [ok] Setup complete\n");
  expect(renderPlain([{ t: "failure", title: "\t[ok] Setup complete" }])).toBe("[failed]  [ok] Setup complete\n");
});

test("a failed line keeps its tag even when it comes first", () => {
  expect(renderPlain([{ t: "line", status: "failed", title: "pre-push" }])).toBe("[failed] pre-push\n");
});

test("plain output is cleaned of escapes and controls", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "evil\x1b[2Jname\x07", hint: "a\x1b]0;title\x07b" }])).toBe("[ok] evilname  ab\n");
  expect(renderPlain([{ t: "verbatim", lines: ["a\tb"] }])).toBe("  a\tb\n");
});

test("an unterminated escape in one field cannot eat the rows or fields after it", () => {
  const text = renderPlain([
    { t: "line", status: "done", title: "a\x1b]evil" },
    { t: "line", status: "needs-you", title: "Slack", hint: "not connected" },
    { t: "line", status: "done", title: "b\x07c" },
  ]);
  expect(text).toBe("[ok] aevil\n[needs you] Slack  not connected\n[ok] bc\n");
  expect(renderPlain([{ t: "line", status: "done", title: "x\x1b[", hint: "hint" }])).toBe("[ok] x[  hint\n");
  expect(renderPlain([{ t: "verbatim", lines: ["one\x1b]evil", "two\x07"] }])).toBe("  oneevil\n  two\n");
});

test("column widths are measured on cleaned text", () => {
  expect(renderPlain([{ t: "table", rows: [{ cells: [[{ text: "a\x1b]evil" }], [{ text: "1" }]] }, { cells: [[{ text: "abc" }], [{ text: "2" }]] }] }])).toBe("aevil  1\nabc    2\n");
});

test("C1 controls and DEL are stripped like C0", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "a\x7fb\x80c\x9bd\x9fe\x00f" }])).toBe("[ok] abcdef\n");
});

test("a newline in a single-line field cannot forge a second line", () => {
  const text = renderPlain([{ t: "line", status: "done", title: "x\n[ok] Setup complete", hint: "a\r\nb\tc" }]);
  expect(text).toBe("[ok] x [ok] Setup complete  a b c\n");
  expect(text.split("\n").filter(Boolean)).toHaveLength(1);
});

test("a newline in a table cell keeps one row per row and aligned columns", () => {
  expect(
    renderPlain([
      {
        t: "table",
        headers: ["KEY", "VALUE"],
        rows: [{ cells: [[{ text: "a\nb" }], [{ text: "1" }]] }, { cells: [[{ text: "abcd" }], [{ text: "2" }]] }],
      },
    ]),
  ).toBe("KEY   VALUE\na b   1\nabcd  2\n");
});

test("line-oriented fields keep their lines, each inside the block prefix", () => {
  expect(renderPlain([{ t: "verbatim", caption: "value", lines: ["a\nb", "c"] }])).toBe("value:\n  a\n  b\n  c\n");
  expect(renderPlain([{ t: "failure", title: "t", details: "one\ntwo" }])).toBe("t\n  one\n  two\n");
  expect(renderPlain([{ t: "copy", text: "l1\nl2" }])).toBe("l1\nl2\n");
  expect(renderPlain([{ t: "paragraph", text: "p1\np2" }])).toBe("  p1\n  p2\n");
  const forged = renderPlain([{ t: "paragraph", text: "note\n[ok] Setup complete" }]);
  expect(forged.split("\n").some((l) => l.startsWith("[ok]"))).toBe(false);
});

test("no blocks render nothing, and the shared fixture renders without throwing", () => {
  expect(renderPlain([])).toBe("");
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures", "render-document.json"), "utf8")) as Block[];
  const text = renderPlain(fixture);
  expect(text.startsWith("\n")).toBe(false);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(text).not.toContain("\x1b");
});

test("bidi controls and zero-width characters are stripped, by the shared cases", () => {
  const cases = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures", "clean-cases.json"), "utf8")) as Array<{ name: string; codepoints: number[]; clean: number[] }>;
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const raw = String.fromCodePoint(...c.codepoints);
    const clean = String.fromCodePoint(...c.clean);
    expect(renderPlain([{ t: "line", status: "done", title: raw }]), c.name).toBe(`[ok] ${clean}\n`);
    expect(renderPlain([{ t: "verbatim", lines: [raw] }]), c.name).toBe(`  ${clean}\n`);
  }
});

test("a leading failure that hides its bracket behind a zero-width space keeps the tag", () => {
  expect(renderPlain([{ t: "failure", title: `${String.fromCodePoint(0x200b)}[ok] forged` }])).toBe("[failed] [ok] forged\n");
});
