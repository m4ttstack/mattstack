import { describe, expect, test } from "bun:test";
import { addDisableModelInvocation, removeDisableModelInvocation, sourceSetsDisableModelInvocation } from "../disable-model-invocation-line";

const plain = "---\nname: ping\ndescription: Pings.\n---\n\n# Ping\n\nBody.\n";
const falseForm = "---\nname: ping\ndisable-model-invocation: false\ndescription: Pings.\n---\n\nBody.\n";
const crlf = "---\r\nname: ping\r\ndescription: Pings.\r\n---\r\n\r\nBody.\r\n";
const unmarkedTrue = "---\nname: ping\ndisable-model-invocation: true\n---\n\nBody.\n";
const bodyOnly = "---\nname: ping\n---\n\ndisable-model-invocation: true\n";

describe("disable-model-invocation line", () => {
  test("addDisableModelInvocation puts the marked line last in the frontmatter", () => {
    expect(addDisableModelInvocation(plain)).toBe(
      "---\nname: ping\ndescription: Pings.\ndisable-model-invocation: true # rt: personal\n---\n\n# Ping\n\nBody.\n",
    );
  });

  test("addDisableModelInvocation is idempotent on its own output", () => {
    const once = addDisableModelInvocation(plain)!;
    expect(addDisableModelInvocation(once)).toBe(once);
  });

  test("addDisableModelInvocation leaves an unmarked true byte-identical", () => {
    expect(addDisableModelInvocation(unmarkedTrue)).toBe(unmarkedTrue);
  });

  test("addDisableModelInvocation turns false into the marked was-false form", () => {
    expect(addDisableModelInvocation(falseForm)).toBe(
      "---\nname: ping\ndisable-model-invocation: true # rt: personal (was false)\ndescription: Pings.\n---\n\nBody.\n",
    );
  });

  test("removeDisableModelInvocation undoes addDisableModelInvocation for plain, false and CRLF", () => {
    for (const x of [plain, falseForm, crlf]) {
      expect(removeDisableModelInvocation(addDisableModelInvocation(x)!)).toBe(x);
    }
  });

  test("addDisableModelInvocation matches the file's CRLF line ending", () => {
    expect(addDisableModelInvocation(crlf)).toContain("\r\ndisable-model-invocation: true # rt: personal\r\n---");
  });

  test("removeDisableModelInvocation leaves an unmarked true alone", () => {
    expect(removeDisableModelInvocation(unmarkedTrue)).toBe(unmarkedTrue);
  });

  test("addDisableModelInvocation returns null with no frontmatter", () => {
    expect(addDisableModelInvocation("# Just a body\n")).toBeNull();
    expect(addDisableModelInvocation("---\nname: unclosed\n")).toBeNull();
  });

  test("sourceSetsDisableModelInvocation is true only for an unmarked true", () => {
    expect(sourceSetsDisableModelInvocation(unmarkedTrue)).toBe(true);
    expect(sourceSetsDisableModelInvocation(plain)).toBe(false);
    expect(sourceSetsDisableModelInvocation(falseForm)).toBe(false);
    expect(sourceSetsDisableModelInvocation(addDisableModelInvocation(plain)!)).toBe(false);
  });

  test("a disable-model-invocation line in the body is ignored", () => {
    expect(sourceSetsDisableModelInvocation(bodyOnly)).toBe(false);
    expect(addDisableModelInvocation(bodyOnly)).toBe(
      "---\nname: ping\ndisable-model-invocation: true # rt: personal\n---\n\ndisable-model-invocation: true\n",
    );
    const marked = "---\nname: ping\n---\n\ndisable-model-invocation: true # rt: personal\n";
    expect(removeDisableModelInvocation(marked)).toBe(marked);
  });
});

describe("unusual key values", () => {
  for (const line of ["disable-model-invocation:", "disable-model-invocation: not yet"]) {
    test(`"${line}" is recognised as the key and left unchanged`, () => {
      const md = `---\nname: ping\n${line}\n---\nBody.\n`;
      expect(addDisableModelInvocation(md)).toBe(md);
      expect(removeDisableModelInvocation(md)).toBe(md);
      expect(sourceSetsDisableModelInvocation(md)).toBe(false);
    });
  }
});
