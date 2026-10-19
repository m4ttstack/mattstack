import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { ORG_STORE_REL } from "../../../packages/rt-client/src/settings/paths.ts";
import { ORG_MARKER_REL, POINTER_REL, pointerText } from "../org-marker.ts";
import { orgWorld } from "./org-world.ts";

const markerNaming = (dataBranch: string): string => `${JSON.stringify({ role: "org", org: "acme", layout: 4, dataBranch })}\n`;

interface OrphanOptions {
  /** The data branch its marker names; the branch's own name, as the conversion script writes for a trial. */
  dataBranch?: string;
  /** Only the marker, no org store: the pointer a layout 4 org leaves on `main`. */
  pointer?: boolean;
  force?: boolean;
  /** The org store the branch holds; the conversion script copies the org's own. */
  store?: string;
  /** Where the pointer's marker sits: the old folder file (the default), the root file alone (phase 2), or both (phase 1). */
  at?: "folder" | "root" | "both";
}

/** Pushes `branch` to `remote` as a root commit sharing no history with the clone, as a `--no-pointer` trial from the conversion script does. */
function pushOrphan(remote: string, branch: string, opts: OrphanOptions = {}): void {
  const scratch = mkdtempSync(join(tmpdir(), "rt-trial-scratch-"));
  const run = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=dev9", "-c", "user.email=dev9@example.test", ...args], { cwd: scratch, env: childEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    run("init", "-q", "-b", branch);
    mkdirSync(join(scratch, "mattstack", "org"), { recursive: true });
    const at = opts.at ?? "folder";
    if (at !== "root") writeFileSync(join(scratch, ORG_MARKER_REL), markerNaming(opts.dataBranch ?? branch));
    if (at !== "folder") writeFileSync(join(scratch, POINTER_REL), pointerText("acme", opts.dataBranch ?? branch));
    if (opts.pointer !== true) writeFileSync(join(scratch, ORG_STORE_REL), opts.store ?? "{}\n");
    run("add", "-A");
    run("commit", "-q", "-m", "trial root");
    run("push", "-q", ...(opts.force ? ["--force"] : []), remote, `${branch}:${branch}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const orgStore = (root: string): string => readFileSync(join(root, ORG_STORE_REL), "utf8");

/** orgWorld with the clone moved onto a `mattstack` data branch, the marker naming it, and origin holding it, with origin's `main` left as the pointer. */
export function dataBranchWorld(username = "dev1") {
  const w = orgWorld(username);
  w.git("checkout", "-q", "-b", "mattstack");
  writeFileSync(join(w.root, ORG_MARKER_REL), markerNaming("mattstack"));
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "data branch");
  w.git("push", "-q", "-u", "origin", "mattstack");
  const pushUnrelated = (branch: string, opts: OrphanOptions = {}) => pushOrphan(w.remote, branch, { dataBranch: "mattstack", store: orgStore(w.root), ...opts });
  const pointMainAtData = (at: OrphanOptions["at"] = "folder") => pushOrphan(w.remote, "main", { dataBranch: "mattstack", pointer: true, force: true, at });
  pointMainAtData();
  return { ...w, pushUnrelated, pointMainAtData };
}

/** orgWorld as a layout 3 org: the clone on `main`, whose marker names no data branch. `pushTrial` makes the orphan branch the conversion script leaves, main untouched. */
export function layout3World(username = "dev1") {
  const w = orgWorld(username);
  const pushTrial = (branch: string) => pushOrphan(w.remote, branch, { store: orgStore(w.root) });
  return { ...w, pushTrial };
}
