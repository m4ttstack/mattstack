import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { gitWithToken } from "./git-credential.ts";
import { MISSING_PATH_RE, showMarkerAt } from "./org-layout.ts";
import { ORG_MARKER_REL, parseMarker } from "./org-marker.ts";
import { withoutUrls } from "./redact.ts";

// The filtered fetch leaves the marker blob on the remote, so `show` fetches it lazily and needs the same credentials as the fetch.
const MISSING_REF = /couldn't find remote ref/i;

function unreadable(output: string): UserActionableError {
  return new UserActionableError("main-pointer-unreadable", "rt could not read the org's main branch, so it made no invite", {}, {
    why: "It needs main's pointer to know which branch the people you invite clone.",
    next: "rt team status",
    log: output,
  });
}

export interface MainPointer {
  dataBranch: string | null;
  layout: number;
}

export interface MainBranch {
  /** Null when main holds no marker rt can read. */
  pointer: MainPointer | null;
  /** Org files under `mattstack/` that main holds besides the old folder pointer: the org's data merged into main. */
  orgFiles: string[];
}

/**
 * What origin's `main` holds for the org, read from the remote itself: a
 * clone's own marker may name a trial branch. Null when there is no `main`
 * yet; a fetch that fails throws, because reading it as "no pointer" would
 * make invite fall back to main and seal the wrong branch.
 */
export async function readMainBranch(p: Pick<Probes, "exec">, remote: string, token: string | null): Promise<MainBranch | null> {
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
    const listed = await p.exec(["git", "-C", scratch, "ls-tree", "-r", "--name-only", "FETCH_HEAD", "--", "mattstack"], { env });
    if (listed.code !== 0) throw unreadable(withoutUrls(`${listed.stdout}\n${listed.stderr}`.trim()));
    const orgFiles = listed.stdout.split("\n").filter((path) => path !== "" && path !== ORG_MARKER_REL);
    const shown = await showMarkerAt(async (spec) => {
      const show = gitWithToken(["-C", scratch, "show", spec], token, env, { remote });
      return p.exec(show.argv, { env: show.env });
    }, "FETCH_HEAD");
    if (shown.code !== 0) {
      if (MISSING_PATH_RE.test(shown.stderr)) return { pointer: null, orgFiles };
      throw unreadable(withoutUrls(`${shown.stdout}\n${shown.stderr}`.trim()));
    }
    const marker = parseMarker(shown.stdout);
    return { pointer: marker.kind === "org" ? { dataBranch: marker.dataBranch, layout: marker.layout } : null, orgFiles };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What origin's `main` says about where the org's data lives: its root pointer, else its folder pointer. Null when main holds neither, or does not exist yet. */
export async function readMainPointer(p: Pick<Probes, "exec">, remote: string, token: string | null): Promise<MainPointer | null> {
  return (await readMainBranch(p, remote, token))?.pointer ?? null;
}
