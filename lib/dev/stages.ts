import { dirname } from "path";
import { UserActionableError } from "../errors.ts";
import { chooseDevRelease, installDevAppFromRelease, listDevReleases, readInstalledDevApp } from "./dev-app.ts";
import type { ChosenDevRelease, DevSeams, StageEnding, StageIO } from "./seams.ts";
import { compareVersions, installCommandFor, probeDevTools, type DevPins, type DevToolStatus } from "./tools.ts";

export function isMattstackRemote(url: string): boolean {
  return /github\.com[:/]m4ttstack\/mattstack(\.git)?\/?$/.test(url.trim());
}

function label(t: DevToolStatus): string {
  return `${t.name} ${t.version}`;
}

export async function ensureTools(s: DevSeams, pins: DevPins, io: StageIO): Promise<{ ending: StageEnding; bunPath: string; goPath: string }> {
  let tools = await probeDevTools(s.probes, pins);
  for (const t of tools.filter((x) => x.need === "required" && x.state !== "ready")) {
    const command = installCommandFor(t.name, t.wanted);
    const what = t.state === "too-old" ? `${t.name} ${t.version} is older than the ${t.wanted} mattstack needs` : `${t.name} is not installed`;
    if (t.name === "git" || !s.interactive) {
      throw new UserActionableError("dev-tool-missing", what, {}, { next: command });
    }
    if (!(await io.pause(() => s.confirm(`${what}. Install ${t.name} ${t.wanted} now?`)))) {
      throw new UserActionableError("dev-tool-missing", what, {}, { next: command });
    }
    io.sub(`Installing ${t.name} ${t.wanted}`);
    const result = await s.installDevTool(t.name, t.wanted!);
    if (!result.ok) throw new UserActionableError("dev-tool-install-failed", `Installing ${t.name} failed`, {}, { why: result.detail, next: command });
  }
  // An installer that reports ok has not proven the pin is met, so the tools are probed again.
  tools = await probeDevTools(s.probes, pins);
  const stillMissing = tools.find((x) => x.need === "required" && x.state !== "ready");
  if (stillMissing) {
    throw new UserActionableError(
      "dev-tool-install-failed",
      `${stillMissing.name} ${stillMissing.wanted} is still not available`,
      {},
      {
        why: "Open a new terminal so it can find the new install, then run this again.",
        next: installCommandFor(stillMissing.name, stillMissing.wanted),
      },
    );
  }
  const node = tools.find((x) => x.name === "node")!;
  const ready = tools
    .filter((x) => x.state === "ready" && x.name !== "git")
    .map(label)
    .join(" · ");
  const hint = node.state === "ready" ? ready : `${ready} · node 20 or newer is optional, some test suites need it`;
  return {
    ending: { status: "done", title: "Your tools are ready", hint },
    bunPath: tools.find((x) => x.name === "bun")!.found!,
    goPath: tools.find((x) => x.name === "go")!.found!,
  };
}

export interface DevToolPaths {
  bunPath: string;
  goPath: string;
}

export function toolchainEnv(s: DevSeams, tools: DevToolPaths): { PATH: string } {
  return { PATH: `${dirname(tools.goPath)}:${dirname(tools.bunPath)}:${s.probes.env.PATH ?? ""}` };
}

export async function buildRtUi(s: DevSeams, clone: string, tools: DevToolPaths): Promise<void> {
  const r = await s.probes.exec([tools.bunPath, "run", "ui:build"], { cwd: clone, env: toolchainEnv(s, tools), timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new UserActionableError("dev-build-failed", "Building rt's terminal helper failed", {}, { log: r.stderr || r.stdout });
}

export function requireGh(s: DevSeams): string[] {
  const gh = s.gh();
  if (!gh) {
    throw new UserActionableError("dev-no-gh", "This app does not include the GitHub command-line tool rt needs", {}, { why: "Reinstall mattstack, then run this again." });
  }
  return gh;
}

export async function findDevRelease(s: DevSeams): Promise<ChosenDevRelease> {
  const chosen = await chooseDevRelease(s.probes, await listDevReleases(s.probes, requireGh(s)));
  if (!chosen) {
    throw new UserActionableError(
      "dev-no-dev-zip",
      "rt could not find a mattstack release with a dev app",
      {},
      { why: "Check your internet connection. If you're online, the maintainers have not published one yet." },
    );
  }
  return chosen;
}

export async function ensureDevApp(s: DevSeams, io: StageIO, mode: "setup" | "update", chosen?: ChosenDevRelease): Promise<StageEnding> {
  const installed = await readInstalledDevApp(s.probes);
  if (mode === "update" && installed && !installed.releaseBuild) {
    return { status: "skipped", title: "Your dev app was built on this Mac", hint: "rt only updates a dev app that came from a release" };
  }
  const pick = chosen ?? (await findDevRelease(s));
  if (installed && compareVersions(installed.version, pick.release.version) >= 0) {
    return { status: "skipped", title: `Dev app ${installed.version} is current` };
  }
  io.sub(`Downloading the dev app ${pick.release.version}`);
  const r = await installDevAppFromRelease(s, pick, installed);
  const version = pick.release.version !== s.prodVersion ? `${pick.release.version}, the newest release with a dev app` : pick.release.version;
  const relaunched = r.relaunchedPid !== null ? " and reopened it" : "";
  return { status: "done", title: `Installed the dev app${relaunched}`, hint: version };
}
