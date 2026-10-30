/**
 * `services.register` / `proxy.install` — the two `--from-app` steps: rt
 * cannot itself register a LaunchAgent or run the privileged proxy
 * installer, so both hand off to mattstack.app over the need protocol
 * (`ctx.need`) and wait for its answer.
 */

import { join } from "path";
import { HELPERS_DIR, readDepsLock } from "../../bundle-layout.ts";
import { appBundlePath } from "../../deps/resolve.ts";
import { processFlavor } from "../../flavor.ts";
import { markDaemonInstalled } from "../../daemon-config.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { servicePlists } from "../need.ts";
import type { Probes } from "../probes.ts";
import { brewInstalled } from "../fancy-urls.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { needOutcome, toFailedOutcome } from "./step-utils.ts";

async function servicesRegisterRun(ctx: ApplyContext): Promise<StepOutcome> {
  const { plists, deckOmitted } = servicePlists(processFlavor(), ctx.p);
  if (deckOmitted) ctx.log("services.register", "deck not bundled yet, so only the daemon is registered");

  const reply = await ctx.need("services.register", { type: "app-register-services", plists });
  const outcome = needOutcome(reply, ctx, {
    noAppDetail: "mattstack.app is not running; open it to register services",
    noAppRemedy: "Open mattstack.app, then Retry",
    timeoutRemedy: "Retry with mattstack.app running",
  });

  if (outcome.state === "done") markDaemonInstalled(ctx.p.home);
  return outcome;
}

async function servicesRegisterRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await servicesRegisterRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const servicesRegisterStep: StepDef = {
  id: "services.register",
  title: "Register background services",
  kind: "app",
  applies: () => true,
  run: servicesRegisterRunSafe,
};

/** `rt uninstall`'s own signal for "portless is installed" (lib/setup/uninstall.ts's proxy.remove gate) — exported so a from-scratch re-run recognizes an already-installed proxy without re-raising the admin prompt, and so uninstall never redefines it. */
export const PORTLESS_LAUNCHD_PLIST = "/Library/LaunchDaemons/sh.portless.proxy.plist";

/** The CA portless mints into the state dir the root daemon runs against (the console user's own `~/.portless`, per the deck-lane contract). It exists only once that daemon has started. */
export function portlessCaPath(home: string): string {
  return join(home, ".portless", "ca.pem");
}

/**
 * Parity anchor: isCATrustedMacOS in portless's own dist/cli.js, and
 * TrustStep.verifyArgv in the privileged helper. All three must answer "is
 * this CA trusted" the same way or they disagree about a machine none of them
 * changed. `-L` keeps it local, so the answer never depends on the network;
 * `-l` allows a CA as the leaf, which is what a root certificate checked on
 * its own is. portless omits `-l`.
 */
export async function proxyCaIsTrusted(p: Pick<Probes, "home" | "exists" | "exec">): Promise<boolean> {
  const ca = portlessCaPath(p.home);
  if (!p.exists(ca)) return false;
  const res = await p.exec(["security", "verify-cert", "-c", ca, "-L", "-l", "-p", "ssl"], { timeoutMs: 5000 });
  return res.code === 0;
}

/** Written by the privileged helper at install time: the portless version the root copy actually runs. */
export const PROXY_VERSION_PATH = "/Library/Application Support/mattstack/proxy/VERSION";

/** null when the file is absent, unreadable, or blank, which is a state to report, never one to act on. */
export function deployedProxyVersion(p: Pick<Probes, "readFile">): string | null {
  const version = p.readFile(PROXY_VERSION_PATH)?.trim();
  return version === undefined || version === "" ? null : version;
}

/**
 * Whether the proxy on this machine is one mattstack never installed: a
 * `sh.portless.proxy` plist with no VERSION file beside it, which is exactly
 * what deck's own README produces (`portless service install`). Only meaningful
 * once the caller has established that the plist exists.
 *
 * It is a state to act on, not one to report: the install op boots the running
 * daemon out before bootstrapping the replacement, so adopting such a machine
 * costs the same single prompt a first install does.
 */
export const PROXY_INSTALLER_MISSING = "This build has no local proxy installer, so apps serve on their own ports";

/** True for a bundle that ships no privileged proxy helper (a dev build): the app can only refuse the install need, so nothing should offer it. */
export function proxyInstallerMissing(p: Pick<Probes, "exists" | "home">): boolean {
  const bundleRoot = appBundlePath(p);
  return bundleRoot !== null && !p.exists(join(bundleRoot, HELPERS_DIR, "mattstack-proxy-install"));
}

export function proxyPredatesMattstack(p: Pick<Probes, "exists">): boolean {
  return !p.exists(PROXY_VERSION_PATH);
}

/** The portless version this bundle's deps.lock pins, or null when there's no resolvable bundle or no portless row. deps.lock is read off real disk (see bundle-layout.ts), not through the Probes seam. */
export function pinnedPortlessVersion(p: Probes): string | null {
  const root = appBundlePath(p);
  if (!root) return null;
  return readDepsLock(root)?.tools.find((t) => t.name === "portless")?.version ?? null;
}

/**
 * The two versions when they disagree, null when they agree OR when either
 * side cannot be read. A machine nobody can compare must not be prompted:
 * `tool.proxy` already reports that state as an error with the path in it.
 */
export function proxyVersionDrift(p: Probes): { deployed: string; pinned: string } | null {
  const deployed = deployedProxyVersion(p);
  const pinned = pinnedPortlessVersion(p);
  if (deployed === null || pinned === null || deployed === pinned) return null;
  return { deployed, pinned };
}

/**
 * Installed at the pinned version, so the only work the helper can still do
 * here is the certificate. macOS refuses to cache that authorization, so a
 * machine that declined once is untrusted until someone answers a second
 * dialog. It rides its own need, so this never reinstalls a working proxy to
 * fix a keychain entry.
 *
 * An absent CA takes the same route rather than short-circuiting to "already
 * installed": the helper's trust verb is what can say what it found, and the
 * row that offered the remedy would otherwise carry a button that reports
 * success and changes nothing, forever.
 */
async function proxyTrustOnly(ctx: ApplyContext, askBrew: boolean): Promise<StepOutcome> {
  if (await proxyCaIsTrusted(ctx.p)) return askBrew ? await homebrewOnly(ctx) : { state: "done", detail: "Already installed" };

  const reply = await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-trust", ...brewFlag(askBrew) });
  return privilegedOutcome(ctx, askBrew, needOutcome(reply, ctx, {
    noAppDetail: "mattstack.app is not running; open it to trust the local proxy's certificate",
    noAppRemedy: "Open mattstack.app, then Retry",
    timeoutRemedy: "Retry with mattstack.app running",
  }));
}

/**
 * The proxy is in place, so Homebrew is the only work left for the admin
 * prompt. The P1 row offers Allow in exactly this state, so answering
 * "Already installed" here would leave a button that never does anything.
 */
async function homebrewOnly(ctx: ApplyContext): Promise<StepOutcome> {
  if (proxyInstallerMissing(ctx.p)) return { state: "done", detail: "Already installed" };

  const reply = await ctx.need("proxy.install", { type: "app-privileged", op: "homebrew" });
  return privilegedOutcome(ctx, true, needOutcome(reply, ctx, {
    noAppDetail: "mattstack.app is not running; open it to install Homebrew",
    noAppRemedy: "Open mattstack.app, then Retry",
    timeoutRemedy: "Retry with mattstack.app running",
  }));
}

function brewFlag(askBrew: boolean): { homebrew?: true } {
  return askBrew ? { homebrew: true } : {};
}

/**
 * Asked for only while no attempt is on record, so once Homebrew has been
 * tried, neither a P1 Allow nor the bar's run ever pauses on it again.
 */
async function shouldAskForHomebrew(p: Probes): Promise<boolean> {
  return !(await brewInstalled(p)) && readSetupState(p).homebrew === undefined;
}

async function proxyInstallRun(ctx: ApplyContext): Promise<StepOutcome> {
  const askBrew = await shouldAskForHomebrew(ctx.p);
  // Adoption and drift both fall through to the install op below, which IS the
  // update path (the helper boots the running daemon out before bootstrapping
  // the replacement). So either costs the same one prompt an install does, and
  // root reaches a new portless only through it, never by following a bundle
  // on its own.
  if (ctx.p.exists(PORTLESS_LAUNCHD_PLIST)) {
    if (proxyPredatesMattstack(ctx.p)) {
      ctx.log("proxy.install", "adopting: a portless proxy is installed here outside mattstack");
    } else {
      const deployed = deployedProxyVersion(ctx.p);
      // A version nobody can compare must not be prompted: this step cannot
      // tell install from update without it, and tool.proxy already reports
      // that state as an error naming the path.
      if (deployed === null) return { state: "done", detail: `Could not read ${PROXY_VERSION_PATH}` };

      const drift = proxyVersionDrift(ctx.p);
      if (!drift) return await proxyTrustOnly(ctx, askBrew);
      ctx.log("proxy.install", `updating: proxy runs portless ${drift.deployed}, bundle pins ${drift.pinned}`);
    }
  }

  // The app answers this need by running its bundled privileged helper; a
  // bundle without one can only refuse, which used to end the whole Install
  // here. deps.lock no longer carries a "mattstack-proxy-install" row (the
  // helper ships as its own file, not a deps.lock-tracked tool), so the gate
  // checks the file directly instead of going through bundledToolPath, which
  // would now always report a miss.
  if (proxyInstallerMissing(ctx.p)) {
    return { state: "skipped", detail: PROXY_INSTALLER_MISSING };
  }

  const reply = await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-install", ...brewFlag(askBrew) });
  return privilegedOutcome(ctx, askBrew, needOutcome(reply, ctx, {
    noAppDetail: "mattstack.app is not running; open it to install the local proxy",
    noAppRemedy: "Open mattstack.app, then Retry",
    timeoutRemedy: "Retry with mattstack.app running",
  }));
}

function privilegedOutcome(ctx: ApplyContext, askedBrew: boolean, outcome: StepOutcome): StepOutcome {
  const final = withHomebrewOutcome(withTrustOutcome(outcome));
  if (askedBrew) recordHomebrew(ctx.p, final);
  return final;
}

const HOMEBREW_UNREPORTED = "The helper did not report on Homebrew";

function homebrewReport(detail: string | undefined): "ok" | "present" | "failed" | undefined {
  return /^MATTSTACK_HOMEBREW=(ok|present|failed)$/m.exec(detail ?? "")?.[1] as "ok" | "present" | "failed" | undefined;
}

/**
 * Like the certificate, Homebrew reports on its own line: a failed Homebrew
 * still leaves a working proxy, so the step stays done and only says so.
 */
function withHomebrewOutcome(outcome: StepOutcome): StepOutcome {
  if (outcome.state !== "done") return outcome;
  const state = homebrewReport(outcome.detail);
  if (state !== "failed") return outcome;
  const note = `Homebrew did not install (${state})`;
  return { ...outcome, detail: outcome.detail ? `${note}\n${outcome.detail}` : note };
}

/** A prompt that never ran the helper (no app, cancelled) records nothing, so the next Allow asks again. */
function recordHomebrew(p: Probes, outcome: StepOutcome): void {
  const reported = homebrewReport(outcome.detail);
  if (outcome.state !== "done" && reported === undefined) return;
  updateSetupState(p, (s) => ({
    ...s,
    homebrew: { at: p.now().toISOString(), outcome: reported ?? "failed", ...(reported === undefined ? { detail: HOMEBREW_UNREPORTED } : {}) },
  }));
}

/**
 * The helper reports the certificate outcome on its own stdout line, because a
 * declined trust is still a successful install and the exit code cannot carry
 * both. The step therefore stays done and only says so; the tool.proxy row is
 * what carries the remedy.
 */
function withTrustOutcome(outcome: StepOutcome): StepOutcome {
  if (outcome.state !== "done") return outcome;
  const trust = /^MATTSTACK_TRUST=(ok|declined|failed)$/m.exec(outcome.detail ?? "")?.[1];
  if (trust === undefined || trust === "ok") return outcome;
  const note = `The certificate is not trusted yet (${trust}); browsers will warn until it is`;
  return { ...outcome, detail: outcome.detail ? `${note}\n${outcome.detail}` : note };
}

async function proxyInstallRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await proxyInstallRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const proxyInstallStep: StepDef = {
  id: "proxy.install",
  title: "Install the local proxy",
  kind: "privileged",
  applies: () => true,
  run: proxyInstallRunSafe,
};
