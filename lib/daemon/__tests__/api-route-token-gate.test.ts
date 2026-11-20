import { describe, expect, test } from "bun:test";
import { DAEMON_ROUTES } from "../../../packages/rt-client/src/daemon-api/routes.ts";
import { needsToken } from "../api-auth.ts";

describe("DAEMON_ROUTES token flags", () => {
  for (const route of DAEMON_ROUTES) {
    test(`${route.id} documents the gate needsToken applies`, () => {
      const concrete = route.path.replace(/\{[^}]+\}/g, "x");
      expect(needsToken(route.method.toUpperCase(), concrete)).toBe(route.token);
    });
  }
});
