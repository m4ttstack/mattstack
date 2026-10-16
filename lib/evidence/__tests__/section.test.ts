import { describe, expect, test } from "bun:test";
import { readEvidence } from "../../../packages/rt-client/src/evidence.ts";
import { appendixProblem, type FileLink, renderSection, spliceSection } from "../section.ts";

const up = (p: string): FileLink => {
  const name = p.split("/").pop()!.replace(/\.[a-z]+$/, "");
  return { markdown: `![${name}](/uploads/h/${p.split("/").pop()})` };
};
const rec = (v: unknown) => readEvidence(JSON.stringify(v));

describe("renderSection", () => {
  test("single annotated image rewrites the alt text and prints the caption", () => {
    const r = rec({ v: 2, cases: [{ id: "retry-badge", label: "Retry badge on the job row", before: { path: "/b.png", annotated: "/before-annotated.png", caption: "Red box: the badge reads 0" } }] });
    expect(renderSection(r, up, {})).toBe(
      "**Retry badge on the job row**\n\n- Before: ![before](/uploads/h/before-annotated.png)\n  Caption: Red box: the badge reads 0",
    );
  });

  test("a shared board prints once; a waived dark image prints its own waiver", () => {
    const r = rec({
      v: 2,
      cases: [{
        id: "c", label: "Case",
        before: { light: { path: "/b.png", annotated: "/pair.png", caption: "Both" } },
        after: { light: { path: "/a.png", annotated: "/pair.png" }, dark: { path: "/d.png", waiver: "same marks" } },
      }],
    });
    const out = renderSection(r, up, {});
    expect(out).toContain("- Before and after (light): ![before and after](/uploads/h/pair.png)\n  Caption: Both");
    expect(out).toContain("- After (dark): ![after](/uploads/h/d.png)");
    expect(out).toContain("  Waived: same marks");
    expect(out.match(/pair\.png/g)?.length).toBe(1);
  });

  test("a case waiver prints once under the label, not per image", () => {
    const r = rec({ v: 2, cases: [{ id: "c", label: "Case", waiver: "w", before: { path: "/b.png" }, after: { path: "/a.png" } }] });
    const out = renderSection(r, up, {});
    expect(out.match(/Waived: w/g)?.length).toBe(1);
    expect(out).toContain("**Case**\n\nWaived: w\n\n- Before:");
    expect(out).not.toContain("  Waived:");
  });

  test("a local link prints the bare path", () => {
    const r = rec({ v: 2, cases: [{ id: "c", label: "Case", before: { path: "/b.png", annotated: "/abs/b.png" } }] });
    expect(renderSection(r, (p) => ({ local: p }), {})).toContain("- Before: /abs/b.png");
  });

  test("trailing lines come in order and covered attach lines drop", () => {
    const r = rec({
      v: 2,
      cases: [{ id: "c", label: "Case", before: { path: "/b.png", annotated: "/b-annotated.png" } }],
      transcript: "/t.txt", url: "https://t",
      attach: "![x](/b-annotated.png)\n![y](/uploads/h/other.png)\n![z](/uploads/h/b-annotated.png)",
    });
    const out = renderSection(r, up, { coveredUrls: new Set(["/uploads/h/b-annotated.png"]), appendix: "<details>\nA\n</details>" });
    const tail = out.slice(out.indexOf("Transcript:"));
    expect(tail).toBe("Transcript: /t.txt\n\nTicket: https://t\n\n![y](/uploads/h/other.png)\n\n<details>\nA\n</details>");
    expect(out).not.toContain("![x]");
    expect(out).not.toContain("![z]");
  });

  test("multi-line captions, waivers and labels stay on one line", () => {
    const r = rec({ v: 2, cases: [{ id: "c", label: "A\n\n## L", waiver: "w\n## W", before: { path: "/b.png", annotated: "/b.png", caption: "cap\n\n## Injected" } }] });
    const out = renderSection(r, up, {});
    expect(out).toContain("Caption: cap ## Injected");
    expect(out.split("\n").filter((l) => l.startsWith("#"))).toEqual([]);
    const d = "## Evidence\nold\n\n## Next\n";
    const once = spliceSection(d, "## Evidence", out);
    expect(spliceSection(once, "## Evidence", out)).toBe(once);
  });

  test("legacy links form a tight list", () => {
    const out = renderSection(readEvidence("see /a.png and https://x.example/y"), (p) => ({ local: p }), {});
    expect(out).toBe("- /a.png\n- https://x.example/y");
  });

  test("an empty record renders nothing", () => {
    expect(renderSection(readEvidence(null), up, {})).toBe("");
  });
});

describe("spliceSection", () => {
  const doc = "# T\n\n## Evidence\n_helper_\n\nold\n\n## Checklist\n- [ ] x\n";

  test("replaces the section and keeps the helper and later text", () => {
    expect(spliceSection(doc, "## Evidence", "NEW")).toBe("# T\n\n## Evidence\n_helper_\n\nNEW\n\n## Checklist\n- [ ] x\n");
  });

  test("ignores the heading inside a fence", () => {
    const d = "```\n## Evidence\n```\n\n## Evidence\nold\n";
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("```\n## Evidence\n```\n\n## Evidence\n\nNEW\n");
  });

  test("only the first heading counts", () => {
    const d = "## Evidence\nold\n\n## Evidence\nsecond\n";
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("## Evidence\n\nNEW\n\n## Evidence\nsecond\n");
  });

  test("a deeper heading stays inside the section", () => {
    const d = "## Evidence\nold\n### Sub\nx\n## Next\n";
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("## Evidence\n\nNEW\n\n## Next\n");
  });

  test("inserts above before, else appends", () => {
    const d = "# T\n\n## Checklist\n- [ ] x\n";
    expect(spliceSection(d, "## Evidence", "NEW", "## Checklist")).toBe("# T\n\n## Evidence\n\nNEW\n\n## Checklist\n- [ ] x\n");
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("# T\n\n## Checklist\n- [ ] x\n\n## Evidence\n\nNEW\n");
  });

  test("splicing twice is a no-op", () => {
    for (const args of [[doc, "## Evidence"], ["# T\n\n## Checklist\n", "## Evidence", "## Checklist"]] as const) {
      const once = spliceSection(args[0], args[1], "NEW", args[2]);
      expect(spliceSection(once, args[1], "NEW", args[2])).toBe(once);
    }
  });

  test("keeps an HTML comment block under the heading", () => {
    const d = "## Evidence\n<!--\nfill in\n-->\nold\n";
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("## Evidence\n<!--\nfill in\n-->\n\nNEW\n");
  });

  test("a deeper before heading ends the section and survives", () => {
    const d = "## Evidence\nold\n\n### Checklist\n- [ ] x\n";
    const once = spliceSection(d, "## Evidence", "NEW", "### Checklist");
    expect(once).toBe("## Evidence\n\nNEW\n\n### Checklist\n- [ ] x\n");
    expect(spliceSection(once, "## Evidence", "NEW", "### Checklist")).toBe(once);
  });

  test("CRLF descriptions keep CRLF", () => {
    const d = "# T\r\n\r\n## Evidence\r\n_h_\r\n\r\nold\r\n\r\n## Next\r\nx\r\n";
    const once = spliceSection(d, "## Evidence", "A\n\nB");
    expect(once).toBe("# T\r\n\r\n## Evidence\r\n_h_\r\n\r\nA\r\n\r\nB\r\n\r\n## Next\r\nx\r\n");
    expect(spliceSection(once, "## Evidence", "A\n\nB")).toBe(once);
    expect(spliceSection("a\r\n", "## E", "N")).toBe("a\r\n\r\n## E\r\n\r\nN\r\n");
  });

  const twice = (d: string, body: string, before?: string) => {
    const once = spliceSection(d, "## Evidence", body, before);
    return { once, again: spliceSection(once, "## Evidence", body, before) };
  };
  const tail = "## Evidence\n\nold\n\n## Checklist\n- [ ] x\n";

  test("an appendix with a deeper heading stays inside the section on every splice", () => {
    const { once, again } = twice(tail, "**Case**\n\n<details>\n\n### Log\n\nline\n\n</details>");
    expect(again).toBe(once);
    expect(once.endsWith("</details>\n\n## Checklist\n- [ ] x\n")).toBe(true);
  });

  test("a body starting with an italic line is not kept as a helper on the next splice", () => {
    const { once, again } = twice("## Evidence\n\nold\n", "_note_\n\nmore");
    expect(once).toBe("## Evidence\n\n_note_\n\nmore\n");
    expect(again).toBe(once);
  });

  test("a template helper and an italic body line both survive, once each", () => {
    const { once, again } = twice("## Evidence\n_helper_\n\nold\n", "_note_\n\nmore");
    expect(once).toBe("## Evidence\n_helper_\n\n_note_\n\nmore\n");
    expect(again).toBe(once);
  });

  test("a body starting with an HTML comment is not kept as a helper on the next splice", () => {
    const { once, again } = twice("## Evidence\n\nold\n", "<!-- n -->\nmore");
    expect(again).toBe(once);
  });

  test("an unclosed HTML comment under the heading is not a helper and does not swallow the section", () => {
    const d = "## Evidence\n<!-- fill in\nold\n\n## Checklist\n- [ ] x\n";
    expect(spliceSection(d, "## Evidence", "NEW")).toBe("## Evidence\n\nNEW\n\n## Checklist\n- [ ] x\n");
  });

  test("legacy attach lines that look like a heading or a fence are escaped and splice idempotently", () => {
    for (const attach of ["## Old evidence\n/x.png", "```\n/x.png", "~~~ log\n/x.png", "# Top"]) {
      const section = renderSection(rec({ v: 2, cases: [{ id: "a", label: "A", before: { path: "/a.png", waiver: "w" } }], attach }), (p) => ({ local: p }), {});
      expect(section).not.toMatch(/^ {0,3}(#|```|~~~)/m);
      const { once, again } = twice(tail, section);
      expect(again).toBe(once);
      expect(once.endsWith("## Checklist\n- [ ] x\n")).toBe(true);
    }
    const section = renderSection(rec({ v: 2, cases: [{ id: "a", label: "A", before: { path: "/a.png", waiver: "w" } }], attach: "## Old" }), (p) => ({ local: p }), {});
    expect(section).toContain("\\## Old");
  });
});

describe("appendixProblem", () => {
  test("a deeper heading is fine; a heading at or above the section level is named", () => {
    expect(appendixProblem("### sub\n\ntext", "## Evidence")).toBeNull();
    expect(appendixProblem("## Log", "## Evidence")).toContain("## Log");
    expect(appendixProblem("# Top", "## Evidence")).toContain("# Top");
  });

  test("a heading inside a closed fence is fine; an unbalanced fence is named", () => {
    expect(appendixProblem("```\n## not a heading\n```", "## Evidence")).toBeNull();
    expect(appendixProblem("```\nlog without close", "## Evidence")).toContain("fence");
  });
});
