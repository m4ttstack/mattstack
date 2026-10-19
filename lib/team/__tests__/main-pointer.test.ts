import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { UserActionableError } from "../../errors.ts";
import { execWithTimeout } from "../../setup/probes.ts";
import { childEnv } from "../../subprocess.ts";
import { readMainBranch, readMainPointer } from "../main-pointer.ts";
import { ORG_MARKER_REL, POINTER_REL } from "../org-marker.ts";

const p = { exec: execWithTimeout };
const roots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const res = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=dev1", "-c", "user.email=dev1@example.test", ...args], { cwd, env: childEnv() });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
}

/** A bare origin whose main holds `marker` (or no marker file at all when null); no main when `marker` is undefined. */
function originWith(marker: string | null | undefined): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-main-pointer-")));
  roots.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  if (marker === undefined) return origin;
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  mkdirSync(join(work, "mattstack"), { recursive: true });
  writeFileSync(join(work, marker === null ? "README.md" : ORG_MARKER_REL), marker === null ? "hello\n" : marker);
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "seed");
  git(work, "push", "-q", origin, "main");
  return origin;
}

/** A bare origin whose main holds exactly `files`. */
function originWithFiles(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-main-pointer-")));
  roots.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "seed");
  git(work, "push", "-q", origin, "main");
  return origin;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readMainPointer", () => {
  test("reads the data branch a layout 4 pointer names", async () => {
    const origin = originWith('{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}');
    expect(await readMainPointer(p, origin, null)).toEqual({ dataBranch: "mattstack", layout: 4 });
  });

  test("a layout 3 marker names no data branch", async () => {
    const origin = originWith('{"role":"org","org":"acme","layout":3}');
    expect(await readMainPointer(p, origin, null)).toEqual({ dataBranch: null, layout: 3 });
  });

  test("a main with no marker reads as no pointer", async () => {
    expect(await readMainPointer(p, originWith(null), null)).toBeNull();
  });

  test("a marker rt cannot read reads as no pointer", async () => {
    expect(await readMainPointer(p, originWith("not json"), null)).toBeNull();
  });

  test("an origin with no main branch reads as no pointer", async () => {
    expect(await readMainPointer(p, originWith(undefined), null)).toBeNull();
  });

  test("an origin it cannot reach is a failure, never read as no pointer", async () => {
    const err = await readMainPointer(p, join(tmpdir(), "rt-no-such-origin.git"), null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err).toMatchObject({ code: "main-pointer-unreadable", message: "rt could not read the org's main branch, so it made no invite" });
  });

  test("a failure keeps credentials out of what a person reads and what is logged", async () => {
    const err = (await readMainPointer(p, "https://x-access-token:topsecret@127.0.0.1:1/acme/widgets.git", null).catch((e: unknown) => e)) as UserActionableError;
    expect(err).toBeInstanceOf(UserActionableError);
    expect(`${err.message}${err.why ?? ""}${err.log ?? ""}`).not.toContain("topsecret");
  });

  test("reads the marker through a filtered fetch from an origin that honors filters", async () => {
    const origin = originWith('{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}');
    git(origin, "config", "uploadpack.allowFilter", "true");
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    expect(await readMainPointer(p, `file://${origin}`, null)).toEqual({ dataBranch: "mattstack", layout: 4 });
  });

  test("the show that lazily fetches the marker carries the same credentials as the fetch", async () => {
    const remote = "https://github.com/acme/widgets.git";
    const seen: { argv: string[]; env?: Record<string, string> }[] = [];
    const exec = async (argv: string[], opts?: { env?: Record<string, string> }) => {
      seen.push({ argv, env: opts?.env });
      return { code: 0, stdout: argv.includes("show") ? '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}' : "", stderr: "" };
    };
    expect(await readMainPointer({ exec }, remote, "private-token")).toEqual({ dataBranch: "mattstack", layout: 4 });
    const fetch = seen.find((c) => c.argv.includes("fetch"))!;
    const show = seen.find((c) => c.argv.includes("show"))!;
    expect(show.argv.slice(0, 5)).toEqual(fetch.argv.slice(0, 5));
    expect(show.argv.some((a) => a.startsWith("credential.https://github.com.helper="))).toBe(true);
    expect(show.env).toMatchObject({ RT_GIT_TOKEN: "private-token", RT_GIT_HOST: "github.com", RT_GIT_USER: "x-access-token", GIT_TERMINAL_PROMPT: "0" });
    expect(JSON.stringify(show.argv)).not.toContain("private-token");
  });

  test("reads the root pointer, alone or beside the old folder file", async () => {
    const pointer = (branch: string) => `// header\n{"role":"org","org":"acme","layout":4,"dataBranch":"${branch}"}`;
    expect(await readMainPointer(p, originWithFiles({ [POINTER_REL]: pointer("mattstack") }), null)).toEqual({ dataBranch: "mattstack", layout: 4 });
    expect(await readMainPointer(p, originWithFiles({ [POINTER_REL]: pointer("data"), [ORG_MARKER_REL]: pointer("mattstack") }), null)).toEqual({ dataBranch: "data", layout: 4 });
  });

  test("lists org files main holds besides the folder pointer", async () => {
    const marker = '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}';
    expect(await readMainBranch(p, originWithFiles({ [POINTER_REL]: marker, [ORG_MARKER_REL]: marker, "src/app.ts": "x\n" }), null)).toEqual({ pointer: { dataBranch: "mattstack", layout: 4 }, orgFiles: [] });
    const merged = await readMainBranch(p, originWithFiles({ [POINTER_REL]: marker, [ORG_MARKER_REL]: marker, "mattstack/org/settings.org.jsonc": "{}\n" }), null);
    expect(merged?.orgFiles).toEqual(["mattstack/org/settings.org.jsonc"]);
  });

  test("leaves no scratch folder behind", async () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("rt-main-pointer-scratch-"));
    await readMainPointer(p, originWith('{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}'), null);
    await readMainPointer(p, join(tmpdir(), "rt-no-such-origin.git"), null).catch(() => {});
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("rt-main-pointer-scratch-"))).toEqual(before);
  });
});
