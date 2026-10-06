import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readGitlabToken } from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

function apiTokenFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "rt-client-gl-")), "api-token");
  writeFileSync(path, "api-123\n");
  return path;
}

describe("readGitlabToken", () => {
  test("asks the daemon's extension scope with the local api token", async () => {
    const { sock, seen, stop } = fakeDaemon({ "secrets:read": { ok: true, data: { gitlabToken: "glpat-x" } } });
    stops.push(stop);
    expect(await readGitlabToken({ sockPath: sock, apiTokenPath: apiTokenFile() })).toBe("glpat-x");
    expect(seen).toEqual([{ cmd: "secrets:read", payload: { token: "api-123", scope: "extension" } }]);
  });

  test("is null when the daemon refuses", async () => {
    const { sock, stop } = fakeDaemon({ "secrets:read": { ok: false, error: "bad-token" } });
    stops.push(stop);
    expect(await readGitlabToken({ sockPath: sock, apiTokenPath: apiTokenFile() })).toBeNull();
  });

  test("is null when there is no api token file", async () => {
    const { sock, seen, stop } = fakeDaemon({});
    stops.push(stop);
    expect(await readGitlabToken({ sockPath: sock, apiTokenPath: join(tmpdir(), "no-such-api-token") })).toBeNull();
    expect(seen).toEqual([]);
  });
});
