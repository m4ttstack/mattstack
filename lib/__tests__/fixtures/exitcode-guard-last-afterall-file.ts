import { afterAll, test } from "bun:test";

test("the only test passes", () => {});

afterAll(() => {
  process.exitCode = 2;
});
