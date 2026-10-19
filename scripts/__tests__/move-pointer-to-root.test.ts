import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { childEnv } from "../../lib/subprocess.ts";
import { dataBranchWorld } from "../../lib/team/__tests__/data-branch-world.ts";
import { cleanupOrgWorlds } from "../../lib/team/__tests__/org-world.ts";
import { DATA_BRANCH_WARNING, ORG_MARKER_REL, parseMarker, POINTER_REL } from "../../lib/team/org-marker.ts";

const script = join(import.meta.dir, "..", "move-pointer-to-root.ts");

afterEach(() => cleanupOrgWorlds());

function world(username = "dev1") {
  const w = dataBranchWorld(username);
  const env = { ...childEnv(), HOME: w.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  const run = (...args: string[]) => {
    const r = Bun.spawnSync(["bun", script, w.root, "--admin", username, ...args], { env, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  const mainFiles = () => w.atOrigin("ls-tree", "-r", "--name-only", "main").trim().split("\n").filter(Boolean).sort();
  return { ...w, run, mainFiles };
}

describe("phase 1: add the root pointer", () => {
  test("a dry run shows the plan and changes nothing", () => {
    const w = world();
    const before = w.atOrigin("rev-parse", "main").trim();
    const r = w.run("--phase", "add");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing was written");
    expect(w.atOrigin("rev-parse", "main").trim()).toBe(before);
  });

  test("--write leaves both files on main, the root one with the header", () => {
    const w = world();
    const r = w.run("--phase", "add", "--write");
    expect(r.err).not.toContain("refused");
    expect(r.code).toBe(0);
    expect(w.mainFiles()).toEqual([POINTER_REL, ORG_MARKER_REL].sort());
    const root = w.atOrigin("show", `main:${POINTER_REL}`);
    expect(root).toContain("Never delete it or merge it into main.");
    expect(parseMarker(root)).toEqual({ kind: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
    const subject = w.atOrigin("log", "-1", "--format=%s", "main").trim();
    expect(subject).toBe("mattstack: point at the org's data from .mattstack.jsonc");
    expect(subject).not.toMatch(/[A-Z]+-\d+/);
  });

  test("a member is refused", () => {
    const w = world("dev2");
    const r = w.run("--phase", "add", "--write");
    expect(r.code).toBe(2);
    expect(r.err).toContain("dev2 is not an admin of this org");
  });
});

describe("phase 2: drop the folder file", () => {
  test("refuses without the confirmation flag, and says what to confirm", () => {
    const w = world();
    w.run("--phase", "add", "--write");
    const r = w.run("--phase", "drop", "--write");
    expect(r.code).toBe(2);
    expect(r.err).toContain("Confirm every member runs this release first");
    expect(r.err).toContain("v2.25.1 and older read only mattstack/mattstack.jsonc");
    expect(r.err).toContain("--members-confirmed");
    expect(w.mainFiles()).toEqual([POINTER_REL, ORG_MARKER_REL].sort());
  });

  test("refuses before phase 1 has added the root pointer", () => {
    const w = world();
    const r = w.run("--phase", "drop", "--members-confirmed", "--write");
    expect(r.code).toBe(2);
    expect(r.err).toContain("main has no .mattstack.jsonc yet");
  });

  test("with the confirmation it leaves only the root pointer on main", () => {
    const w = world();
    w.run("--phase", "add", "--write");
    const r = w.run("--phase", "drop", "--members-confirmed", "--write");
    expect(r.err).not.toContain("refused");
    expect(r.code).toBe(0);
    expect(w.mainFiles()).toEqual([POINTER_REL]);
    expect(w.atOrigin("show", `main:${POINTER_REL}`)).toContain(DATA_BRANCH_WARNING.replace("This branch", "The mattstack branch"));
  });

  test("a main holding other org files is refused until the merge is reverted", () => {
    const w = world();
    w.pushUnrelated("main", { force: true, at: "both" });
    const r = w.run("--phase", "drop", "--members-confirmed", "--write");
    expect(r.code).toBe(2);
    expect(r.err).toContain("main holds org files besides the pointer");
    expect(w.mainFiles()).toContain("mattstack/org/settings.org.jsonc");
  });
});
