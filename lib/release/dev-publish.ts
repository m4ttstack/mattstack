/**
 * The dev-publish leg's work: notarize the dev app update-machine just built
 * at the tag, zip it, and attach it and its checksum to the release. Runs on
 * the maintainer's Mac (the signing identity and notary profile live there);
 * GitHub Actions never builds the dev app.
 */
import { join } from "path";
import { execTail, type AppSwapSeams } from "./app-swap.ts";

export const NOTARY_PROFILE_DEFAULT = "mattstack-notary";
// Not RELEASE_REPO from update-machine.ts: that module imports this one.
const REPO = "m4ttstack/mattstack";
const NOTARIZE_TIMEOUT_MS = 50 * 60_000;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

export interface DevPublishSeams extends AppSwapSeams {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): Promise<void>;
}

export interface DevPublishInput {
  bundleDir: string;
  workDir: string;
  tag: string;
  version: string;
  notaryProfile: string;
}

export type DevPublishResult = { ok: true; detail: string } | { ok: false; error: string };

/** shasum's binary mode marks the name with a leading `*`; either form names the same file. */
function sumsLineNames(line: string, fileName: string): boolean {
  return line.trim().split(/\s+/).at(-1)?.replace(/^\*/, "") === fileName;
}

export function mergeSums(existing: string, fileName: string, sha: string): string {
  const kept = existing.split("\n").filter((line) => line.trim() !== "" && !sumsLineNames(line, fileName));
  return [...kept, `${sha}  ${fileName}`].join("\n") + "\n";
}

export async function publishDevApp(seams: DevPublishSeams, input: DevPublishInput): Promise<DevPublishResult> {
  const app = join(input.bundleDir, "rt-tray", "mattstack-dev.app");
  const zipName = `mattstack-dev-${input.version}.zip`;
  const zip = join(input.workDir, zipName);
  const sumsDir = join(input.workDir, "sums");
  const sumsPath = join(sumsDir, "SHA256SUMS");

  // notarize.sh staples the app in place, so the zip below carries the ticket.
  const notarize = await seams.exec(["scripts/release/notarize.sh", "rt-tray/mattstack-dev.app"], {
    cwd: input.bundleDir,
    env: { NOTARY_PROFILE: input.notaryProfile },
    timeoutMs: NOTARIZE_TIMEOUT_MS,
  });
  if (notarize.exitCode !== 0) return { ok: false, error: `notarize.sh failed: ${execTail(notarize)}` };

  const zipped = await seams.exec(["ditto", "-c", "-k", "--keepParent", app, zip]);
  if (zipped.exitCode !== 0) return { ok: false, error: `zipping the dev app failed: ${execTail(zipped)}` };

  const sum = await seams.exec(["shasum", "-a", "256", zip]);
  const sha = sum.stdout.trim().split(/\s+/)[0];
  if (sum.exitCode !== 0 || !sha) return { ok: false, error: `shasum failed: ${execTail(sum)}` };

  const fetchSums = await seams.exec(["gh", "release", "download", input.tag, "--repo", REPO, "--pattern", "SHA256SUMS", "--dir", sumsDir, "--clobber"]);
  if (fetchSums.exitCode !== 0) return { ok: false, error: `downloading SHA256SUMS failed: ${execTail(fetchSums)}` };
  const current = seams.readFile(sumsPath);
  if (current === null) return { ok: false, error: `the release's SHA256SUMS could not be read at ${sumsPath}` };

  const uploadZip = await seams.exec(["gh", "release", "upload", input.tag, zip, "--repo", REPO, "--clobber"], { timeoutMs: UPLOAD_TIMEOUT_MS });
  if (uploadZip.exitCode !== 0) return { ok: false, error: `uploading ${zipName} failed: ${execTail(uploadZip)}` };

  await seams.writeFile(sumsPath, mergeSums(current, zipName, sha));
  const uploadSums = await seams.exec(["gh", "release", "upload", input.tag, sumsPath, "--repo", REPO, "--clobber"]);
  if (uploadSums.exitCode !== 0) {
    return { ok: false, error: `${zipName} is attached, but uploading the updated SHA256SUMS failed: ${execTail(uploadSums)}` };
  }

  return { ok: true, detail: `${zipName} notarized and attached to ${input.tag}` };
}
