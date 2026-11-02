import { describe, expect, test } from "bun:test";
import { addDirectOnly, removeDirectOnly, sourceSetsDirectOnly } from "../direct-only-line";

const plain = "---\nname: ping\ndescription: Pings.\n---\n\n# Ping\n\nBody.\n";
const falseForm = "---\nname: ping\ndisable-model-invocation: false\ndescription: Pings.\n---\n\nBody.\n";
const crlf = "---\r\nname: ping\r\ndescription: Pings.\r\n---\r\n\r\nBody.\r\n";
const unmarkedTrue = "---\nname: ping\ndisable-model-invocation: true\n---\n\nBody.\n";
const bodyOnly = "---\nname: ping\n---\n\ndisable-model-invocation: true\n";

describe("direct-only line", () => {
  test("addDirectOnly puts the marked line last in the frontmatter", () => {
    expect(addDirectOnly(plain)).toBe(
      "---\nname: ping\ndescription: Pings.\ndisable-model-invocation: true # rt: direct-only\n---\n\n# Ping\n\nBody.\n",
    );
  });

  test("addDirectOnly is idempotent on its own output", () => {
    const once = addDirectOnly(plain)!;
    expect(addDirectOnly(once)).toBe(once);
  });

  test("addDirectOnly leaves an unmarked true byte-identical", () => {
    expect(addDirectOnly(unmarkedTrue)).toBe(unmarkedTrue);
  });

  test("addDirectOnly turns false into the marked was-false form", () => {
    expect(addDirectOnly(falseForm)).toBe(
      "---\nname: ping\ndisable-model-invocation: true # rt: direct-only (was false)\ndescription: Pings.\n---\n\nBody.\n",
    );
  });

  test("removeDirectOnly undoes addDirectOnly for plain, false and CRLF", () => {
    for (const x of [plain, falseForm, crlf]) {
      expect(removeDirectOnly(addDirectOnly(x)!)).toBe(x);
    }
  });

  test("addDirectOnly matches the file's CRLF line ending", () => {
    expect(addDirectOnly(crlf)).toContain("\r\ndisable-model-invocation: true # rt: direct-only\r\n---");
  });

  test("removeDirectOnly leaves an unmarked true alone", () => {
    expect(removeDirectOnly(unmarkedTrue)).toBe(unmarkedTrue);
  });

  test("addDirectOnly returns null with no frontmatter", () => {
    expect(addDirectOnly("# Just a body\n")).toBeNull();
    expect(addDirectOnly("---\nname: unclosed\n")).toBeNull();
  });

  test("sourceSetsDirectOnly is true only for an unmarked true", () => {
    expect(sourceSetsDirectOnly(unmarkedTrue)).toBe(true);
    expect(sourceSetsDirectOnly(plain)).toBe(false);
    expect(sourceSetsDirectOnly(falseForm)).toBe(false);
    expect(sourceSetsDirectOnly(addDirectOnly(plain)!)).toBe(false);
  });

  test("a disable-model-invocation line in the body is ignored", () => {
    expect(sourceSetsDirectOnly(bodyOnly)).toBe(false);
    expect(addDirectOnly(bodyOnly)).toBe(
      "---\nname: ping\ndisable-model-invocation: true # rt: direct-only\n---\n\ndisable-model-invocation: true\n",
    );
    const marked = "---\nname: ping\n---\n\ndisable-model-invocation: true # rt: direct-only\n";
    expect(removeDirectOnly(marked)).toBe(marked);
  });
});

describe("unusual key values", () => {
  for (const line of ["disable-model-invocation:", "disable-model-invocation: not yet"]) {
    test(`"${line}" is recognised as the key and left unchanged`, () => {
      const md = `---\nname: ping\n${line}\n---\nBody.\n`;
      expect(addDirectOnly(md)).toBe(md);
      expect(removeDirectOnly(md)).toBe(md);
      expect(sourceSetsDirectOnly(md)).toBe(false);
    });
  }
});
