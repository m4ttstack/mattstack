import type { Flavor } from "../flavor.ts";
import type { Probes } from "../setup/probes.ts";
import { chooseDevRelease, listDevReleases, readInstalledDevApp } from "./dev-app.ts";
import { compareVersions } from "./tools.ts";

export interface DevAppNotice {
  id: string;
  title: string;
  message: string;
}

/** Only a release-built dev app is told about updates: a locally built one is the maintainer's and follows main. */
export async function devAppNotice(s: { probes: Probes; flavor: Flavor; gh(): string[] | null }): Promise<DevAppNotice | null> {
  if (s.flavor !== "dev") return null;
  const installed = await readInstalledDevApp(s.probes);
  if (!installed?.releaseBuild) return null;
  const gh = s.gh();
  if (!gh) return null;
  let newest: string | undefined;
  try {
    newest = (await chooseDevRelease(s.probes, await listDevReleases(s.probes, gh)))?.release.version;
  } catch {
    return null;
  }
  if (!newest || compareVersions(newest, installed.version) <= 0) return null;
  return { id: `dev_app:${newest}`, title: "A newer dev app is ready", message: `mattstack-dev ${newest} is out. Run rt dev update to install it.` };
}
