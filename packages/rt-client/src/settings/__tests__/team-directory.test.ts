import { describe, expect, test } from "bun:test";
import {
  channelsOfKind,
  directoryEntry,
  directoryIssues,
  normalizeChannel,
  teamChannels,
  teamForChannel,
  type TeamDirectory,
} from "../team-directory.ts";

const DIR: TeamDirectory = {
  teams: {
    widgets: {
      linear: { team: "WID" },
      slack: {
        codeOwnersChannel: "pod-widgets",
        channels: [
          { name: "widgets-internal", kind: "review" },
          { name: "widgets-alerts", kind: "oncall" },
        ],
      },
    },
    gadgets: { slack: { codeOwnersChannel: "pod-gadgets" } },
  },
};

describe("normalizeChannel", () => {
  test("drops a leading # and lowercases", () => {
    expect(normalizeChannel("#Pod-Widgets")).toBe("pod-widgets");
  });
});

describe("directoryEntry", () => {
  test("finds the entry for a team name", () => {
    expect(directoryEntry(DIR, "widgets")?.linear?.team).toBe("WID");
  });
  test("no team, no directory or an unlisted team is null", () => {
    expect(directoryEntry(DIR, null)).toBeNull();
    expect(directoryEntry(undefined, "widgets")).toBeNull();
    expect(directoryEntry(DIR, "sprockets")).toBeNull();
  });
});

describe("teamForChannel", () => {
  test("matches a team by its code owners channel, ignoring # and case", () => {
    expect(teamForChannel(DIR, "#POD-gadgets")?.name).toBe("gadgets");
  });
  test("a team's other channels do not claim a section", () => {
    expect(teamForChannel(DIR, "widgets-internal")).toBeNull();
  });
  test("an unknown channel or no directory is null", () => {
    expect(teamForChannel(DIR, "pod-other")).toBeNull();
    expect(teamForChannel(undefined, "pod-widgets")).toBeNull();
  });
  test("with two teams on one channel already on disk, the first by key wins", () => {
    const dup: TeamDirectory = { teams: { b: { slack: { codeOwnersChannel: "x" } }, a: { slack: { codeOwnersChannel: "X" } } } };
    expect(teamForChannel(dup, "x")?.name).toBe("b");
  });
});

describe("channelsOfKind and teamChannels", () => {
  const widgets = DIR.teams!.widgets!;
  test("channelsOfKind returns the names of that kind, normalized, in order", () => {
    expect(channelsOfKind(widgets, "review")).toEqual(["widgets-internal"]);
    expect(channelsOfKind(widgets, "missing")).toEqual([]);
  });
  test("teamChannels lists the code owners channel and every other channel, normalized", () => {
    expect(teamChannels(widgets)).toEqual(["pod-widgets", "widgets-internal", "widgets-alerts"]);
  });
});

describe("directoryIssues", () => {
  test("names a code owners channel claimed twice and every kind no app reads", () => {
    const dup: TeamDirectory = {
      teams: {
        a: { slack: { codeOwnersChannel: "Shared", channels: [{ name: "a-x", kind: "reveiw" }] } },
        b: { slack: { codeOwnersChannel: "#shared" } },
      },
    };
    expect(directoryIssues(dup)).toEqual({
      duplicates: [{ channel: "shared", teams: ["a", "b"] }],
      unknownKinds: [{ team: "a", channel: "a-x", kind: "reveiw" }],
    });
  });
  test("a clean directory has no issues", () => {
    expect(directoryIssues({ teams: { a: { slack: { channels: [{ name: "a", kind: "review" }] } } } })).toEqual({ duplicates: [], unknownKinds: [] });
  });
});
