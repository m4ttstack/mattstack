/**
 * The screen fixtures here are bundle-derived, not captured screens: the
 * message strings come from Claude Code 2.1.301's own limit and auth message
 * tables, set in a hand-built screen layout (transcript above, composer rules,
 * footer below).
 */
import { describe, test, expect } from "bun:test";
import { classifyScreen, diagnoseVerdict, LIMIT_PREFIXES } from "../herd-diagnose.ts";

const RULE = "─".repeat(60);

function screen(transcript: string[], footer: string[] = ["  ? for shortcuts"]): string {
  return ["⏺ Working on the task.", "", ...transcript, "", RULE, "> ", RULE, ...footer].join("\n");
}

describe("classifyScreen", () => {
  test.each(LIMIT_PREFIXES.map((p) => [p]))("classifies every limit prefix as rate-limited: %s", (prefix) => {
    expect(classifyScreen(screen([`  ⎿  ${prefix} limit · resets 5pm`]))).toBe("rate-limited");
  });

  test("classifies the real limit line shape and a model requiring usage credits as rate-limited", () => {
    expect(classifyScreen(screen(["You've hit your session limit · resets 5pm"]))).toBe("rate-limited");
    expect(classifyScreen(screen(["  ⎿  Opus 4.8 requires usage credits. Run /usage to add some."]))).toBe("rate-limited");
    expect(classifyScreen(screen(["Fable requires usage credits."]))).toBe("rate-limited");
  });

  test("classifies Login expired · Please run /login and API Error: 401 … · Please run /login as login-expired", () => {
    expect(classifyScreen(screen(["  ⎿  Login expired · Please run /login"]))).toBe("login-expired");
    expect(classifyScreen(screen(["  ⎿  API Error: 401 Invalid API key · Please run /login"]))).toBe("login-expired");
    expect(classifyScreen(screen(["OAuth token revoked · Please run /login"]))).toBe("login-expired");
    expect(classifyScreen(screen(["Not logged in · Run /login"]))).toBe("login-expired");
  });

  test("login wins over a limit on the same screen", () => {
    expect(classifyScreen(screen(["You've hit your session limit · resets 5pm", "Login expired · Please run /login"]))).toBe("login-expired");
  });

  test("ignores warning prefixes You've used and You're close to", () => {
    expect(classifyScreen(screen(["You've used 90% of your session limit · resets 5pm"]))).toBeNull();
    expect(classifyScreen(screen(["You're close to your weekly limit"]))).toBeNull();
  });

  test("limit text inside a longer sentence does not classify", () => {
    expect(classifyScreen(screen(["⏺ The doc says You've hit your session limit when a plan runs dry."]))).toBeNull();
    expect(classifyScreen(screen(["  Note: Opus requires usage credits. on some plans"]))).toBeNull();
  });

  test("ignores text below the composer rule", () => {
    expect(classifyScreen(screen([], ["You've hit your session limit · resets 5pm"]))).toBeNull();
    expect(classifyScreen(screen([], ["Login expired · Please run /login"]))).toBeNull();
  });

  test("a plain idle screen classifies as nothing", () => {
    expect(classifyScreen(screen(["⏺ Done. Tests pass."]))).toBeNull();
  });
});

describe("diagnoseVerdict order", () => {
  const base = { hasPane: true, paneState: "idle" as const, openGates: 0, jobStatus: "active" as const, screen: null };
  test.each([
    ["no-pane", { ...base, hasPane: false, paneState: null, openGates: 1 }],
    ["gone", { ...base, paneState: "gone", openGates: 1 }],
    ["dead", { ...base, paneState: "dead", openGates: 1 }],
    ["at-gate", { ...base, paneState: "modal", openGates: 1, jobStatus: "stuck-at-modal" }],
    ["parked-modal", { ...base, paneState: "modal", jobStatus: "stuck-at-modal" }],
    ["needs-human", { ...base, paneState: "modal" }],
    ["working", { ...base, paneState: "working", screen: "rate-limited" }],
    ["rate-limited", { ...base, screen: "rate-limited" }],
    ["login-expired", { ...base, screen: "login-expired" }],
    ["idle", base],
  ] as const)("%s", (verdict, input) => {
    expect(diagnoseVerdict(input)).toBe(verdict);
  });

  test("an open gate beats a blocked pane: at-gate, never needs-human", () => {
    expect(diagnoseVerdict({ ...base, paneState: "modal", openGates: 1 })).toBe("at-gate");
  });
});
