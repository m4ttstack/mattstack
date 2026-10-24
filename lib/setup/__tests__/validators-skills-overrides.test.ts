import { describe, expect, test } from "bun:test";
import { join } from "path";
import { regroupTools } from "../regroup.ts";
import { SKILLS_OVERRIDES_ROW_ID, skillsOverridesRow, skillsOverridesRowFor } from "../validators/skills-overrides.ts";

const FILE = "/home/.mattstack/user/skills/overrides.jsonc";
const at = (text: string | null) => skillsOverridesRow({ file: FILE, text });

describe("skillsOverridesRow", () => {
  test("is skipped when the overrides file is absent", () => {
    const r = at(null);
    expect(r.status).toBe("skipped");
    expect(r.detail).toBe("No overrides file");
  });

  test("is ready when the file is empty or every key is in block form", () => {
    expect(at("").status).toBe("ready");
    expect(at("  \n").status).toBe("ready");
    expect(at('// overrides off for now\n/* { "bindings": {} } */\n').status).toBe("ready");
    expect(at('{ "bindings": { "mattstack:work/sub-agent-tiering": { "tiering": "mattstack:model-tiering" } } }').status).toBe("ready");
  });

  test("turns needs-you on an old slot key and names its successor", () => {
    const r = at('{ "bindings": { "mattstack:work": { "tiering": "mattstack:model-tiering" } } }');
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("mattstack:work tiering");
    expect(r.detail).toContain("mattstack:work/sub-agent-tiering tiering");
  });

  test("says a person decides for domain", () => {
    const r = at('{ "bindings": { "mattstack:stage-ship": { "domain": "acme:ship-rules" } } }');
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe(
      "Old slot keys: mattstack:stage-ship domain becomes mattstack:stage-ship/domain-rules rules or a step's own rules prop, your choice. " +
        "A rules prop adds to lower layers where domain replaced them.",
    );
  });

  test("shepherdr's domain names its root block's rules prop, since it has no domain-rules block", () => {
    const r = at('{ "bindings": { "mattstack:shepherdr": { "domain": "acme:fan-rules" } } }');
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("Old slot keys: mattstack:shepherdr domain becomes mattstack:shepherdr rules. A rules prop adds to lower layers where domain replaced them.");
  });

  test("an engine with neither a domain-rules block nor a root rules prop names a step's own rules prop", () => {
    expect(at('{ "bindings": { "mattstack:review": { "domain": "acme:r" } } }').detail).toBe(
      "Old slot keys: mattstack:review domain becomes a step's own rules prop. A rules prop adds to lower layers where domain replaced them.",
    );
  });

  test("states the domain caveat once, after the list", () => {
    const r = at(JSON.stringify({
      bindings: { "mattstack:stage-plan": { domain: "acme:plan" }, "mattstack:work": { tiering: "acme:t" } },
      pipelines: { bugfix: { bindings: { "mattstack:stage-ship": { domain: "acme:ship" } } } },
    }));
    expect(r.detail).toBe(
      "Old slot keys: mattstack:stage-plan domain becomes mattstack:stage-plan/domain-rules rules or a step's own rules prop, your choice; " +
        "mattstack:work tiering becomes mattstack:work/sub-agent-tiering tiering; " +
        "mattstack:stage-ship domain in pipeline bugfix becomes mattstack:stage-ship/domain-rules rules or a step's own rules prop, your choice. " +
        "A rules prop adds to lower layers where domain replaced them.",
    );
  });

  test("leaves the caveat out when no key is domain", () => {
    expect(at('{ "bindings": { "mattstack:work": { "tiering": "x" } } }').detail).toBe(
      "Old slot keys: mattstack:work tiering becomes mattstack:work/sub-agent-tiering tiering.",
    );
  });

  test("lists only the old keys when old and new are mixed", () => {
    const r = at(JSON.stringify({
      bindings: {
        "mattstack:review/criteria": { criteria: "acme:criteria" },
        "mattstack:review": { reviewer: "acme:reviewer" },
      },
      pipelines: {
        bugfix: { bindings: { "mattstack:stage-watch-ci": { forge: "acme:forge" }, "mattstack:stage-watch-ci/forge": { forge: "acme:forge" } } },
      },
    }));
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("mattstack:review reviewer");
    expect(r.detail).toContain("mattstack:review/reviewer reviewer");
    expect(r.detail).toContain("bugfix");
    expect(r.detail).toContain("mattstack:stage-watch-ci forge");
    expect(r.detail).not.toContain("mattstack:review/criteria");
  });

  test("says it cannot read a broken file", () => {
    const cases: [string, string][] = [
      ["{ nope", "Could not read the file: it is not valid JSONC."],
      ["[]", "Could not read the file: it is not a JSON object."],
      ['{ "bindings": { "mattstack:work": "x" } }', "Could not read the file: bindings.mattstack:work is not an object."],
    ];
    for (const [text, detail] of cases) {
      const r = at(text);
      expect(r.status).toBe("needs-you");
      expect(r.detail).toBe(detail);
      expect((r.action as { steps: string[] }).steps).toEqual([`Fix the problem above in ${FILE}`, "Run: rt skills materialize"]);
    }
  });

  test("blocks neither Install nor Finish, and its action says to edit the file then materialize", () => {
    for (const r of [at(null), at(""), at("{ nope"), at('{ "bindings": { "mattstack:work": { "tiering": "x" } } }')]) {
      expect(r.id).toBe(SKILLS_OVERRIDES_ROW_ID);
      expect(r.title).toBe("Skill overrides");
      expect(r.required).toBe(false);
      expect(r.finishGated).toBeUndefined();
    }
    const action = at('{ "bindings": { "mattstack:work": { "tiering": "x" } } }').action;
    expect(action?.type).toBe("steps");
    const steps = (action as { steps: string[] }).steps;
    expect(steps[0]).toContain(FILE);
    expect(steps.at(-1)).toBe("Run: rt skills materialize");
  });
});

describe("skillsOverridesRowFor", () => {
  test("reads the overrides file under the home and never throws", () => {
    const seen: string[] = [];
    const r = skillsOverridesRowFor({ home: "/h", readFile: (p) => { seen.push(p); return null; } });
    expect(seen).toEqual([join("/h", ".mattstack", "user", "skills", "overrides.jsonc")]);
    expect(r.status).toBe("skipped");
  });

  test("sits beside the writing style row once regrouped", () => {
    const out = regroupTools([{ id: "tools", title: "Tools", rows: [at(null)] }]);
    expect(out.find((g) => g.id === "agents")?.rows.map((x) => x.id)).toEqual([SKILLS_OVERRIDES_ROW_ID]);
  });
});
