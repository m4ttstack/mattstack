import { describe, expect, test } from "bun:test";
import { serializeIdentity } from "../../../packages/rt-client/src/settings/identity-codec.ts";
import { runKind } from "../../../apps/console/src/app/runs/derive/kind.ts";
import { kindOf, mrKeyFromField, mrKeyFromSubject, mrKeyFromUrl } from "../mr-key";

const id = (path: string) => serializeIdentity({ kind: "remote", id: path });

describe("mrKeyFromUrl", () => {
  test("a GitLab url resolves", () => {
    expect(mrKeyFromUrl("https://gitlab.com/acme/widgets/-/merge_requests/12/diffs")).toBe(
      `${id("gitlab.com/acme/widgets")}!12`,
    );
  });
  test("a GitHub url resolves", () => {
    expect(mrKeyFromUrl("https://github.com/acme/widgets/pull/7")).toBe(
      `${id("github.com/acme/widgets")}!7`,
    );
  });
  test("a nested GitLab group keeps its path", () => {
    expect(mrKeyFromUrl("https://GitLab.com/acme/team/widgets/-/merge_requests/3")).toBe(
      `${id("gitlab.com/acme/team/widgets")}!3`,
    );
  });
  test("junk returns null", () => {
    expect(mrKeyFromUrl("not a url")).toBeNull();
    expect(mrKeyFromUrl("https://gitlab.com/acme/widgets")).toBeNull();
  });
});

describe("mrKeyFromField", () => {
  const repo = id("gitlab.com/acme/widgets");
  test("the cleared marker means none", () => {
    expect(mrKeyFromField("-", repo)).toBeNull();
  });
  test("a bare number uses the run's repo", () => {
    expect(mrKeyFromField("!405", repo)).toBe(`${repo}!405`);
  });
  test("a path identity combines with a bare number", () => {
    const p = serializeIdentity({ kind: "path", id: "/tmp/acme" });
    expect(mrKeyFromField("!405", p)).toBe(`${p}!405`);
  });
  test("a bare number on a pre-cutover repo means none", () => {
    expect(mrKeyFromField("!405", "legacy-run-dir-name")).toBeNull();
  });
  test("a url field resolves", () => {
    expect(mrKeyFromField("https://github.com/acme/widgets/pull/7", "x")).toBe(
      `${id("github.com/acme/widgets")}!7`,
    );
  });
});

describe("mrKeyFromSubject", () => {
  test("a subject resolves", () => {
    const url = "https://gitlab.com/acme/widgets/-/merge_requests/12";
    expect(mrKeyFromSubject(`mr:${url}`)).toBe(mrKeyFromUrl(url));
    expect(mrKeyFromSubject("agent:abc")).toBeNull();
  });
});

describe("kindOf", () => {
  test("kinds match the spec", () => {
    expect(kindOf("feature")).toBe("work");
    expect(kindOf("work")).toBe("work");
    expect(kindOf("review")).toBe("review");
    expect(kindOf("receive-review")).toBe("respond");
    expect(kindOf("ship")).toBe("other");
  });
  test("kinds agree with Console", () => {
    for (const t of ["feature", "work", "review", "receive-review", "ship", "watch-ci"]) {
      const c = runKind(t);
      expect(kindOf(t)).toBe(c === "utility" ? "other" : c);
    }
  });
});
