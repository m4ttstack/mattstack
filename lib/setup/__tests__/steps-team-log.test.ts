import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { logsDir } from "../../rt-paths.ts";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import { UserActionableError } from "../../errors.ts";
import { JoinKeyExchangeError, JoinPeeringStoreError } from "../../team/join.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import type { ApplyContext } from "../apply.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { outcomeFromJoinError, teamCreateStep } from "../steps/team.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { scaffoldFiles } from "../../team/create.ts";
import { fakeProbes } from "./fakes.ts";

function cliLog(): string {
  const dir = logsDir();
  const files = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log"));
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
}

const ageKeySeam: AgeKeySeam = {
  async run(cmd): Promise<AgeExecResult> {
    if (cmd[0] === "security") return { code: 0, stdout: "AGE-SECRET-KEY-1FAKE\n", stderr: "" };
    if (cmd[0] === "age-keygen") return { code: 0, stdout: "age1fake\n", stderr: "" };
    throw new Error(`unexpected age call ${cmd.join(" ")}`);
  },
};

const secrets: SecretsSeams = {
  ageKeySeam,
  execSeam: {
    async run(): Promise<never> {
      throw new Error("no secrets store in this test");
    },
  } as unknown as SecretsSeams["execSeam"],
};

const relay = {} as RelayClient;

function createCtx(p: Probes, slug: string, remote: string): ApplyContext {
  return {
    p,
    emit: () => {},
    log: () => {},
    intent: { v: 1, at: "", mode: "create", team: { slug, name: slug, remote, others: false } },
    team: { slug: "", name: "", mode: "none" },
    snapshot: null,
    reqs: [],
    nonInteractive: false,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets,
    teamSecrets: () => secrets,
    relay,
    secretPresence: { has: async () => null },
    redact: () => {},
    async need() {
      return "no-app";
    },
  };
}

const ok: ExecResult = { code: 0, stdout: "", stderr: "" };

describe("setup team create records the cause of a failure", () => {
  test("a create failure reaches the CLI log and its why rides in the remedy", async () => {
    const slug = "marker-create-zz";
    const dir = `/fake-home/.mattstack/teams/${slug}`;
    const p = fakeProbes({ home: "/fake-home", exec: async () => ok });
    p.mkdirp(join(dir, ".git"));
    p.writeFile(join(dir, ".git", "config"), `[remote "origin"]\n\turl = https://forge.example/someone/other.git\n`);

    const outcome = await teamCreateStep.run(createCtx(p, slug, "https://forge.example/someone/new.git"));

    expect(outcome).toEqual({
      state: "failed",
      detail: `The ${slug} team is already set up here with a different repo`,
      remedy: "Use the repo it was created with, or remove the team's folder to start over.",
    });
    expect(cliLog()).toContain(dir);
  });

  test("a publish failure reaches the CLI log and its why rides in the remedy", async () => {
    const slug = "marker-publish-zz";
    const remote = "https://forge.example/someone/new.git";
    const pendingMain = "a".repeat(40);
    const rejected: ExecResult = { code: 1, stdout: "", stderr: "! [rejected] main -> main (fetch first) marker-publish-zz" };
    const p = fakeProbes({ home: "/fake-home", exec: async (argv) => {
      if (argv[1] === "remote" && argv[2] === "get-url") {
        expect(argv).toEqual(["git", "remote", "get-url", "--push", "--all", "origin"]);
        return { ...ok, stdout: `${remote}\n` };
      }
      if (argv.includes("ls-remote")) {
        expect(argv.slice(-3)).toEqual(["--", remote, "refs/heads/main"]);
        return ok;
      }
      if (argv[1] === "rev-list") {
        expect(argv).toEqual(["git", "rev-list", "--max-count=1001", "refs/heads/main"]);
        return { ...ok, stdout: `${pendingMain}\n` };
      }
      if (argv[1] === "diff-tree") {
        expect(argv.at(-1)).toBe(pendingMain);
        return { ...ok, stdout: `${Object.keys(scaffoldFiles(slug, slug, remote)).join("\0")}\0` };
      }
      return argv.includes("push") ? rejected : argv[1] === "rev-parse" ? { code: 1, stdout: "", stderr: "" } : ok;
    }, files: {
      [`/fake-home/.mattstack/teams/${slug}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }),
      [teamLocalPath("/fake-home", slug)]: JSON.stringify({ forgeUsername: "dev1" }),
    } });

    const outcome = await teamCreateStep.run(createCtx(p, slug, remote));

    expect(outcome).toEqual({ state: "failed", detail: "The team repo already has commits", remedy: "rt starts a team in an empty repo." });
    expect(cliLog()).toContain("marker-publish-zz");
    const pushIndex = p.calls.exec.findIndex((argv) => argv.includes("push"));
    expect(pushIndex).toBeGreaterThan(3);
    expect(p.calls.exec.slice(pushIndex - 4, pushIndex).map((argv) => argv[1])).toEqual(["remote", "ls-remote", "rev-list", "diff-tree"]);
    expect(p.calls.exec[pushIndex + 1]).toEqual(["git", "rev-parse", "--verify", "-q", "refs/remotes/origin/main"]);
  });
});

describe("setup team step records the cause of a failed join", () => {
  test("a UserActionableError's log reaches the CLI log and the outcome is unchanged", () => {
    const err = new UserActionableError("push-denied", "rt could not push", {}, { log: "remote: permission denied marker-uae" });
    expect(outcomeFromJoinError(err)).toEqual({ state: "failed", detail: "rt could not push" });
    expect(cliLog()).toContain("marker-uae");
  });

  test("forge-login-unknown keeps its sign-in steps as the remedy", () => {
    const err = new UserActionableError("forge-login-unknown", "rt could not tell who you are on GitHub. The invite has not been used yet.", {}, {
      why: "Sign in to the gh command line tool, then join again.",
      next: "gh auth login",
    });
    expect(outcomeFromJoinError(err)).toEqual({
      state: "failed",
      detail: "rt could not tell who you are on GitHub. The invite has not been used yet.",
      remedy: "Sign in to the gh command line tool, then join again. Run gh auth login",
    });
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
