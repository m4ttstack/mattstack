import { describe, expect, test } from "bun:test";
import { parseAllowedTools, splitToolRules } from "../allowed-tools.ts";

describe("splitToolRules", () => {
  test("splits at spaces and commas outside a rule", () => {
    expect(splitToolRules("Read Grep, Bash(git add *)  Bash(git status *)")).toEqual(["Read", "Grep", "Bash(git add *)", "Bash(git status *)"]);
  });

  test("keeps a comma or a parenthesis inside a rule's quotes", () => {
    expect(splitToolRules(`Bash(grep ")" x, y), Read`)).toEqual([`Bash(grep ")" x, y)`, "Read"]);
    expect(splitToolRules(`Bash(jq '.a | (.b)':*) Read`)).toEqual([`Bash(jq '.a | (.b)':*)`, "Read"]);
  });

  test("an empty string has no rules", () => {
    expect(splitToolRules(" , ")).toEqual([]);
  });
});

describe("parseAllowedTools", () => {
  test("takes a list as written and ignores what is not a string", () => {
    expect(parseAllowedTools(["Bash(a b)", 3, "Read"])).toEqual(["Bash(a b)", "Read"]);
  });

  test("reads anything else as no rules", () => {
    expect(parseAllowedTools(undefined)).toEqual([]);
  });
});
