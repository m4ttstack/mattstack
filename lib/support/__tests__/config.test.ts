import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { orgsDir } from "../../rt-paths.ts";
import { setSetting } from "../../settings/write.ts";
import { closeStateDb } from "../../state/index.ts";
import { onRoster, supportConfig } from "../config.ts";

let fixtureHome: string;
let priorHome: string | undefined;

beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-support-config-`));
  process.env.HOME = fixtureHome;
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const ROSTER = [{ username: "Alex", name: "Alex Doe" }, { username: "ada" }];

function seed(settings: Record<string, unknown> = {}, username: string | undefined = "alex", remote: string | null = "git@git.example.com:Acme/Mattstack.git") {
  seedOrg({ org: "acme", username, roster: ROSTER, settings });
  if (remote !== null) {
    const git = join(orgsDir(), "acme", ".git");
    mkdirSync(git, { recursive: true });
    writeFileSync(join(git, "config"), `[remote "origin"]\n\turl = ${remote}\n`);
  }
}

describe("supportConfig", () => {
  test("no org is null", () => {
    expect(supportConfig()).toBeNull();
  });

  test("an org with no remote is null, since no one else shares it", () => {
    seed({ "support.enabled": true, "support.host": "alex" }, "alex", null);
    expect(supportConfig()).toBeNull();
  });

  test("the org's path reads the same however the clone was made", () => {
    for (const remote of [
      "git@git.example.com:Acme/Mattstack.git",
      "https://git.example.com/acme/mattstack",
      "https://x-access-token:secret@GIT.example.com/Acme/mattstack.git/",
      "ssh://git@git.example.com:2222/acme/mattstack.git",
      "git@work-alias:acme/mattstack.git",
      "ssh://git@ssh.git.example.com:443/acme/mattstack.git",
    ]) {
      seed({}, "alex", remote);
      expect(supportConfig()!.orgPath).toBe("acme/mattstack");
    }
  });

  test("off by default, with nobody as the host", () => {
    seed();
    expect(supportConfig()).toMatchObject({ org: "acme", enabled: false, host: null, me: "alex", isHost: false, acceptHere: false });
  });

  test("enabled with no host, or a host off the roster, has isHost false", () => {
    seed({ "support.enabled": true });
    expect(supportConfig()).toMatchObject({ enabled: true, host: null, isHost: false });
    seed({ "support.enabled": true, "support.host": "bo" }, "bo");
    expect(supportConfig()).toMatchObject({ enabled: true, host: null, me: "bo", isHost: false });
  });

  test("host compare ignores case", () => {
    seed({ "support.enabled": true, "support.host": "ALEX" }, "alex");
    expect(supportConfig()).toMatchObject({ host: "ALEX", isHost: true });
    expect(onRoster(supportConfig()!, " aLeX ")).toBe(true);
    expect(onRoster(supportConfig()!, "bo")).toBe(false);
  });

  test("a Mac that does not know who it is, is never the host", () => {
    seed({ "support.enabled": true, "support.host": "alex" }, "");
    expect(supportConfig()).toMatchObject({ me: null, isHost: false });
  });

  test("acceptHere is false unless this person is the host and the org has support on", () => {
    const on = { "support.enabled": true, "support.host": "alex" };
    seed(on);
    expect(supportConfig()!.acceptHere).toBe(false);
    setSetting("support.acceptRequests", true, "machine");
    expect(supportConfig()!.acceptHere).toBe(true);
    seed({ ...on, "support.enabled": false });
    expect(supportConfig()).toMatchObject({ accepts: true, acceptHere: false });
    seed(on, "ada");
    expect(supportConfig()!.acceptHere).toBe(false);
  });

  test("the roster carries usernames and names, and nothing else", () => {
    seedOrg({ org: "acme", username: "alex", roster: [{ username: "alex", name: "Alex Doe", agePublicKey: "age1x" }, { username: "ada" }] });
    const git = join(orgsDir(), "acme", ".git");
    mkdirSync(git, { recursive: true });
    writeFileSync(join(git, "config"), `[remote "origin"]\n\turl = git@git.example.com:acme/m.git\n`);
    expect(supportConfig()!.roster).toEqual([{ username: "alex", name: "Alex Doe" }, { username: "ada" }]);
  });
});
