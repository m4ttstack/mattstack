import { expect, test } from "bun:test";
import { isResumePhrase, stripTrigger } from "../resume-phrase.ts";

const MAUDE = { name: "Maude", emoji: "🤖" };

test("the default trigger is the name after an @, at the start, any case, with leading space", () => {
  expect(isResumePhrase("  @Maude can you check X", MAUDE)).toBe(true);
  expect(isResumePhrase("@maude", MAUDE)).toBe(true);
  expect(isResumePhrase("@Maude, one more", MAUDE)).toBe(true);
  expect(isResumePhrase("\n@MAUDE\nplease", MAUDE)).toBe(true);
});

test("each closing punctuation mark ends the trigger", () => {
  for (const mark of [",", ":", "!", "?"]) expect(isResumePhrase(`@Maude${mark} hi`, MAUDE)).toBe(true);
});

test("a trigger that is not at the start, or runs into a word, does not match", () => {
  expect(isResumePhrase("ok @Maude", MAUDE)).toBe(false);
  expect(isResumePhrase("@Maudeline", MAUDE)).toBe(false);
  expect(isResumePhrase("Maude hi", MAUDE)).toBe(false);
});

test("a custom trigger replaces the default", () => {
  const ada = { name: "Ada", emoji: "🦊" };
  expect(isResumePhrase("!!Ada please", ada, "!!ada")).toBe(true);
  expect(isResumePhrase("@Ada please", ada, "!!ada")).toBe(false);
  expect(isResumePhrase("ok !!ada", ada, "!!ada")).toBe(false);
});

test("the old !!claude trigger returns when it is the trigger", () => {
  expect(isResumePhrase("  !!Claude can you also check X", MAUDE, "!!claude")).toBe(true);
  expect(isResumePhrase("!!claudeX", MAUDE, "!!claude")).toBe(false);
});

test("regex metacharacters in a trigger are literal", () => {
  const odd = { name: "Dot", emoji: "🔵" };
  expect(isResumePhrase("a.b(c)+ go", odd, "a.b(c)+")).toBe(true);
  expect(isResumePhrase("axb(c)+ go", odd, "a.b(c)+")).toBe(false);
  expect(isResumePhrase("abcc go", odd, "a.b(c)+")).toBe(false);
});

test("stripTrigger drops the trigger and the punctuation that closed it", () => {
  expect(stripTrigger("  @Maude, can you check X", MAUDE)).toBe("can you check X");
  expect(stripTrigger("@maude: hi\nthere", MAUDE)).toBe("hi\nthere");
  expect(stripTrigger("@Maude", MAUDE)).toBe("");
});
