import { describe, expect, test } from "bun:test";
import { pagedList } from "../forge-access.ts";

const member = (id: number, username: string) => ({ id, username, access_level: 30 });

describe("pagedList", () => {
  test("glab --paginate prints one array per page, back to back", () => {
    const stdout = `${JSON.stringify([member(1, "ada"), member(2, "lin")])}${JSON.stringify([member(3, "sam")])}\n`;
    expect(pagedList(stdout, "glab")?.map((m) => m.username)).toEqual(["ada", "lin", "sam"]);
  });

  test("glab pages separated by whitespace", () => {
    const stdout = `${JSON.stringify([member(1, "ada")])}\n${JSON.stringify([member(2, "lin")])}\n`;
    expect(pagedList(stdout, "glab")?.map((m) => m.username)).toEqual(["ada", "lin"]);
  });

  test("a bracket pair inside a string never splits a page", () => {
    const stdout = JSON.stringify([{ id: 1, username: "ada", name: "a ][ b" }]) + JSON.stringify([member(2, "lin")]);
    expect(pagedList(stdout, "glab")?.map((m) => m.username)).toEqual(["ada", "lin"]);
  });

  test("a single glab page still reads", () => {
    expect(pagedList(JSON.stringify([member(1, "ada")]), "glab")?.length).toBe(1);
  });

  test("gh --paginate --slurp wraps the pages in an outer array", () => {
    const stdout = JSON.stringify([[member(1, "ada")], [member(2, "lin")]]);
    expect(pagedList(stdout, "gh")?.map((m) => m.username)).toEqual(["ada", "lin"]);
  });

  test("output that is not JSON arrays reads as null", () => {
    expect(pagedList("HTTP 403 Forbidden", "glab")).toBeNull();
    expect(pagedList(`${JSON.stringify([member(1, "ada")])}{"message":"oops"}`, "glab")).toBeNull();
    expect(pagedList('[]"error"[]', "glab")).toBeNull();
  });
});
