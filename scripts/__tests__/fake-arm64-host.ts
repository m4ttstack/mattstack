import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * A PATH that reports an arm64 host. fetch-deps.sh refuses any other host
 * because a compile there lands the wrong CPU type; a test that only unpacks
 * archives compiles nothing, so it can run on any host.
 */
export function fakeArm64Path(dir: string): string {
  const bin = join(dir, "fake-arm64-host");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "uname"), "#!/bin/sh\necho arm64\n");
  chmodSync(join(bin, "uname"), 0o755);
  return `${bin}:${process.env.PATH}`;
}
