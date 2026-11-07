import { afterEach, expect, test } from "bun:test";
import { unsetSetting, setSetting } from "../../settings/write.ts";
import { resumeTrigger, slackPersona } from "../persona.ts";

afterEach(() => {
  unsetSetting("chat.slackSupport.persona", "user");
});

test("with nothing set the persona is Maude, and its trigger is @Maude", () => {
  expect(slackPersona()).toEqual({ name: "Maude", emoji: "🤖" });
  expect(resumeTrigger(slackPersona())).toBe("@Maude");
});

test("a changed setting applies to the next read", () => {
  setSetting("chat.slackSupport.persona", { name: "Ada", emoji: "🦊" }, "user");
  expect(slackPersona()).toEqual({ name: "Ada", emoji: "🦊" });
  setSetting("chat.slackSupport.persona", { name: "Ada", emoji: "🦊", trigger: "!!ada" }, "user");
  expect(resumeTrigger(slackPersona())).toBe("!!ada");
});

test("only the emoji set in one layer keeps the default name", () => {
  setSetting("chat.slackSupport.persona", { emoji: "🦊" }, "user");
  expect(slackPersona()).toEqual({ name: "Maude", emoji: "🦊" });
});

test("a blank trigger falls back to the name", () => {
  expect(resumeTrigger({ name: "Ada", emoji: "🦊", trigger: "  " })).toBe("@Ada");
});
