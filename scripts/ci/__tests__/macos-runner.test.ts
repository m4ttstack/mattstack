import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { type Facts, OWNER, REPO, cached, prNumbers, readFacts, refusal } from "../macos-runner.ts";
import { ROOT } from "../test-scope.ts";

const base = { repo: REPO, actor: OWNER, triggeringActor: OWNER };
const pr: Facts = { ...base, eventName: "pull_request", prAuthor: OWNER, prHeadRepo: REPO };
const group: Facts = { ...base, eventName: "merge_group", groupAuthors: [{ login: OWNER, headRepo: REPO }] };

describe("refusal", () => {
  test("allows the owner's PR and queue run", () => {
    expect(refusal(pr)).toBeNull();
    expect(refusal(group)).toBeNull();
  });

  test.each<[string, Facts]>([
    ["another repo", { ...pr, repo: "m4ttstack/flock" }],
    ["another PR author", { ...pr, prAuthor: "someone" }],
    ["a fork using the owner's name", { ...pr, prHeadRepo: `${OWNER}/mattstack` }],
    ["a push by someone else to the owner's PR", { ...pr, actor: "someone" }],
    ["a re-run by someone else", { ...pr, triggeringActor: "someone" }],
    ["a queued group holding another author", { ...group, groupAuthors: [{ login: OWNER, headRepo: REPO }, { login: "someone", headRepo: REPO }] }],
    ["a queued PR from a fork", { ...group, groupAuthors: [{ login: OWNER, headRepo: `${OWNER}/mattstack` }] }],
    ["an empty group", { ...group, groupAuthors: [] }],
    ["a group with no authors read", { ...group, groupAuthors: undefined }],
    ["a schedule", { ...base, eventName: "schedule" }],
    ["a manual run", { ...base, eventName: "workflow_dispatch" }],
  ])("refuses %s", (_name, facts) => {
    expect(refusal(facts)).not.toBeNull();
  });
});

describe("prNumbers", () => {
  test("reads the number GitHub appends to each squash title", () => {
    expect(prNumbers(["fix a thing (#12)\n\nbody (#99)", "another (#7) (#13)"])).toEqual([12, 13]);
  });
  test("throws on a commit with no number, so the caller refuses", () => {
    expect(() => prNumbers(["fix a thing (#12)", "no number"])).toThrow();
  });
});

describe("readFacts", () => {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_ACTOR: OWNER, GITHUB_TRIGGERING_ACTOR: OWNER };

  test("reads a PR from the event payload with no API call", async () => {
    const facts = await readFacts(
      { ...env, GITHUB_EVENT_NAME: "pull_request" },
      { pull_request: { user: { login: OWNER }, head: { repo: { full_name: REPO } } } },
      () => Promise.reject(new Error("no API call expected")),
    );
    expect(refusal(facts)).toBeNull();
  });

  test("reads every PR in a merge group, not only the newest", async () => {
    const get = async (path: string) => {
      if (path.includes("/compare/main...abc")) {
        return { commits: [{ commit: { message: "one (#1)" } }, { commit: { message: "two (#2)" } }] };
      }
      return { user: { login: path.endsWith("/1") ? "someone" : OWNER }, head: { repo: { full_name: REPO } } };
    };
    const facts = await readFacts({ ...env, GITHUB_EVENT_NAME: "merge_group" }, { merge_group: { head_sha: "abc" } }, get);
    expect(refusal(facts)).toContain("someone");
  });

  test("a queued PR whose fork was deleted is refused", async () => {
    const get = async (path: string) =>
      path.includes("/compare/") ? { commits: [{ commit: { message: "one (#1)" } }] } : { user: { login: OWNER }, head: { repo: null } };
    const facts = await readFacts({ ...env, GITHUB_EVENT_NAME: "merge_group" }, { merge_group: { head_sha: "abc" } }, get);
    expect(refusal(facts)).not.toBeNull();
  });
});

describe("cached", () => {
  const dir = mkdtempSync(join(tmpdir(), "macos-runner-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("an allowed verdict and a refusal are both kept", async () => {
    expect(await cached(dir, "ok", async () => null)).toBeNull();
    expect(await cached(dir, "ok", async () => "decided twice")).toBeNull();
    expect(await cached(dir, "no", async () => "refused")).toBe("refused");
    expect(await cached(dir, "no", async () => null)).toBe("refused");
  });

  test("an empty file refuses", async () => {
    writeFileSync(join(dir, "empty"), "");
    expect(await cached(dir, "empty", async () => null)).not.toBeNull();
  });
});

describe("workflow wiring", () => {
  type Job = { "runs-on"?: string };
  const jobs = (file: string) =>
    (Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as { jobs: Record<string, Job> }).jobs;

  test.each([
    ["checks.yml", "scope", ["deck-macos", "plugin-herdr-chat", "unit-macos"]],
    ["e2e.yml", "changes", ["e2e-tests", "glitter-pty"]],
  ] as const)("%s routes every macOS job through %s", (file, router, macosJobs) => {
    const all = jobs(file);
    const notUbuntu = Object.keys(all).filter((name) => all[name]!["runs-on"] !== "ubuntu-latest");
    expect(notUbuntu.sort()).toEqual([...macosJobs]);
    for (const name of macosJobs) {
      expect(all[name]!["runs-on"]).toBe(`\${{ fromJSON(needs.${router}.outputs.macos_runner) }}`);
    }
  });
});
