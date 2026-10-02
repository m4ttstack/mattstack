/**
 * rt release verify... read-only confirmation that a tagged release actually
 * published (the rt:release skill's Publish and finish stage): the
 * release.yml run for the tag completed successfully, the published body
 * matches the committed RELEASE_NOTES.md, the four build assets are
 * attached, the release is neither a draft nor a prerelease, and the public
 * releases/latest endpoint has caught up. Never mutates anything; a failing
 * row names the matching recovery command instead of running it.
 */
import type { RunResult } from "../subprocess.ts";
import type { RowStatus as PreflightRowStatus } from "./preflight.ts";

export type VerifyRowStatus = PreflightRowStatus | "pending";

export interface VerifyRow {
  id: string;
  label: string;
  status: VerifyRowStatus;
  pinned?: string;
  current?: string;
  detail?: string;
}

export interface VerifyReport {
  tag: string | null;
  rows: VerifyRow[];
  staleCount: number;
  errorCount: number;
  pendingCount: number;
  clean: boolean;
}

export interface VerifyOptions {
  tag?: string;
  noWait?: boolean;
  /** Leave out releases/latest: its propagation lag says nothing about whether the tag itself published. */
  skipLatest?: boolean;
}

export interface VerifySeams {
  repoRoot: string;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  fetchJson(url: string): Promise<unknown>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ReleaseData {
  body: string;
  assets: { name: string }[];
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
}

const GH_REPO = "m4ttstack/mattstack";
const RELEASE_WORKFLOW = "release.yml";
// A real release.yml run (macOS build, notarize, clean room) takes 25-50
// minutes; a budget shorter than that would report "pending" on nearly
// every run watched right after the tag push.
const RUN_POLL_MAX_ATTEMPTS = 240;
const RUN_POLL_INTERVAL_MS = 15_000;
/** The tag-push run can take a minute or two to be listed after the push lands. */
const FIND_RUN_ATTEMPTS = 12;
const LATEST_PROPAGATION_WINDOW_MS = 20 * 60 * 1000;

export function requiredAssetNames(tag: string): string[] {
  const ver = tag.replace(/^v/, "");
  return [`mattstack-${ver}.dmg`, `mattstack-${ver}.zip`, "appcast.xml", "SHA256SUMS"];
}

async function ghApi(seams: VerifySeams, path: string, jq?: string): Promise<string> {
  const argv: [string, ...string[]] = jq ? ["gh", "api", path, "--jq", jq] : ["gh", "api", path];
  const r = await seams.exec(argv, { timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/**
 * `git describe --tags --abbrev=0` finds the nearest ancestor tag by commit
 * graph, not the highest version, and does not filter by prefix; a nearer
 * non-v tag would win over an older-but-real v* release. Listing and
 * version-sorting the local v* tags directly answers "latest v* tag" instead
 * of "nearest tag to HEAD".
 */
export async function resolveTag(seams: VerifySeams): Promise<{ tag: string | null; row: VerifyRow | null }> {
  try {
    const r = await seams.exec(["git", "tag", "--list", "v*", "--sort=-version:refname"], { cwd: seams.repoRoot });
    if (r.exitCode === 0) {
      const tag = r.stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
      if (tag) return { tag, row: { id: "tag", label: "tag", status: "ok", detail: `${tag} is the newest release tag on this Mac` } };
    }
  } catch {
    // fall through to the GitHub API
  }
  try {
    const tag = await ghApi(seams, `repos/${GH_REPO}/releases/latest`, ".tag_name");
    if (tag) return { tag, row: { id: "tag", label: "tag", status: "ok", detail: `${tag} is the newest release on GitHub; this Mac has no release tag` } };
  } catch (err) {
    return { tag: null, row: { id: "tag", label: "tag", status: "error", detail: `rt could not tell which tag to check: ${String((err as Error).message ?? err)}` } };
  }
  return { tag: null, row: { id: "tag", label: "tag", status: "error", detail: "rt could not tell which tag to check: there is no release tag on this Mac or on GitHub" } };
}

interface FoundRun {
  id: number;
  url: string;
}

/**
 * Filters server-side by event and branch (the tag-push run's headBranch
 * equals the tag) so an old release is found in one call instead of paging
 * through `gh run list`'s recency-ordered results looking for it.
 */
async function findRun(seams: VerifySeams, tag: string): Promise<FoundRun | null> {
  const path = `repos/${GH_REPO}/actions/workflows/${RELEASE_WORKFLOW}/runs?event=push&branch=${encodeURIComponent(tag)}&per_page=5`;
  const r = await seams.exec(["gh", "api", path], { timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  const parsed = JSON.parse(r.stdout) as { workflow_runs: { id: number; html_url: string }[] };
  const run = parsed.workflow_runs[0];
  return run ? { id: run.id, url: run.html_url } : null;
}

export interface PollResult {
  status: string;
  conclusion: string | null;
  attempts: number;
  pollErrors: number;
}

export async function pollRunCompletion(seams: VerifySeams, runId: number, noWait: boolean): Promise<PollResult> {
  let status = "unknown";
  let conclusion: string | null = null;
  let pollErrors = 0;
  const maxAttempts = noWait ? 1 : RUN_POLL_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await seams.exec(["gh", "run", "view", String(runId), "--repo", GH_REPO, "--json", "status,conclusion"], { timeoutMs: 30_000 });
      if (r.exitCode === 0) {
        const parsed = JSON.parse(r.stdout) as { status: string; conclusion: string | null };
        status = parsed.status;
        conclusion = parsed.conclusion;
        if (status === "completed") return { status, conclusion, attempts: attempt, pollErrors };
      } else {
        pollErrors++;
      }
    } catch {
      pollErrors++;
    }
    if (attempt < maxAttempts) await seams.sleep(RUN_POLL_INTERVAL_MS);
  }
  return { status, conclusion, attempts: maxAttempts, pollErrors };
}

function runRowFromPoll(runId: number, url: string, poll: PollResult): VerifyRow {
  const id = "run";
  const label = "release run";
  if (poll.status === "completed") {
    if (poll.conclusion === "success") {
      return { id, label, status: "ok", detail: `run ${runId} completed successfully (${url})` };
    }
    return {
      id, label, status: "stale",
      detail: `Run ${runId} ended "${poll.conclusion}". To recover, delete the GitHub release (the tag stays), then rerun its failed jobs: gh release delete <tag>, then gh run rerun ${runId} --failed`,
    };
  }
  // Every attempt errored and none ever returned a real status: this is not
  // "still running", it is "gh was unreachable the whole time".
  if (poll.status === "unknown" && poll.pollErrors === poll.attempts) {
    return { id, label, status: "error", detail: `rt could not reach GitHub to check run ${runId} after ${poll.attempts} tries. Check again with: rt release verify` };
  }
  const errNote = poll.pollErrors > 0 ? ` (${poll.pollErrors} of them could not reach GitHub)` : "";
  return {
    id, label, status: "pending",
    detail: `Run ${runId} is still ${poll.status} after ${poll.attempts} checks${errNote}. Check again with: rt release verify`,
  };
}

export async function checkRun(seams: VerifySeams, tag: string, noWait: boolean): Promise<VerifyRow> {
  let found: FoundRun | null = null;
  const lookups = noWait ? 1 : FIND_RUN_ATTEMPTS;
  for (let attempt = 1; attempt <= lookups && !found; attempt++) {
    try {
      found = await findRun(seams, tag);
    } catch (err) {
      return { id: "run", label: "release run", status: "error", detail: String((err as Error).message ?? err) };
    }
    if (!found && attempt < lookups) await seams.sleep(RUN_POLL_INTERVAL_MS);
  }
  if (!found) {
    const waited = lookups > 1 ? ` after ${lookups} lookups over ${Math.round(((lookups - 1) * RUN_POLL_INTERVAL_MS) / 60_000)}m` : "";
    return { id: "run", label: "release run", status: "error", detail: `no release.yml run found for a tag push of ${tag}${waited}` };
  }
  const poll = await pollRunCompletion(seams, found.id, noWait);
  return runRowFromPoll(found.id, found.url, poll);
}

async function fetchRelease(seams: VerifySeams, tag: string): Promise<{ ok: true; data: ReleaseData } | { ok: false; error: string }> {
  const r = await seams.exec(["gh", "release", "view", tag, "--repo", GH_REPO, "--json", "body,assets,isDraft,isPrerelease,publishedAt"], { timeoutMs: 30_000 });
  if (r.exitCode !== 0) return { ok: false, error: `gh release view ${tag} failed: ${(r.stderr || r.stdout).trim()}` };
  try {
    return { ok: true, data: JSON.parse(r.stdout) as ReleaseData };
  } catch (err) {
    return { ok: false, error: `gh release view ${tag} returned unparseable JSON: ${String((err as Error).message ?? err)}` };
  }
}

export async function checkReleaseBody(seams: VerifySeams, tag: string, data: ReleaseData): Promise<VerifyRow> {
  const id = "release-body";
  const label = "release notes";
  try {
    const r = await seams.exec(["git", "show", `${tag}:RELEASE_NOTES.md`], { cwd: seams.repoRoot });
    if (r.exitCode !== 0) throw new Error(`git show ${tag}:RELEASE_NOTES.md failed: ${(r.stderr || r.stdout).trim()}`);
    if (r.stdout === data.body) return { id, label, status: "ok", detail: "release body matches the committed RELEASE_NOTES.md" };
    return {
      id, label, status: "stale",
      detail: `The release's notes do not match the committed RELEASE_NOTES.md at ${tag}. If the committed notes were wrong, the fix is a new tag: never edit the release by hand. To compare them: git show ${tag}:RELEASE_NOTES.md and gh release view ${tag} --json body`,
    };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}

export function checkReleaseAssets(tag: string, data: ReleaseData): VerifyRow {
  const id = "release-assets";
  const label = "release assets";
  const required = requiredAssetNames(tag);
  const present = new Set((data.assets ?? []).map((a) => a.name));
  const missing = required.filter((n) => !present.has(n));
  if (missing.length === 0) return { id, label, status: "ok", detail: `all four assets attached: ${required.join(", ")}` };
  return { id, label, status: "stale", detail: `missing assets: ${missing.join(", ")}. The rt:mattstack-release skill finishes them by hand.` };
}

export function checkReleaseState(data: ReleaseData): VerifyRow {
  const id = "release-state";
  const label = "release state";
  const problems: string[] = [];
  if (data.isDraft) problems.push("still a draft. To publish it: gh release edit <tag> --draft=false");
  if (data.isPrerelease) problems.push("marked prerelease");
  if (problems.length === 0) return { id, label, status: "ok", detail: "published, not a draft or prerelease" };
  return { id, label, status: "stale", detail: problems.join("; ") };
}

export async function checkLatest(seams: VerifySeams, tag: string, releaseData: ReleaseData | null): Promise<VerifyRow> {
  const id = "latest";
  const label = "releases/latest";
  let latest: { tag_name: string; assets: { name: string }[] };
  try {
    latest = (await seams.fetchJson(`https://api.github.com/repos/${GH_REPO}/releases/latest`)) as typeof latest;
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }

  const required = requiredAssetNames(tag);
  const present = new Set((latest.assets ?? []).map((a) => a.name));
  const missing = required.filter((n) => !present.has(n));

  // The endpoint already resolves to the right tag: any remaining gap is a
  // real missing-asset problem, never propagation lag, whatever the clock says.
  if (latest.tag_name === tag) {
    if (missing.length === 0) {
      return { id, label, status: "ok", pinned: tag, current: latest.tag_name, detail: "resolves to the verified tag with all four assets" };
    }
    return {
      id, label, status: "stale", pinned: tag, current: latest.tag_name,
      detail: `resolves to the tag but is missing ${missing.join(", ")}`,
    };
  }

  if (releaseData?.isDraft) {
    return {
      id, label, status: "stale", pinned: tag, current: latest.tag_name,
      detail: "The release is still a draft, so the latest-release link will not point at it until it is public.",
    };
  }

  const publishedAt = releaseData?.publishedAt ? new Date(releaseData.publishedAt).getTime() : null;
  const elapsed = publishedAt !== null && !Number.isNaN(publishedAt) ? seams.now() - publishedAt : null;
  // No >= 0 guard: a local clock running slightly behind GitHub's reports a
  // small negative elapsed right after publish, and that is still well
  // inside the propagation window, not proof the window has passed.
  if (elapsed !== null && elapsed < LATEST_PROPAGATION_WINDOW_MS) {
    const minutes = Math.round(elapsed / 60_000);
    const published = minutes < 1 ? "just published" : `published ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    return {
      id, label, status: "pending", pinned: tag, current: latest.tag_name,
      detail: `still propagating: ${published}, and the latest-release link can lag about 20 minutes behind`,
    };
  }

  const windowNote = elapsed === null ? "the publish time is unknown" : "the ~20m propagation window has passed";
  return {
    id, label, status: "stale", pinned: tag, current: latest.tag_name,
    detail: `resolves to ${latest.tag_name}, not ${tag}, and ${windowNote}`,
  };
}

function finalize(tag: string | null, rows: VerifyRow[]): VerifyReport {
  const staleCount = rows.filter((r) => r.status === "stale").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return { tag, rows, staleCount, errorCount, pendingCount, clean: staleCount === 0 && errorCount === 0 && pendingCount === 0 };
}

export async function runVerify(seams: VerifySeams, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const rows: VerifyRow[] = [];
  let tag = opts.tag ?? null;

  if (!tag) {
    const resolved = await resolveTag(seams);
    tag = resolved.tag;
    if (resolved.row) rows.push(resolved.row);
  }

  if (!tag) return finalize(null, rows);

  rows.push(await checkRun(seams, tag, opts.noWait ?? false));

  const release = await fetchRelease(seams, tag);
  if (!release.ok) {
    rows.push({ id: "release-body", label: "release notes", status: "error", detail: release.error });
    rows.push({ id: "release-assets", label: "release assets", status: "error", detail: release.error });
    rows.push({ id: "release-state", label: "release state", status: "error", detail: release.error });
    if (!opts.skipLatest) rows.push(await checkLatest(seams, tag, null));
    return finalize(tag, rows);
  }

  rows.push(await checkReleaseBody(seams, tag, release.data));
  rows.push(checkReleaseAssets(tag, release.data));
  rows.push(checkReleaseState(release.data));
  if (!opts.skipLatest) rows.push(await checkLatest(seams, tag, release.data));

  return finalize(tag, rows);
}
