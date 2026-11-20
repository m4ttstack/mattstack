import { expect, test } from "bun:test";
import { DAEMON_ROUTES } from "../../../packages/rt-client/src/daemon-api/index.ts";

test("no HTTP route reaches a logins verb", () => {
  expect(DAEMON_ROUTES.filter((route) => route.cmd.startsWith("logins:")).map((route) => route.cmd)).toEqual([]);
});
