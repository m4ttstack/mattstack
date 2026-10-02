import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { logsDir } from "../../rt-paths.ts";
import { UserActionableError } from "../../errors.ts";
import { JoinKeyExchangeError, JoinPeeringStoreError } from "../../team/join.ts";
import { outcomeFromJoinError } from "../steps/team.ts";

function cliLog(): string {
  const dir = logsDir();
  const files = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log"));
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
}

describe("setup team step records the cause of a failed join", () => {
  test("a UserActionableError's log reaches the CLI log and the outcome is unchanged", () => {
    const err = new UserActionableError("push-denied", "rt could not push", {}, { log: "remote: permission denied marker-uae" });
    expect(outcomeFromJoinError(err)).toEqual({ state: "failed", detail: "rt could not push" });
    expect(cliLog()).toContain("marker-uae");
  });

  test("a key exchange error's detail reaches the CLI log", () => {
    const out = outcomeFromJoinError(new JoinKeyExchangeError("key exchange failed", "keychain locked marker-kx"));
    expect(out.state).toBe("failed");
    expect(out.detail).toBe("key exchange failed");
    expect(cliLog()).toContain("marker-kx");
  });

  test("a peering store error's detail reaches the CLI log", () => {
    const out = outcomeFromJoinError(new JoinPeeringStoreError("store failed", "sops exited 1 marker-ps"));
    expect(out.detail).toBe("store failed");
    expect(cliLog()).toContain("marker-ps");
  });
});
