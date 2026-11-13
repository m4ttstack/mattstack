import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { setSshHostResolver } from "../../../lib/enrich.ts";
import { rtCredentialHelper } from "../../../lib/setup/steps/repos.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import { classifyClone, insteadOfMapsBack, readHelperOrder, type CloneDeps } from "../clone-state.ts";
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
  test("readHelperOrder reads rt's own key and is empty when unset", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: [], wired: false, after: null });
    addHelpers(repo, "gitlab.com", ["", "!h"]);
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: ["", "!h"], wired: false, after: null });
  });

  test("readHelperOrder wants exactly the empty value then rt's helper, last", async () => {
    const wired = repoWith("https://gitlab.com/acme/x.git", "a");
    addHelpers(wired, "gitlab.com", ["", rtCredentialHelper(link)]);
    expect((await readHelperOrder(wired, "gitlab.com", link)).wired).toBe(true);
    const lone = repoWith("https://gitlab.com/acme/x.git", "b");
    addHelpers(lone, "gitlab.com", [rtCredentialHelper(link)]);
    expect((await readHelperOrder(lone, "gitlab.com", link)).wired).toBe(false);
    const extra = repoWith("https://gitlab.com/acme/x.git", "c");
    addHelpers(extra, "gitlab.com", ["", rtCredentialHelper(link), "!x"]);
    expect((await readHelperOrder(extra, "gitlab.com", link)).wired).toBe(false);
  });

  test("readHelperOrder keeps a value holding a newline as one entry", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", "!f() {\n echo hi; }; f"]);
    expect((await readHelperOrder(repo, "gitlab.com", link)).own).toEqual(["", "!f() {\n echo hi; }; f"]);
  });

  test("readHelperOrder throws when git cannot read the config, never reads as unset", async () => {
    const repo = repoWith(null);
    writeFileSync(join(repo, ".git", "config"), "[core\nbroken = = =\n");
    await expect(readHelperOrder(repo, "gitlab.com", link)).rejects.toThrow("git could not read this clone's credential config");
  });

  test("readHelperOrder names a generic helper after rt's pair in the same file", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    git(repo, "config", "--local", "credential.helper", "!secret-x");
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: ["", rtCredentialHelper(link)], wired: false, after: "credential.helper" });
  });

  test("readHelperOrder counts any spelling of a key for the host after rt's pair, and skips other hosts and http", async () => {
    const cases: Array<[string, string | null]> = [
      ["credential.https://GitLab.com/acme.helper", "credential.https://GitLab.com/acme.helper"],
      ["credential.HTTPS://me@gitlab.com:443/.helper", "credential.HTTPS://me@gitlab.com:443/.helper"],
      ["credential.https://*.com.helper", "credential.https://*.com.helper"],
      ["credential.gitlab.com.helper", "credential.gitlab.com.helper"],
      ["credential.http://gitlab.com.helper", null],
      ["credential.https://github.com.helper", null],
    ];
    let i = 0;
    for (const [key, after] of cases) {
      const repo = repoWith("https://gitlab.com/acme/x.git", `s${i++}`);
      addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
      git(repo, "config", "--local", "--add", key, "!x");
      const order = await readHelperOrder(repo, "gitlab.com", link);
      expect([key, order.after]).toEqual([key, after]);
      expect([key, order.wired]).toEqual([key, after === null]);
    }
  });

  test("readHelperOrder redacts credentials in the key it names", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    git(repo, "config", "--local", `credential.https://oauth2:${TOKEN}@gitlab.com.helper`, "!x");
    const order = await readHelperOrder(repo, "gitlab.com", link);
    expect(order.after).not.toBeNull();
    expect(order.after).not.toContain("LEAKCHECK");
  });

  test("readHelperOrder sees a helper an include in the clone's config brings in after rt's pair", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    writeFileSync(join(repo, ".git", "extra.config"), "[credential]\n\thelper = !x\n");
    git(repo, "config", "--local", "include.path", "extra.config");
    expect((await readHelperOrder(repo, "gitlab.com", link)).after).toBe("credential.helper");
  });

  test("readHelperOrder predicts where rt's pair would land: after a section for the host that comes first", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "credential.https://gitlab.com.username", "me");
    git(repo, "config", "--local", "credential.helper", "!x");
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: [], wired: false, after: "credential.helper" });
    const plain = repoWith("https://gitlab.com/acme/x.git", "plain");
    git(plain, "config", "--local", "credential.helper", "!x");
    expect((await readHelperOrder(plain, "gitlab.com", link)).after).toBeNull();
  });

  test("readHelperOrder ignores a helper set for one command only", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    const prior = { count: process.env.GIT_CONFIG_COUNT, key: process.env.GIT_CONFIG_KEY_0, value: process.env.GIT_CONFIG_VALUE_0 };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "credential.helper";
    process.env.GIT_CONFIG_VALUE_0 = "!x";
    try {
      expect((await readHelperOrder(repo, "gitlab.com", link)).wired).toBe(true);
    } finally {
      for (const [name, v] of [["GIT_CONFIG_COUNT", prior.count], ["GIT_CONFIG_KEY_0", prior.key], ["GIT_CONFIG_VALUE_0", prior.value]] as const) {
        if (v === undefined) delete process.env[name];
        else process.env[name] = v;
      }
    }
  });

  test("insteadOfMapsBack returns empty when git rewrites the URL but no rule is named", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    git(repo, "config", "--local", "url.git@gitlab.com:.insteadOf", "https://gitlab.com/");
    expect(await insteadOfMapsBack(repo, "https://gitlab.com/acme/x.git", async () => "")).toBe("");
  });

  test("insteadOfMapsBack is null with no rule", async () => {
    const repo = repoWith("git@gitlab.com:acme/x.git");
    expect(await insteadOfMapsBack(repo, "https://gitlab.com/acme/x.git")).toBeNull();
  });
});

/** A linked worktree of `repo` with per-worktree config switched on. */
function linkedWorktree(repo: string, name = "linked"): string {
  const linked = join(root, name);
  git(repo, "worktree", "add", "-q", "-b", name, linked);
  git(repo, "config", "extensions.worktreeConfig", "true");
  return linked;
}

describe("helpers in another worktree's own config", () => {
  test("a helper in a linked worktree's config.worktree counts as after rt's pair, from the main root", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.helper", "!secret-linked");
    const order = await readHelperOrder(repo, "gitlab.com", link);
    expect(order.after).toBe("credential.helper");
    expect(JSON.stringify(order)).not.toContain("secret-linked");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: ["", rtCredentialHelper(link)], wired: false, after: "credential.helper" });
  });

  test("the main worktree's config.worktree counts from a linked worktree", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(repo, "config", "--worktree", "credential.https://gitlab.com.helper", "!secret-main");
    expect((await readHelperOrder(linked, "gitlab.com", link)).after).toBe("credential.https://gitlab.com.helper");
  });

  test("a worktree helper for another host does not count", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.https://github.com.helper", "!other-host");
    expect((await readHelperOrder(repo, "gitlab.com", link)).after).toBeNull();
  });

  test("with extensions.worktreeConfig off, git ignores config.worktree and so does rt", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.helper", "!secret-linked");
    git(repo, "config", "--unset", "extensions.worktreeConfig");
    expect((await readHelperOrder(repo, "gitlab.com", link)).after).toBeNull();
  });

  test("a linked worktree whose folder is gone does not block", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    rmSync(linkedWorktree(repo), { recursive: true, force: true });
    expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: [], wired: false, after: null });
  });

  test("a helper in a worktree whose folder is gone still counts: it applies again if the folder comes back", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.helper", "!secret-gone");
    rmSync(linked, { recursive: true, force: true });
    const order = await readHelperOrder(repo, "gitlab.com", link);
    expect(order.after).toBe("credential.helper");
    expect(JSON.stringify(order)).not.toContain("secret-gone");
  });

  test("a config.worktree git cannot parse throws, never reads as no helper", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "core.x", "y");
    const file = git(linked, "rev-parse", "--path-format=absolute", "--git-path", "config.worktree");
    writeFileSync(file, "[core\nbroken = = =\n");
    await expect(readHelperOrder(repo, "gitlab.com", link)).rejects.toThrow();
  });

  test("a wired clone with a helper in another worktree is skipped as own-helper, never done", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    const linked = linkedWorktree(repo);
    git(linked, "config", "--worktree", "credential.helper", "!secret-linked");
    const s = await classifyClone(repo, deps());
    expect(s.state).toBe("skipped");
    expect(s.cause).toBe("own-helper");
    expect(s.helperAfter).toEqual({ key: "credential.helper", rtWrote: true });
    expect(JSON.stringify(s)).not.toContain("secret-linked");
  });
});

/** Sets `extensions.worktreeConfig` in the test HOME's global config, which git does not honor for the extension. */
async function withGlobalWorktreeConfig(fn: () => Promise<void>): Promise<void> {
  const home = process.env.HOME!;
  expect(home).not.toBe(homedir());
  const global = join(home, ".gitconfig");
  expect(existsSync(global)).toBe(false);
  writeFileSync(global, "[extensions]\n\tworktreeConfig = true\n");
  try {
    await fn();
  } finally {
    rmSync(global, { force: true });
  }
}

describe("extensions.worktreeConfig set only globally", () => {
  test("a clone with a linked worktree reads as no helper, not unreadable", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "worktree", "add", "-q", "-b", "linked", join(root, "linked"));
    await withGlobalWorktreeConfig(async () => {
      expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: [], wired: false, after: null });
      expect((await classifyClone(repo, deps())).state).toBe("pending");
    });
  });

  test("a single-worktree clone with rt's pair reads as wired: rt's own key is never 'after'", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    await withGlobalWorktreeConfig(async () => {
      expect(await readHelperOrder(repo, "gitlab.com", link)).toEqual({ own: ["", rtCredentialHelper(link)], wired: true, after: null });
      expect((await classifyClone(repo, deps())).state).toBe("done");
    });
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

  test("https, rt's pair with a username section first and a local helper after: skipped/own-helper, never done", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "credential.https://gitlab.com.username", "me");
    git(repo, "config", "--local", "credential.helper", "!secret-x");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["skipped", "own-helper"]);
    expect(s.helperAfter).toEqual({ key: "credential.helper", rtWrote: true });
    expect(s.reason).toBe("another credential helper comes after rt's");
    expect(JSON.stringify(s)).not.toContain("secret-x");
  });

  test("https on a port: a port-qualified, path-scoped helper after rt's pair makes it own-helper, never done", async () => {
    const host = "gitlab.acme.internal:8443";
    const repo = repoWith(`https://${host}/grp/x.git`);
    const d: CloneDeps = { ...deps(), auth: createOriginAuth({ confirmedHost: () => host, lookup: async () => ({ kind: "token", token: TOKEN }) }) };
    addHelpers(repo, host, ["", rtCredentialHelper(link)]);
    expect((await classifyClone(repo, d)).state).toBe("done");
    git(repo, "config", "--local", "--add", `credential.https://${host}/grp.helper`, "!secret-x");
    expect(await readHelperOrder(repo, host, link)).toEqual({ own: ["", rtCredentialHelper(link)], wired: false, after: `credential.https://${host}/grp.helper` });
    const s = await classifyClone(repo, d);
    expect([s.state, s.cause]).toEqual(["skipped", "own-helper"]);
  });

  test("https, a helper added to the clone after rt wired it: skipped/own-helper", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    addHelpers(repo, "gitlab.com", ["", rtCredentialHelper(link)]);
    expect((await classifyClone(repo, deps())).state).toBe("done");
    git(repo, "config", "credential.helper", "!secret-x");
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["skipped", "own-helper"]);
    expect(s.next).toBeUndefined();
  });

  test("https, not wired, where rt's pair would land before a local helper: skipped/own-helper, not pending", async () => {
    const repo = repoWith("https://gitlab.com/acme/x.git");
    git(repo, "config", "--local", "credential.https://gitlab.com.username", "me");
    git(repo, "config", "--local", "credential.helper", "!secret-x");
    const s = await classifyClone(repo, deps());
    expect([s.state, s.cause]).toEqual(["skipped", "own-helper"]);
    expect(s.reason).toBe("has its own credential helper for gitlab.com");
    expect(s.next).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("secret-x");
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
    expect(s.reason.startsWith("an insteadOf rule rewrites it: ")).toBe(true);
  });
});
