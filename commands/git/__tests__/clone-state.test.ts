import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSshHostResolver } from "../../../lib/enrich.ts";
import { rtCredentialHelper } from "../../../lib/setup/steps/repos.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import { classifyClone, helperEntries, insteadOfMapsBack, rtWired, type CloneDeps } from "../clone-state.ts";
import { createOriginAuth } from "../origin-auth.ts";
import { git, makeRepo } from "./helpers.ts";

const TOKEN = "glpat-LEAKCHECK000000000";

let root: string;
let link: string;

function deps(opts: { lookup?: () => Promise<ForgeTokenLookup>; linkExists?: boolean } = {}): CloneDeps {
  const lookup = opts.lookup ?? (async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }));
  const auth = createOriginAuth({ confirmedHost: () => "gitlab.acme.internal", lookup });
  return { auth, rtLink: link, rtLinkExists: () => opts.linkExists ?? true };
}

function repoWith(origin: string | null, name = "repo"): string {
  const repo = makeRepo(root, name);
  if (origin !== null) git(repo, "remote", "add", "origin", origin);
  return repo;
}

function addHelpers(repo: string, host: string, values: string[]): void {
  for (const v of values) git(repo, "config", "--local", "--add", `credential.https://${host}.helper`, v);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt clone state ")));
  link = join(root, "rt-link");
  writeFileSync(link, "#!/bin/sh\n");
});

afterEach(() => {
  setSshHostResolver(null);
  rmSync(root, { recursive: true, force: true });
});

describe("helpers", () => {
  test("helperEntries reads local entries and is empty when unset", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    expect(await helperEntries(repo, "gitlab.com")).toEqual([]);
    addHelpers(repo, "gitlab.com", ["", "!h"]);
    expect(await helperEntries(repo, "gitlab.com")).toEqual(["", "!h"]);
  });

  test("rtWired wants exactly the empty value then rt's helper", () => {
    expect(rtWired(["", rtCredentialHelper(link)], link)).toBe(true);
    expect(rtWired([rtCredentialHelper(link)], link)).toBe(false);
    expect(rtWired(["", rtCredentialHelper(link), "!x"], link)).toBe(false);
    expect(rtWired([], link)).toBe(false);
  });

  test("insteadOfMapsBack is null with no rule", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    expect(await insteadOfMapsBack(repo, "https://gitlab.com/acme/x.git")).toBeNull();
  });
});

describe("classifyClone", () => {
  test("https, rt wired: done/wired", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause, s.transport, s.host, s.forge]).toEqual(["done", "wired", "https", "gitlab.com", "gitlab"]);
    expect(s.reason).toBe("already uses rt's GitLab token");
    expect(s.next).toBeUndefined();
  });

  test("ssh with rt's pair for its mapped host is never done", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["off", "ssh-ready"]);
  });

  test("https, foreign helper entries: skipped/own-helper, names them and the host", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["osxkeychain"]);
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["skipped", "own-helper"]);
    expect(s.ownHelpers).toEqual(["osxkeychain"]);
    expect(s.reason).toBe("has its own credential helper for gitlab.com");
  });

  test("ssh, foreign entries for the mapped host: skipped/own-helper", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    addHelpers(repo, "gitlab.com", ["", "!my-helper"]);
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause, s.transport, s.host]).toEqual(["skipped", "own-helper", "ssh", "gitlab.com"]);
    expect(s.ownHelpers).toEqual(["", "!my-helper"]);
  });

  test("ssh whose https URL an insteadOf rule maps back: skipped/insteadof-maps-back naming the rule", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    git(repo, "config", "--local", "url.git@gitlab.com:.insteadOf", "https://gitlab.com/");
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["skipped", "insteadof-maps-back"]);
    expect(s.insteadOfRule).toBe("url.git@gitlab.com:.insteadOf https://gitlab.com/");
    expect(s.reason).toContain("url.git@gitlab.com:.insteadOf https://gitlab.com/");
    expect(s.next).toBeUndefined();
  });

  test("no rt link beats pending and off: skipped/no-rt-link", async () => {
    const https = await classifyClone(repoWith("https://gitlab.com/acme/x.git", "a"), deps({ linkExists: false }));
    const ssh = await classifyClone(repoWith("git@gitlab.com:acme/x.git", "b"), deps({ linkExists: false }));
    expect([https.state, https.cause]).toEqual(["skipped", "no-rt-link"]);
    expect([ssh.state, ssh.cause]).toEqual(["skipped", "no-rt-link"]);
  });

  test("https, token held, host confirmed: pending/ready, next rt git auth <path>", async () => {
    const repo = repoWith("https://gitlab.acme.internal/acme/x.git");
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause, s.host]).toEqual(["pending", "ready", "gitlab.acme.internal"]);
    expect(s.reason).toBe("uses its own git credentials");
    expect(s.next).toBe(`rt git auth '${repo}'`);
  });

  test("ssh, token held: off/ssh-ready, next rt git auth --https <path>", async () => {
    const repo = repoWith("ssh://git@gitlab.com:2222/acme/x.git");
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause, s.transport, s.host]).toEqual(["off", "ssh-ready", "ssh", "gitlab.com"]);
    expect(s.httpsUrl).toBe("https://gitlab.com/acme/x.git");
    expect(s.reason).toBe("uses SSH");
    expect(s.next).toBe(`rt git auth --https '${repo}'`);
  });

  test("an ssh alias that is not a forge: skipped/unmappable-ssh", async () => {
    setSshHostResolver(async () => null);
    const s = await classifyClone(repoWith("myhost:acme/x.git"), deps());
    expect([s.state, s.cause, s.transport, s.host, s.httpsUrl]).toEqual(["skipped", "unmappable-ssh", "ssh", null, null]);
  });

  test("no token, unconfirmed host, http, file origin, no origin, not a forge: skipped with each cause", async () => {
    const absent = deps({ lookup: async () => ({ kind: "absent" }) });
    const cases: Array<[string | null, CloneDeps, string, string]> = [
      ["https://gitlab.com/acme/x.git", absent, "no-token", "https"],
      ["https://gitlab.other.org/acme/x.git", deps(), "unconfirmed-host", "https"],
      ["http://gitlab.com/acme/x.git", deps(), "http-origin", "http"],
      ["file:///tmp/x.git", deps(), "not-https", "other"],
      [null, deps(), "no-origin", "none"],
      ["https://evil.example/acme/x.git", deps(), "not-a-forge", "https"],
    ];
    let i = 0;
    for (const [origin, d, cause, transport] of cases) {
      const s = await classifyClone(repoWith(origin, `r${i++}`), d);
      expect<string[]>([s.state, s.cause, s.transport]).toEqual(["skipped", cause, transport]);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.next).toBeUndefined();
    }
  });

  test("unreadable store: skipped/token-unreadable 'rt could not read its token store'", async () => {
    const d = deps({ lookup: async () => ({ kind: "unreadable", reason: `sops said ${TOKEN}` }) });
    const s = await classifyClone(repoWith("https://gitlab.com/acme/x.git"), d);
    expect([s.state, s.cause, s.reason]).toEqual(["skipped", "token-unreadable", "rt could not read its token store"]);
    expect(JSON.stringify(s)).not.toContain("LEAKCHECK");
  });

  test("rows match first in table order", async () => {
    const repo = repoWith("https://gitlab.acme.internal/acme/x.git");
    addHelpers(repo, "gitlab.acme.internal", ["store"]);
    const s = await classifyClone(repo, deps());
    expect(s.cause).toBe("own-helper");
  });

  test("a path with a space is shell-quoted in next", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git", "my repo");
    const s = await classifyClone(repo, deps());
    expect(s.next).toBe(`rt git auth '${repo}'`);
    expect(repo).toContain(" ");
  });

  test("classifying writes nothing", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    addHelpers(repo, "gitlab.com", ["", "!h"]);
    const before = readFileSync(join(repo, ".git", "config"), "utf8");
    await classifyClone(repo, deps());
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(before);
  });

  test("no state carries the token", async () => {
    const origins = ["https://gitlab.com/acme/x.git", "git@gitlab.com:acme/x.git", `https://oauth2:${TOKEN}@gitlab.com/acme/x.git`];
    let i = 0;
    for (const origin of origins) {
      const s = await classifyClone(repoWith(origin, `t${i++}`), deps());
      const { originUrl: _raw, ...shown } = s;
      expect(JSON.stringify(shown)).not.toContain("LEAKCHECK");
      expect(s.reason).not.toContain("LEAKCHECK");
    }
  });

  test("an insteadOf rule holding credentials is redacted in the reason", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    git(repo, "config", "--local", `url.https://oauth2:${TOKEN}@mirror.example/.insteadOf`, "https://gitlab.com/");
    const s = await classifyClone(repo, deps());
    expect(s.cause).toBe("insteadof-maps-back");
    expect(s.reason).not.toContain("LEAKCHECK");
    expect(s.insteadOfRule).not.toContain("LEAKCHECK");
  });
});
