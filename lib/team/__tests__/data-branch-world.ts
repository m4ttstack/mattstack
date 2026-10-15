import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { ORG_STORE_REL } from "../../../packages/rt-client/src/settings/paths.ts";
import { ORG_MARKER_REL } from "../org-marker.ts";
import { orgWorld } from "./org-world.ts";

const MARKER = `${JSON.stringify({ role: "org", org: "acme", layout: 4, dataBranch: "mattstack" })}\n`;

/** orgWorld with the clone moved onto a `mattstack` data branch, the marker naming it, and origin holding it. */
export function dataBranchWorld(username = "dev1") {
  const w = orgWorld(username);
  w.git("checkout", "-q", "-b", "mattstack");
  writeFileSync(join(w.root, ORG_MARKER_REL), MARKER);
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "data branch");
  w.git("push", "-q", "-u", "origin", "mattstack");
  /** Pushes `branch` to origin as a root commit sharing no history with the clone, as a `--no-pointer` trial from the script does. */
  const pushUnrelated = (branch: string, opts: { pointer?: boolean; force?: boolean } = {}) => {
    const pointer = opts.pointer === true;
    const scratch = mkdtempSync(join(tmpdir(), "rt-trial-scratch-"));
    const run = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=dev9", "-c", "user.email=dev9@example.test", ...args], { cwd: scratch, env: childEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      run("init", "-q", "-b", branch);
      mkdirSync(join(scratch, "mattstack", "org"), { recursive: true });
      writeFileSync(join(scratch, ORG_MARKER_REL), MARKER);
      if (!pointer) writeFileSync(join(scratch, ORG_STORE_REL), "{}\n");
      run("add", "-A");
      run("commit", "-q", "-m", "trial root");
      run("push", "-q", ...(opts.force ? ["--force"] : []), w.remote, `${branch}:${branch}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  /** Replaces origin's `main` with the pointer a layout 4 org leaves there: no org store, only the marker. */
  const pointMainAtData = () => pushUnrelated("main", { pointer: true, force: true });
  return { ...w, pushUnrelated, pointMainAtData };
}
