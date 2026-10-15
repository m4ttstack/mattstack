import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { gitWithToken } from "./git-credential.ts";
import { markerAtRef } from "./org-layout.ts";
import { parseMarker } from "./org-marker.ts";
import { withoutUrls } from "./redact.ts";

const MISSING_REF = /couldn't find remote ref/i;
const MISSING_PATH = /does not exist|exists on disk, but not in|not in the index/i;

function unreadable(output: string): UserActionableError {
  return new UserActionableError("main-pointer-unreadable", "rt could not read the org's main branch, so it made no invite", {}, {
    why: "It needs main's pointer to know which branch the people you invite clone.",
    next: "rt team status",
    log: output,
  });
}

/**
 * What `main` on the remote says about where the org's data lives, read from
 * the remote itself: a clone's own marker may name a trial branch. Null when
 * main holds no readable marker (or does not exist yet); a fetch that fails
 * throws, because reading it as "no pointer" would make invite fall back to
 * main and seal the wrong branch.
 */
export async function readMainPointer(
  p: Pick<Probes, "exec">,
  remote: string,
  token: string | null,
): Promise<{ dataBranch: string | null; layout: number } | null> {
  const scratch = mkdtempSync(join(tmpdir(), "rt-main-pointer-scratch-"));
  const env = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  try {
    const init = await p.exec(["git", "init", "-q", "--bare", scratch], { env });
    if (init.code !== 0) throw unreadable(withoutUrls(`${init.stdout}\n${init.stderr}`.trim()));
    const fetch = gitWithToken(["-C", scratch, "fetch", "-q", "--depth", "1", "--filter=blob:none", remote, "main"], token, env, { remote });
    const fetched = await p.exec(fetch.argv, { env: fetch.env });
    if (fetched.code !== 0) {
      const output = withoutUrls(`${fetched.stdout}\n${fetched.stderr}`.trim());
      if (MISSING_REF.test(output)) return null;
      throw unreadable(output);
    }
    const shown = await p.exec(["git", "-C", scratch, "show", markerAtRef("FETCH_HEAD")], { env });
    if (shown.code !== 0) {
      const output = withoutUrls(`${shown.stdout}\n${shown.stderr}`.trim());
      if (MISSING_PATH.test(output)) return null;
      throw unreadable(output);
    }
    const marker = parseMarker(shown.stdout);
    return marker.kind === "org" ? { dataBranch: marker.dataBranch, layout: marker.layout } : null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
