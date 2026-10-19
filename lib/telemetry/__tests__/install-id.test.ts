import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { installIdPath, readInstallId } from "../install-id.ts";

const HOME = "/h";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("readInstallId", () => {
  test("creates a uuid on first read and returns the same one afterwards", () => {
    const p = fakeProbes({ home: HOME });
    const first = readInstallId(p, "prod");
    expect(first).toMatch(UUID);
    expect(readInstallId(p, "prod")).toBe(first);
    expect(readInstallId(p, "prod")).toBe(first);
  });

  test("writes the file exactly once, at ~/.mattstack/rt/telemetry-id-<flavor>", () => {
    const p = fakeProbes({ home: HOME });
    readInstallId(p, "prod");
    readInstallId(p, "prod");
    expect(Object.keys(p.calls.writes)).toEqual(["/h/.mattstack/rt/telemetry-id-prod"]);
    expect(installIdPath(HOME, "dev")).toBe("/h/.mattstack/rt/telemetry-id-dev");
  });

  test("gives each flavor its own id", () => {
    const p = fakeProbes({ home: HOME });
    expect(readInstallId(p, "prod")).not.toBe(readInstallId(p, "dev"));
  });

  test("replaces a file that does not hold a uuid", () => {
    const p = fakeProbes({ home: HOME, files: { "/h/.mattstack/rt/telemetry-id-prod": "garbage" } });
    const id = readInstallId(p, "prod");
    expect(id).toMatch(UUID);
    expect(readInstallId(p, "prod")).toBe(id);
  });

  test("throws when the id cannot be written, so a ping never goes out under an id that is not kept", () => {
    const p = { ...fakeProbes({ home: HOME }), writeFile: () => { throw new Error("EROFS"); } };
    expect(() => readInstallId(p, "prod")).toThrow("EROFS");
  });
});
