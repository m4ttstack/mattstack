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
  expect(renderPlain([{ t: "paragraph", text: "Two skills disagree." }])).toBe("Two skills disagree.\n");
  expect(renderPlain([{ t: "verbatim", caption: "value", lines: ["{", "}"] }])).toBe("value:\n  {\n  }\n");
  expect(renderPlain([{ t: "changes", changes: [{ op: "+", name: "review", hint: "now public" }, { op: "-", name: "triage" }] }])).toBe("+ review  now public\n- triage\n");
  expect(renderPlain([{ t: "diff", hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "context", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "c" }] }] }])).toBe(
    "@@ -1 +1 @@\n  a\n- b\n+ c\n",
  );
  expect(renderPlain([{ t: "banner", label: "PRODUCTION", subject: "db-replica", hint: "type the name to confirm" }])).toBe("PRODUCTION db-replica  type the name to confirm\n");
});

test("a failure prints why, next and details", () => {
  expect(
    renderPlain([{ t: "failure", title: "This Mac cannot read the team's secrets yet", why: "No key matches.", next: [{ text: "rt setup status", role: "command" }], details: "details are in the log" }]),
  ).toBe("[failed] This Mac cannot read the team's secrets yet\n  why: No key matches.\n  next: rt setup status\n  details are in the log\n");
});

test("plain output is cleaned of escapes and controls", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "evil\x1b[2Jname\x07", hint: "a\x1b]0;title\x07b" }])).toBe("[ok] evilname  ab\n");
  expect(renderPlain([{ t: "verbatim", lines: ["a\tb"] }])).toBe("  a\tb\n");
});

test("C1 controls and DEL are stripped like C0", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "a\x7fb\x80c\x9bd\x9fe\x00f" }])).toBe("[ok] abcdef\n");
});

test("no blocks render nothing, and the shared fixture renders without throwing", () => {
  expect(renderPlain([])).toBe("");
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures", "render-document.json"), "utf8")) as Block[];
  const text = renderPlain(fixture);
  expect(text.startsWith("\n")).toBe(false);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(text).not.toContain("\x1b");
});
