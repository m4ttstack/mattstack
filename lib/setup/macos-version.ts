import type { Probes } from "./probes.ts";

export interface MacosVersion {
  version: string;
  major: number;
}

/** null when `sw_vers` exited non-zero or printed nothing numeric: callers treat that as unknown, never as too old. A throwing probe still throws. */
export async function readMacosVersion(p: Pick<Probes, "exec">): Promise<MacosVersion | null> {
  const res = await p.exec(["sw_vers", "-productVersion"]);
  const version = res.code === 0 ? res.stdout.trim() : "";
  const major = version ? Number.parseInt(version.split(".")[0]!, 10) : NaN;
  return Number.isNaN(major) ? null : { version, major };
}
