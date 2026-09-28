import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { assembleBrief, fillSpawnSlots, stripAuthorNotes } from "../herd-brief.ts";

const HAPPY_TEMPLATE = [
  "# Job: <name>",
  "",
  "Goal: <goal>",
  "",
  "Paths: <paths>",
  "",
  "## Method",
  "",
  "<REQUIRED: describe the approach here>",
  "",
  "## Done",
  "",
  "Nothing else.",
  "",
].join("\n");

const STRATEGIES = [
  "## trivial",
  "",
  "```",
  "Do the trivial thing.",
  "```",
  "",
  "## other",
  "",
  "```",
  "Do other thing.",
  "```",
  "",
].join("\n");

describe("assembleBrief", () => {
  test("happy path fills a 3-slot template and splices in the strategy body", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("# Job: widget-job");
    expect(result.brief).toContain("Goal: ship the widget");
    expect(result.brief).toContain("Paths: src/**");
    expect(result.brief).toContain("Do the trivial thing.");
    expect(result.brief).not.toContain("<REQUIRED");
    expect(result.brief).not.toContain("<name>");
    expect(result.brief).not.toContain("<goal>");
    expect(result.brief).not.toContain("<paths>");
    expect(result.brief).toContain("## Done");
    expect(result.brief).toContain("Nothing else.");
  });

  test("unknown strategy name errors and names the available strategies", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "nonexistent" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unknown strategy 'nonexistent'; available: trivial, other");
  });

  test("leftover unfilled markers are reported and fail assembly", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget" }, // paths left unfilled
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.leftover).toEqual(["paths"]);
    expect(result.error).toBe("unfilled markers: paths");
  });

  test("an HTML comment is never a marker and survives assembly", () => {
    const result = assembleBrief({
      template: `${HAPPY_TEMPLATE}\nRun it in Bash. <!-- mcp-lint: allow -->\n`,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("Run it in Bash. <!-- mcp-lint: allow -->");
  });

  test("an HTML comment holding < or > survives whole", () => {
    const comment = "<!-- compare: x > y, a < b -->";
    const result = assembleBrief({
      template: `${HAPPY_TEMPLATE}\n${comment}\n`,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain(comment);
  });

  test("method-file variant bypasses the strategies file entirely", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "file", content: "Do exactly this custom thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("Do exactly this custom thing.");
    expect(result.brief).not.toContain("<REQUIRED");
  });

  test("indented example lines are excluded from marker substitution and the leftover check", () => {
    const templateWithIndentedExample = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "Paths: <paths>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Notes",
      "",
      "Example command:",
      "    echo <not-a-real-marker>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithIndentedExample,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("    echo <not-a-real-marker>");
  });

  test("a marker wrapped across a line break is still caught as leftover when unfilled", () => {
    // Mirrors the real job-template.md: word-wrapped prose puts the slot's
    // < and > on different physical lines.
    const templateWithWrappedMarker = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Inputs",
      "<paths the worker may read and must not modify -- supplied specs or",
      'plans, often gitignored. "none" if none.>',
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedMarker,
      job: "widget-job",
      fills: { goal: "ship the widget" }, // Inputs slot left unfilled
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.leftover).toEqual(['paths the worker may read and must not modify -- supplied specs or plans, often gitignored. "none" if none.']);
  });

  test("a wrapped marker is filled when the fill key uses collapsed whitespace", () => {
    const templateWithWrappedMarker = [
      "# Job: <name>",
      "",
      "## Inputs",
      "<paths the worker may read and must not modify -- supplied specs or",
      'plans, often gitignored. "none" if none.>',
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedMarker,
      job: "widget-job",
      fills: {
        'paths the worker may read and must not modify -- supplied specs or plans, often gitignored. "none" if none.':
          "none",
      },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("## Inputs\nnone");
  });

  test("decorative markers inside backticks or quotes in flowing prose are left literal, not flagged as leftover", () => {
    // Mirrors the real job-template.md boilerplate: illustrative command
    // syntax embeds its own <angle-bracket> placeholders in backticks or
    // quotes, meant for the eventual worker to fill in later -- not for
    // the assembler to fill now.
    const templateWithDecorativeExamples = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Messages",
      "Arrives as `[#<room>] <handle> #<n>: ...`.",
      "",
      "## Milestones",
      "Run `rt herd answer <id>`; a reviewer replies as `review-<your job>`.",
      "",
      "## Asking",
      'Options like "Walk me through <section> first".',
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithDecorativeExamples,
      job: "widget-job",
      fills: { goal: "ship the widget" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("`[#<room>] <handle> #<n>: ...`");
    expect(result.brief).toContain("`rt herd answer <id>`");
    expect(result.brief).toContain("`review-<your job>`");
    expect(result.brief).toContain('"Walk me through <section> first"');
  });

  test("decorative markers stay literal even when the enclosing backtick span itself wraps across lines", () => {
    // Mirrors the real job-template.md exactly: the backtick opens before
    // the line break and closes after it, with two markers inside.
    const templateWithWrappedBacktickSpan = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Asking",
      "naming the surface that recorded it: `[gate] <id> answered",
      "by <surface>; re-read the registry and proceed.` The daemon.",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedBacktickSpan,
      job: "widget-job",
      fills: { goal: "ship the widget" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("`[gate] <id> answered\nby <surface>; re-read the registry and proceed.`");
  });

  test("a stray unbalanced backtick in the method body cannot desync span detection in the surrounding template", () => {
    // The method body is domain-supplied free text (--method-file, or a
    // strategy author's prose) -- unlike the template's own fixed
    // boilerplate, its backtick/quote balance is not something this
    // assembler can assume. A stray backtick here must never cause a real
    // slot elsewhere in the document to be swallowed into a bogus
    // decorative span and shipped unfilled with no error.
    const template = [
      "# Job: <name>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Inputs",
      "<paths>",
      "",
      "## Notes",
      "Example: `sample`",
      "",
    ].join("\n");

    const result = assembleBrief({
      template,
      job: "widget-job",
      fills: {}, // <paths> deliberately left unfilled
      method: { kind: "file", content: "Odd backtick ` here." },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.leftover).toContain("paths");
  });

  test("an author note in the template is stripped before slots and the Method split", () => {
    const noted = [
      "# Job: <name>",
      "",
      "<!-- author -->",
      "Assembler only: fill <every slot>.",
      "## Method",
      "<!-- /author -->",
      "",
      "Goal: <goal>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Done",
      "",
    ].join("\n");
    const plain = ["# Job: <name>", "", "Goal: <goal>", "", "## Method", "", "<REQUIRED: describe the approach here>", "", "## Done", ""].join("\n");
    const inputs = { job: "j", fills: { goal: "g" }, method: { kind: "file" as const, content: "Do it." } };
    const withNote = assembleBrief({ ...inputs, template: noted });
    const without = assembleBrief({ ...inputs, template: plain });
    expect(withNote.ok).toBe(true);
    expect(withNote).toEqual(without);
    if (withNote.ok) expect(withNote.brief).not.toContain("Assembler only");
  });

  test("an author note in a method file is stripped", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "j",
      fills: { goal: "g", paths: "p" },
      method: { kind: "file", content: ["<!-- author -->", "Strategy author note.", "<!-- /author -->", "", "Do it."].join("\n") },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).not.toContain("Strategy author note");
    expect(result.brief).toContain("## Method\nDo it.\n\n## Done");
  });

  test("an unclosed note fails assembly naming its source", () => {
    const template = assembleBrief({
      template: ["<!-- author -->", HAPPY_TEMPLATE].join("\n"),
      job: "j",
      fills: { goal: "g", paths: "p" },
      method: { kind: "file", content: "Do it." },
    });
    expect(template).toEqual({ ok: false, error: "author note opened at template line 1 is never closed (<!-- /author --> missing)" });
    const method = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "j",
      fills: { goal: "g", paths: "p" },
      method: { kind: "file", content: ["Do it.", "<!-- author -->"].join("\n") },
    });
    expect(method).toEqual({ ok: false, error: "author note opened at method line 2 is never closed (<!-- /author --> missing)" });
  });

  test("author markers inside a backtick fence are kept and the brief assembles", () => {
    const template = HAPPY_TEMPLATE.replace("## Done\n", "## Done\n\n```\n<!-- author -->\n```\n");
    const result = assembleBrief({ template, job: "j", fills: { goal: "g", paths: "p" }, method: { kind: "file", content: "Do it." } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.brief).toContain("```\n<!-- author -->\n```");
  });

  test("an author note in a non-first strategy's body is stripped", () => {
    const strategiesWithNote = [
      "## trivial",
      "",
      "```",
      "Do the trivial thing.",
      "```",
      "",
      "## other",
      "",
      "```",
      "<!-- author -->",
      "Note text.",
      "<!-- /author -->",
      "Do other thing.",
      "```",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "j",
      fills: { goal: "g", paths: "p" },
      method: { kind: "strategy", strategies: strategiesWithNote, name: "other" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).not.toContain("Note text");
    expect(result.brief).not.toContain("<!-- author -->");
    expect(result.brief).toContain("Do other thing.");
  });

  test("an unclosed note in a non-first strategy's body reports the strategies.md line", () => {
    const strategiesUnclosed = [
      "## trivial",
      "",
      "```",
      "Do the trivial thing.",
      "```",
      "",
      "## other",
      "",
      "```",
      "Do other thing.",
      "<!-- author -->",
      "Note text.",
      "```",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "j",
      fills: { goal: "g", paths: "p" },
      method: { kind: "strategy", strategies: strategiesUnclosed, name: "other" },
    });

    // "<!-- author -->" sits on line 11 of strategiesUnclosed, counting from
    // "## trivial" as line 1.
    expect(result).toEqual({ ok: false, error: "author note opened at method line 11 is never closed (<!-- /author --> missing)" });
  });
});

describe("stripAuthorNotes", () => {
  const lines = (...l: string[]) => l.join("\n");

  test("a document with no markers comes back byte for byte", () => {
    const doc = lines("# T", "", "Body <slot>", "", "```", "code", "```", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: doc });
    expect(stripAuthorNotes(HAPPY_TEMPLATE, "template")).toEqual({ ok: true, text: HAPPY_TEMPLATE });
  });

  test("a preamble block is removed with its markers and leaves no double blank line", () => {
    const doc = lines("# T", "", "<!-- author -->", "Copy this verbatim.", "Fill the slots.", "<!-- /author -->", "", "Worker line.", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("# T", "", "Worker line.", "") });
  });

  test("a block at the start of the document drops the blank line after it", () => {
    const doc = lines("<!-- author -->", "note", "<!-- /author -->", "", "# T", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("# T", "") });
  });

  test("a block directly under a heading keeps the heading and the line after", () => {
    const doc = lines("# T", "<!-- author -->", "note", "<!-- /author -->", "", "Body", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("# T", "", "Body", "") });
  });

  test("a block at the end of the document keeps one trailing newline", () => {
    const doc = lines("Body", "", "<!-- author -->", "note", "<!-- /author -->", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("Body", "") });
  });

  test("several blocks are all removed", () => {
    const doc = lines("A", "", "<!-- author -->", "one", "<!-- /author -->", "", "B", "", "<!-- author -->", "two", "<!-- /author -->", "", "C");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("A", "", "B", "", "C") });
  });

  test("marker lines with trailing whitespace or CRLF endings are recognized", () => {
    const doc = "A\r\n\r\n<!-- author -->  \r\nnote\r\n<!-- /author -->\r\n\r\nB\r\n";
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: "A\r\n\r\nB\r\n" });
  });

  test("markers inside backtick and tilde fences are text", () => {
    const backtick = lines("```", "<!-- author -->", "x", "<!-- /author -->", "```", "");
    const tilde = lines("~~~~", "<!-- author -->", "~~~", "<!-- /author -->", "~~~~", "");
    expect(stripAuthorNotes(backtick, "template")).toEqual({ ok: true, text: backtick });
    expect(stripAuthorNotes(tilde, "template")).toEqual({ ok: true, text: tilde });
  });

  test("a fence line with an info string does not close an open fence", () => {
    const doc = lines("```", "```bash", "<!-- author -->", "```", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: doc });
  });

  test("an opener on the first line is recognized behind a byte order mark", () => {
    const doc = lines("\uFEFF<!-- author -->", "note", "<!-- /author -->", "", "# T", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("# T", "") });
    const unmarked = lines("\uFEFF# T", "");
    expect(stripAuthorNotes(unmarked, "template")).toEqual({ ok: true, text: unmarked });
  });

  test("an indented marker or a marker sharing its line is text", () => {
    const doc = lines("    <!-- author -->", "<!-- author --> inline", "x <!-- /author -->", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: doc });
  });

  test("a closer inside a fence inside a note is note text, not the closer", () => {
    const doc = lines("A", "", "<!-- author -->", "```", "<!-- /author -->", "```", "<!-- /author -->", "", "B");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: true, text: lines("A", "", "B") });
  });

  test("an unclosed opener fails naming the source and line", () => {
    const doc = lines("A", "", "<!-- author -->", "note", "");
    expect(stripAuthorNotes(doc, "method")).toEqual({ ok: false, error: "author note opened at method line 3 is never closed (<!-- /author --> missing)" });
  });

  test("a stray closer fails naming the source and line", () => {
    const doc = lines("A", "<!-- /author -->", "");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: false, error: "<!-- /author --> at template line 2 has no matching <!-- author -->" });
  });

  test("a nested opener fails naming both lines", () => {
    const doc = lines("<!-- author -->", "a", "<!-- author -->", "b", "<!-- /author -->", "<!-- /author -->");
    expect(stripAuthorNotes(doc, "template")).toEqual({ ok: false, error: "author note opened at template line 3 is inside the one opened at line 1; author notes do not nest" });
  });

  test("a startLine offset shifts every reported line number", () => {
    const unclosed = lines("A", "", "<!-- author -->", "note", "");
    expect(stripAuthorNotes(unclosed, "method", 10)).toEqual({
      ok: false,
      error: "author note opened at method line 12 is never closed (<!-- /author --> missing)",
    });

    const stray = lines("A", "<!-- /author -->", "");
    expect(stripAuthorNotes(stray, "method", 10)).toEqual({
      ok: false,
      error: "<!-- /author --> at method line 11 has no matching <!-- author -->",
    });

    const nested = lines("<!-- author -->", "a", "<!-- author -->", "b", "<!-- /author -->", "<!-- /author -->");
    expect(stripAuthorNotes(nested, "method", 10)).toEqual({
      ok: false,
      error: "author note opened at method line 12 is inside the one opened at line 10; author notes do not nest",
    });
  });
});

describe("spawn-filled slots (RT-356)", () => {
  const TEMPLATE = "# JOB: <name>\n\n## Method\n<method>\n\n## Messages\nDM <shepherd handle> (id <shepherd id>) when stuck.\n";
  const method = { kind: "file" as const, content: "do it" };
  const SPAWN = { "shepherd handle": "shepherd", "shepherd id": "shepherd.k3f9" };

  test("unfilled spawn slots are not leftovers and pass through verbatim", () => {
    const r = assembleBrief({ template: TEMPLATE, job: "j", fills: {}, method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("DM <shepherd handle> (id <shepherd id>) when stuck.");
  });

  test("an explicit fill still wins, leaving spawn nothing to replace", () => {
    const r = assembleBrief({ template: TEMPLATE, job: "j", fills: { "shepherd handle": "ann", "shepherd id": "ann.x1y2" }, method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("DM ann (id ann.x1y2) when stuck.");
    expect(fillSpawnSlots(r.brief, SPAWN)).toBe(r.brief);
  });

  test("other unfilled markers are still refused", () => {
    const r = assembleBrief({ template: TEMPLATE + "<paths>\n", job: "j", fills: {}, method });
    expect(r).toMatchObject({ ok: false, leftover: ["paths"] });
  });

  test("fillSpawnSlots fills both slots, including markers wrapped across a line", () => {
    expect(fillSpawnSlots("to <shepherd handle>, and\n<shepherd\nhandle> (id <shepherd\nid>) again", SPAWN)).toBe(
      "to shepherd, and\nshepherd (id shepherd.k3f9) again",
    );
  });

  test("fillSpawnSlots leaves comments, other markers and unknown slots alone", () => {
    const text = "x <!-- mcp-lint: allow --> <id> <paths>";
    expect(fillSpawnSlots(text, { ...SPAWN, paths: "p" })).toBe(text);
  });

  test("the real job template names the shepherd and tells the worker to DM the id", () => {
    const template = readFileSync(join(import.meta.dir, "../../plugins/mattstack/attachments/orchestration/shepherdr/references/job-template.md"), "utf8");
    const probe = assembleBrief({ template, job: "j", fills: {}, method });
    const leftover = probe.ok ? [] : (probe.leftover ?? []);
    const r = assembleBrief({ template, job: "j", fills: Object.fromEntries(leftover.map((n) => [n, "x"])), method });
    if (!r.ok) throw new Error(r.error);
    expect(r.brief).toContain("<shepherd handle>");
    expect(r.brief).toContain("<shepherd id>");
    const brief = fillSpawnSlots(r.brief, SPAWN);
    const messages = brief.slice(brief.indexOf("## Messages"), brief.indexOf("## Git"));
    expect(messages).toMatch(/Your shepherd is shepherd in chat\s+\(id shepherd\.k3f9\)/);
    expect(messages).toMatch(/`chat_dm` to\s+shepherd\.k3f9\b/);
    expect(brief).not.toMatch(/<shepherd\s+(?:handle|id)>/);
    for (const bare of BARE_SHEPHERD_TARGETS) expect(brief).not.toMatch(bare);
  });

  test("the bare-shepherd probes catch a bare target but not a realistic id", () => {
    const hits = ["chat_dm shepherd", "chat dm `shepherd`", "`chat_dm` to shepherd.", "to: `shepherd`,", "to = shepherd", "`to` = `shepherd`", "\"to\": \"shepherd\""];
    for (const text of hits) expect(BARE_SHEPHERD_TARGETS.some((re) => re.test(text))).toBe(true);
    const misses = ["`chat_dm` to shepherd.k3f9", "to = shepherd.k3f9", "`to` = `shepherd.k3f9`", "chat_dm shepherd.k3f9"];
    for (const text of misses) expect(BARE_SHEPHERD_TARGETS.some((re) => re.test(text))).toBe(false);
  });
});

// `shepherd` as a DM target, not followed by `.<suffix>` (a minted id).
const BARE_SHEPHERD = String.raw`[\x60"]?shepherd(?!\.\w|[\w-])[\x60"]?`;
const BARE_SHEPHERD_TARGETS = [
  new RegExp(String.raw`(?:chat_dm|chat dm)[\x60"]?\s+(?:to\s+)?` + BARE_SHEPHERD),
  new RegExp(String.raw`\bto[\x60"]?\s*(?::|=)?\s+` + BARE_SHEPHERD),
];
