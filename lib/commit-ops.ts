/**
 * Non-interactive commit primitives behind glitter and `rt git amend`. Kept
 * free of picker/prompt concerns so they are unit testable against real repos.
 */

import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

export interface CommitOptions {
  amend?: boolean;
  noVerify?: boolean;
  allowEmpty?: boolean;
  coAuthors?: string[];
}

/**
 * Commit the staged changes. The message is passed as an argv element (never
 * through a shell), so quotes, newlines, and `$(...)` are committed verbatim.
 * Options map to git flags (--amend, --no-verify, --allow-empty); coAuthors
 * become Co-Authored-By trailers appended after a blank line.
 * Returns git's summary line (e.g. "[main a1b2c3d] feat: ...").
 */
export function commitStaged(
  cwd: string,
  message: string,
  opts: CommitOptions = {},
): string {
  const trailers = (opts.coAuthors ?? [])
    .map((a) => `Co-Authored-By: ${a}`)
    .join("\n");
  const fullMessage = trailers ? `${message}\n\n${trailers}` : message;
  const args = ["commit", "-m", fullMessage];
  if (opts.amend) args.push("--amend");
  if (opts.noVerify) args.push("--no-verify");
  if (opts.allowEmpty) args.push("--allow-empty");
  const out = git(cwd, args);
  return out.split("\n")[0] ?? "";
}

/**
 * Amend the last commit with whatever is staged. No message keeps the
 * existing one (--no-edit); a message replaces it via argv, never a shell.
 */
export function amendStaged(
  cwd: string,
  opts: { message?: string; noVerify?: boolean } = {},
): string {
  const args = ["commit", "--amend"];
  if (opts.message) args.push("-m", opts.message);
  else args.push("--no-edit");
  if (opts.noVerify) args.push("--no-verify");
  const out = git(cwd, args);
  return out.split("\n")[0] ?? "";
}
