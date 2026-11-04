#!/usr/bin/env bun
// Decides which macOS runner a run may use. Two callers share this one rule:
// the workflows' routing step, and the job-started hook on the Mac. A PR can
// edit the workflow, so only the hook's installed copy is a security boundary.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const OWNER = "m4ttheweric";
export const REPO = "m4ttstack/mattstack";
export const HOSTED = "macos-latest";
export const MAC = ["self-hosted", "mattstack-mac"];

export type Facts = {
  repo: string;
  eventName: string;
  actor: string;
  triggeringActor: string;
  prAuthor?: string;
  prHeadRepo?: string;
  groupAuthors?: { login: string; headRepo: string }[];
};

export function refusal(facts: Facts): string | null {
  if (facts.repo !== REPO) return `repo ${facts.repo} is not ${REPO}`;
  for (const actor of [facts.actor, facts.triggeringActor]) {
    if (actor !== OWNER) return `actor ${actor} is not ${OWNER}`;
  }
  if (facts.eventName === "pull_request") {
    if (facts.prAuthor !== OWNER) return `PR author ${facts.prAuthor} is not ${OWNER}`;
    if (facts.prHeadRepo !== REPO) return `PR head ${facts.prHeadRepo} is not ${REPO}`;
    return null;
  }
  if (facts.eventName === "merge_group") {
    if (!facts.groupAuthors?.length) return "the merge group lists no PRs";
    for (const { login, headRepo } of facts.groupAuthors) {
      if (login !== OWNER) return `merge group has a PR by ${login}`;
      if (headRepo !== REPO) return `merge group has a PR from ${headRepo}`;
    }
    return null;
  }
  return `event ${facts.eventName} never runs on the Mac`;
}

export function prNumbers(commitMessages: string[]): number[] {
  return commitMessages.map((message) => {
    const title = message.split("\n")[0]!.trim();
    const match = /\(#(\d+)\)$/.exec(title);
    if (!match) throw new Error(`no PR number in: ${title}`);
    return Number(match[1]);
  });
}

type Get = (path: string) => Promise<unknown>;

async function groupAuthors(headSha: string, get: Get): Promise<NonNullable<Facts["groupAuthors"]>> {
  const compare = (await get(`/repos/${REPO}/compare/main...${headSha}`)) as { commits: { commit: { message: string } }[] };
  const numbers = prNumbers(compare.commits.map((c) => c.commit.message));
  return Promise.all(
    numbers.map(async (n) => {
      const pr = (await get(`/repos/${REPO}/pulls/${n}`)) as { user: { login: string }; head: { repo: { full_name: string } | null } };
      return { login: pr.user.login, headRepo: pr.head.repo?.full_name ?? "a deleted fork" };
    }),
  );
}

type Event = {
  pull_request?: { user?: { login?: string }; head?: { repo?: { full_name?: string } | null } };
  merge_group?: { head_sha?: string };
};

export async function readFacts(env: Record<string, string | undefined>, event: Event, get: Get): Promise<Facts> {
  const facts: Facts = {
    repo: env.GITHUB_REPOSITORY ?? "",
    eventName: env.GITHUB_EVENT_NAME ?? "",
    actor: env.GITHUB_ACTOR ?? "",
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR ?? env.GITHUB_ACTOR ?? "",
  };
  if (facts.eventName === "pull_request") {
    facts.prAuthor = event.pull_request?.user?.login;
    facts.prHeadRepo = event.pull_request?.head?.repo?.full_name;
  }
  if (facts.eventName === "merge_group") {
    facts.groupAuthors = await groupAuthors(event.merge_group?.head_sha ?? "", get);
  }
  return facts;
}

function apiGet(token: string | undefined): Get {
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
    return response.json();
  };
}

// The hook has no token, and an anonymous caller gets 60 API calls an hour,
// so one verdict covers every job of a queue run.
async function cached(dir: string | undefined, key: string, decide: () => Promise<string | null>): Promise<string | null> {
  if (!dir || !key) return decide();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, key);
  if (existsSync(file)) return readFileSync(file, "utf8") || null;
  const reason = await decide();
  writeFileSync(file, reason ?? "");
  return reason;
}

async function decideRun(env: Record<string, string | undefined>): Promise<string | null> {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8")) as Event;
  const key = env.GITHUB_EVENT_NAME === "merge_group" ? (event.merge_group?.head_sha ?? "") : "";
  return cached(env.MAC_RUNNER_CACHE, key, async () => refusal(await readFacts(env, event, apiGet(env.GITHUB_TOKEN))));
}

if (import.meta.main) {
  const env = process.env;
  const reason = await decideRun(env).catch((error: unknown) => `could not decide: ${error}`);
  if (process.argv.includes("--hook")) {
    if (reason) {
      console.error(`Refused on the Mac runner: ${reason}`);
      process.exit(1);
    }
  } else {
    const useMac = env.MAC_RUNNER === "on" && !reason;
    console.log(useMac ? "macOS jobs run on the Mac" : `macOS jobs run on ${HOSTED}: ${reason ?? "the Mac runner is off"}`);
    appendFileSync(env.GITHUB_OUTPUT ?? "/dev/stdout", `macos_runner=${JSON.stringify(useMac ? MAC : HOSTED)}\n`);
  }
}
