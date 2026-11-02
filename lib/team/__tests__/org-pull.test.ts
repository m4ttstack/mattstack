import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes, type ExecScript } from "../../setup/__tests__/fakes.ts";
import type { ExecResult } from "../../setup/probes.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { pullOrgClone } from "../org-pull.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const DIR = orgDirUnder(HOME, SLUG);
const REMOTE = "https://github.com/acme/widgets-org.git";
const GIT_CONFIG = `[remote "origin"]\n\turl = ${REMOTE}\n`;
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const missing = (spec: string): ExecResult => ({ code: 128, stdout: "", stderr: `fatal: path '${spec}' does not exist in 'FETCH_HEAD'\n` });

/** A clone on `main` whose fetched tip differs from HEAD; `over` answers first for the argv it recognises. */
function git(over: (argv: string[]) => ExecResult | null = () => null): ExecScript {
  return (argv) => {
    const hit = over(argv);
    if (hit) return hit;
    if (argv.includes("symbolic-ref")) return ok("main\n");
    if (argv.includes("rev-parse")) return ok("aaaa\nbbbb\n");
    if (argv.includes("show")) return missing(argv[argv.length - 1]!);
    return ok();
  };
}

function probes(exec: ExecScript, daemon: (cmd: string) => unknown = () => null) {
  return fakeProbes({
    home: HOME,
    files: { [join(DIR, ".git", "config")]: GIT_CONFIG },
    exec,
    daemon: async (cmd) => daemon(cmd) as never,
  });
}

const noToken = { token: async () => null };
const subcommand = (argv: string[], verb: string) => argv[0] === "git" && argv.includes(verb);

describe("pullOrgClone", () => {
  test("a running daemon pulls: team:pull is the only call", async () => {
    const asked: string[] = [];
    const p = probes(git(), (cmd) => {
      asked.push(cmd);
      return cmd === "ping" ? { ok: true } : { ok: true, data: { outcome: "pulled", detail: null } };
    });
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("pulled");
    expect(asked).toEqual(["ping", "team:pull"]);
    expect(p.calls.exec.filter((argv) => argv[0] === "git")).toEqual([]);
  });

  test("a running daemon's up-to-date and held replies keep their meaning", async () => {
    const upToDate = probes(git(), (cmd) => (cmd === "ping" ? { ok: true } : { ok: true, data: { outcome: "up-to-date", detail: null } }));
    expect((await pullOrgClone(upToDate, SLUG, noToken)).outcome).toBe("up-to-date");
    const held = probes(git(), (cmd) => (cmd === "ping" ? { ok: true } : { ok: true, data: { outcome: "skipped", detail: null, hold: { layout: 99, reads: 5 } } }));
    expect((await pullOrgClone(held, SLUG, noToken)).outcome).toBe("held");
  });

  test("a running daemon with no instance for the slug: the direct pull runs", async () => {
    const p = probes(git(), (cmd) => (cmd === "ping" ? { ok: true } : { ok: false, error: "no team", failure: { code: "no-team", message: "no team" } }));
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("pulled");
    expect(p.calls.exec.some((argv) => subcommand(argv, "fetch"))).toBe(true);
  });

  test("no daemon: fetch, then fast-forward a clean clone", async () => {
    const p = probes(git());
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("pulled");
    const gitCalls = p.calls.exec.filter((argv) => argv[0] === "git");
    const fetch = gitCalls.findIndex((argv) => subcommand(argv, "fetch"));
    const merge = gitCalls.findIndex((argv) => subcommand(argv, "merge"));
    expect(gitCalls[fetch]!.slice(-2)).toEqual(["origin", "main"]);
    expect(gitCalls[merge]).toEqual(["git", "-C", DIR, "merge", "--ff-only", "FETCH_HEAD"]);
    expect(fetch).toBeLessThan(merge);
  });

  test("no daemon, equal heads: up to date, nothing merged", async () => {
    const p = probes(git((argv) => (argv.includes("rev-parse") ? ok("aaaa\naaaa\n") : null)));
    expect((await pullOrgClone(p, SLUG, noToken)).outcome).toBe("up-to-date");
    expect(p.calls.exec.some((argv) => subcommand(argv, "merge"))).toBe(false);
  });

  test("no daemon, a dirty clone: fetched, not moved", async () => {
    const p = probes(git((argv) => (argv.includes("status") ? ok(" M mattstack/settings.org.jsonc\n") : null)));
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("skipped");
    expect(p.calls.exec.some((argv) => subcommand(argv, "fetch"))).toBe(true);
    expect(p.calls.exec.some((argv) => subcommand(argv, "merge"))).toBe(false);
  });

  test("no daemon, the fetched tip is above this rt's layout: held", async () => {
    const marker = JSON.stringify({ role: "org", org: SLUG, layout: 99 });
    const p = probes(git((argv) => (argv[argv.length - 1] === "FETCH_HEAD:mattstack/mattstack.jsonc" ? ok(marker) : null)));
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("held");
    expect(pull.detail).toContain("layout 99");
    expect(p.calls.exec.some((argv) => subcommand(argv, "merge"))).toBe(false);
  });

  test("no daemon, the fetch fails: failed with git's first line, never thrown", async () => {
    const p = probes(git((argv) => (subcommand(argv, "fetch") ? { code: 128, stdout: "", stderr: `fatal: unable to access '${REMOTE}': Could not resolve host\nmore\n` } : null)));
    const pull = await pullOrgClone(p, SLUG, noToken);
    expect(pull.outcome).toBe("failed");
    expect(pull.detail).toStartWith("fatal: unable to access '<remote>");
    expect(pull.detail).toEndWith("Could not resolve host");
    expect(pull.detail).not.toContain("github.com");
  });

  test("no daemon, the token offered to git is the stored one for the clone's origin", async () => {
    const asked: string[] = [];
    const p = probes(git());
    await pullOrgClone(p, SLUG, {
      token: async (_p, remote) => {
        asked.push(remote);
        return "tok";
      },
    });
    expect(asked).toEqual([REMOTE]);
    const fetch = p.calls.exec.find((argv) => subcommand(argv, "fetch"))!;
    expect(fetch.join(" ")).not.toContain("tok");
  });
});
