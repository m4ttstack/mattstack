import { cpSync, existsSync } from "fs";
import { CLONE_EXIT, cloneExitCode, clonePath } from "../clonefile.ts";
import type { CloneRunner } from "../hydrate.ts";

const realClone: CloneRunner = async (src, dst) => {
  const r = clonePath(src, dst);
  return { exitCode: cloneExitCode(r), stderr: r.ok ? "" : `clonefile: ${r.message}` };
};

// clonefile(2) is macOS only, and these suites pin the hydration around the
// clone, not the clone: clonefile.test.ts pins the syscall.
const copyClone: CloneRunner = async (src, dst) => {
  if (existsSync(dst)) return { exitCode: CLONE_EXIT.exist, stderr: "clonefile: File exists" };
  cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
  return { exitCode: CLONE_EXIT.ok, stderr: "" };
};

/** Clones in-process, without spawning the compiled `rt` binary the default runner shells out to: real clonefile(2) on macOS, a copy elsewhere. */
export const inProcessClone: CloneRunner = process.platform === "darwin" ? realClone : copyClone;
