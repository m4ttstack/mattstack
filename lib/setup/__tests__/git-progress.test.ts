import { describe, expect, test } from "bun:test";
import { parseGitProgress, splitProgressLines } from "../git-progress.ts";

describe("parseGitProgress", () => {
  test("a receiving line carries its phase, percent, and size with speed as the note", () => {
    expect(parseGitProgress("Receiving objects:  42% (4200/10000), 1.21 GiB | 18.40 MiB/s")).toEqual({
      label: "Receiving objects",
      percent: 42,
      note: "1.21 GiB · 18.40 MiB/s",
    });
  });

  test("a finished phase has no note", () => {
    expect(parseGitProgress("Resolving deltas: 100% (900/900), done.")).toEqual({ label: "Resolving deltas", percent: 100 });
  });

  test("the last receiving line keeps its size and speed without git's done marker", () => {
    expect(parseGitProgress("Receiving objects: 100% (10000/10000), 2.40 GiB | 20.10 MiB/s, done.")).toEqual({
      label: "Receiving objects",
      percent: 100,
      note: "2.40 GiB · 20.10 MiB/s",
    });
  });

  test("checking out the working tree is a phase too", () => {
    expect(parseGitProgress("Updating files:  57% (570/1000)")).toEqual({ label: "Updating files", percent: 57 });
  });

  test.each([
    ["the clone's opening line", "Cloning into 'acme-api'..."],
    ["the remote's own counting", "remote: Enumerating objects: 5, done."],
    ["the remote's compression with a percent", "remote: Compressing objects:  50% (2/4)"],
    ["a translated line with no percent", "Klone nach 'acme-api' ..."],
    ["a translated phase with a percent", "Empfange Objekte:  42% (4200/10000), 1.21 GiB | 18.40 MiB/s"],
    ["an empty line", ""],
  ])("%s is not progress", (_label, line) => {
    expect(parseGitProgress(line)).toBeNull();
  });
});

describe("splitProgressLines", () => {
  test("git separates its updates with carriage returns and ends a phase with a newline", () => {
    expect(splitProgressLines("Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\rReceiving objects: 100% (10/10), done.\nResolving deltas:   0% (0/4)\r")).toEqual([
      "Receiving objects:  10% (1/10)",
      "Receiving objects:  50% (5/10)",
      "Receiving objects: 100% (10/10), done.",
      "Resolving deltas:   0% (0/4)",
    ]);
  });
});
