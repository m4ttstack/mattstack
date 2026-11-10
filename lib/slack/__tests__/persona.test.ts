import { afterEach, expect, test } from "bun:test";
import { unsetSetting, setSetting } from "../../settings/write.ts";
import { resumeTrigger, slackPersona, slackTrigger } from "../persona.ts";

afterEach(() => {
  unsetSetting("agent.persona", "user");
  unsetSetting("chat.slackSupport.trigger", "user");
});

test("with nothing set the persona is Maude, and its trigger is @Maude", () => {
  expect(slackPersona()).toEqual({ name: "Maude", emoji: "🤖" });
  expect(slackTrigger()).toBeUndefined();
  expect(resumeTrigger(slackPersona(), slackTrigger())).toBe("@Maude");
});

test("a changed setting applies to the next read", () => {
  setSetting("agent.persona", { name: "Ada", emoji: "🦊" }, "user");
  expect(slackPersona()).toEqual({ name: "Ada", emoji: "🦊" });
  expect(resumeTrigger(slackPersona(), slackTrigger())).toBe("@Ada");
  setSetting("chat.slackSupport.trigger", "!!ada", "user");
  expect(resumeTrigger(slackPersona(), slackTrigger())).toBe("!!ada");
});

test("only the emoji set in one layer keeps the default name", () => {
  setSetting("agent.persona", { emoji: "🦊" }, "user");
  expect(slackPersona()).toEqual({ name: "Maude", emoji: "🦊" });
});

test("a blank trigger falls back to the name", () => {
  expect(resumeTrigger({ name: "Ada", emoji: "🦊" }, "  ")).toBe("@Ada");
});
