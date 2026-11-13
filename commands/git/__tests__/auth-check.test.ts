import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { shellQuote } from "../../../lib/herdr-launch.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { authCommand, checkBlocks, type AuthDeps } from "../auth.ts";
import type { CloneState } from "../clone-state.ts";
import { createOriginAuth } from "../origin-auth.ts";
import { git, makeRepo } from "./helpers.ts";

const TOKEN = "glpat-LEAKCHECK000000000";

let root: string;
let link: string;
let io: CapturedOut;

function deps(entries: { repoName: string; path: string }[], printed: string[] = []): AuthDeps {
  const lookup = async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN });
  return {
    auth: createOriginAuth({ confirmedHost: () => "gitlab.acme.internal", lookup }),
    rtLink: link,
    rtLinkExists: () => true,
    entries: () => entries,
    interactive: true,
    confirm: async () => {
      throw new Error("--check must never prompt");
    },
    print: (line) => printed.push(line),
  };
}

function repoWith(origin: string | null, name: string): string {
  const repo = makeRepo(root, name);
  if (origin !== null) git(repo, "remote", "add", "origin", origin);
  return repo;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-auth-check-")));
  link = join(root, "rt-link");
  writeFileSync(link, "#!/bin/sh\n");
  io = captureOut();
  out.__test__.reset();
  out.__test__.setHuman(() => false);
});

afterEach(() => {
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

describe("rt git auth --check", () => {
  test("--check prints one row per existing registered checkout, state and reason, next under it", async () => {
    const pending: CloneState = { state: "pending", cause: "ready", transport: "https", host: "gitlab.com", forge: "gitlab", reason: "uses its own git credentials", next: "rt git auth /w/app", originUrl: `https://u:${TOKEN}@gitlab.com/a/app.git`, httpsUrl: null };
    const done: CloneState = { state: "done", cause: "wired", transport: "https", host: "gitlab.com", forge: "gitlab", reason: "already uses rt's GitLab token", originUrl: "https://gitlab.com/a/lib.git", httpsUrl: null, ownHelpers: ["!secret-script"] };
    const text = renderPlain(checkBlocks([
      { label: "app", path: "/w/app", s: pending },
      { label: "lib", path: "/w/lib", s: done },
    ]));
    expect(text).toContain("app");
    expect(text).toContain("uses its own git credentials");
    expect(text).toContain("rt git auth /w/app");
    expect(text).toContain("already uses rt's GitLab token");
    expect(text.indexOf("rt git auth /w/app")).toBeLessThan(text.indexOf("lib"));
    expect(text).not.toContain("LEAKCHECK");
    expect(text).not.toContain("secret-script");

    const repo = repoWith("https://gitlab.com/acme/app.git", "app");
    await authCommand(["--check"], {}, deps([{ repoName: "app", path: repo }]));
    expect(io.stdout()).toContain("uses its own git credentials");
    expect(io.stdout()).toContain(`rt git auth ${shellQuote(repo)}`);
  });

  test("--check --json emits the frozen shape and no token", async () => {
    const path = repoWith(`https://sam:${TOKEN}@gitlab.com/acme/app.git`, "app");
    const lines: string[] = [];
    await authCommand(["--check", "--json"], {}, deps([{ repoName: "app", path }], lines));
    expect(lines).toHaveLength(1);
    const printed = lines[0]!;
    expect(JSON.parse(printed)).toEqual({ ok: true, repos: [{ path, label: "app", state: "pending", transport: "https", host: "gitlab.com", next: `rt git auth ${shellQuote(path)}` }] });
    expect(printed).not.toContain("LEAKCHECK");
    expect(io.stdout()).not.toContain("LEAKCHECK");
    expect(io.stderr()).not.toContain("LEAKCHECK");
  });

  test("--check skips index rows whose folder is gone and exits 0 whatever the states", async () => {
    const plain = repoWith(null, "plain");
    const lines: string[] = [];
    const result = await authCommand(["--check", "--json"], {}, deps([
      { repoName: "gone", path: join(root, "gone") },
      { repoName: "plain", path: plain },
    ], lines));
    expect(result).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toEqual({ ok: true, repos: [{ path: plain, label: "plain", state: "skipped", transport: "none", host: null }] });
  });

  test("--check writes nothing and prompts for nothing", async () => {
    const repo = repoWith("https://gitlab.com/acme/app.git", "app");
    const before = readFileSync(join(repo, ".git", "config"), "utf8");
    await authCommand(["--check"], {}, deps([{ repoName: "app", path: repo }]));
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(before);
  });

  test("--check shows a clone it cannot read as its own row and keeps going", async () => {
    const broken = repoWith("https://gitlab.com/acme/broken.git", "broken");
    const good = repoWith("https://gitlab.com/acme/good.git", "good");
    const throwing = (d: AuthDeps): AuthDeps => {
      const real = d.auth.verdict.bind(d.auth);
      return { ...d, auth: { ...d.auth, verdict: async (url) => {
        if (url?.includes("broken")) throw new Error("git could not read this clone's credential config");
        return real(url);
      } } };
    };
    await authCommand(["--check"], {}, throwing(deps([
      { repoName: "broken", path: broken },
      { repoName: "good", path: good },
    ])));
    expect(io.stdout()).toContain("rt could not read its git config");
    expect(io.stdout()).toContain(`rt git auth ${shellQuote(good)}`);

    const lines: string[] = [];
    await authCommand(["--check", "--json"], {}, throwing(deps([{ repoName: "broken", path: broken }], lines)));
    expect(JSON.parse(lines[0]!)).toEqual({ ok: true, repos: [{ path: broken, label: "broken", state: "skipped", transport: null, host: null }] });
  });
});
