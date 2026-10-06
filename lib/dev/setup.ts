import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { shellQuote } from "../herdr-launch.ts";
import { DEV_APP_PATH, OPEN_DEV_APP, PROD_APP_PATH } from "../release/app-swap.ts";
import { REGISTERED_APPS } from "../release/update-machine.ts";
import { expandHome } from "../setup/repo-root.ts";
import type { ChosenDevRelease, DevSeams, StageEnding, StageRunner } from "./seams.ts";
import { buildRtUi, ensureDevApp, ensureTools, findDevRelease, isMattstackRemote, requireGh, toolchainEnv } from "./stages.ts";
import { readPins } from "./tools.ts";

export type DevSetupResult = { kind: "already"; clone: string } | { kind: "done"; clone: string; stages: StageEnding[] };

const CLONE_URL = "https://github.com/m4ttstack/mattstack.git";
const DEV_DECK = `${DEV_APP_PATH}/Contents/Helpers/deck`;
const SWITCH_WAIT_S = 90;
const DECK_WAIT_S = 60;

function clonePath(s: DevSeams): string {
  const root = s.repoRoot();
  if (!root) {
    throw new UserActionableError("dev-no-repo-root", "This Mac has no repo folder chosen yet", {}, { why: "rt clones mattstack into it.", next: "rt setup repo-root set <folder>" });
  }
  return join(expandHome(s.probes, root), "mattstack");
}

type CloneFolder = "missing" | "empty" | "ours" | "other";

async function cloneFolder(s: DevSeams, dir: string): Promise<CloneFolder> {
  if (!s.probes.exists(dir)) return "missing";
  if (s.probes.readDir(dir).length === 0) return "empty";
  const r = await s.probes.exec(["git", "-C", dir, "remote", "get-url", "origin"], { timeoutMs: 5000 });
  return r.code === 0 && isMattstackRemote(r.stdout) ? "ours" : "other";
}

export async function runDevSetup(s: DevSeams, stage: StageRunner): Promise<DevSetupResult> {
  const p = s.probes;
  const stored = s.storedSourcePath();
  if (s.flavor === "dev" && s.devWrapperOwnsRt() && stored) return { kind: "already", clone: stored };

  const dir = clonePath(s);
  const folder = await cloneFolder(s, dir);
  if (folder === "other") {
    throw new UserActionableError(
      "dev-clone-path-taken",
      "Your repo folder already has a mattstack folder that is not a clone of mattstack",
      { path: dir },
      { why: "Move it aside, then run this again.", next: `mv ${shellQuote(dir)} ${shellQuote(`${dir}-old`)}` },
    );
  }
  const pins = await readPins(p, folder === "ours" ? dir : null);

  const stages: StageEnding[] = [];
  let bunPath = "";
  let goPath = "";
  let chosen: ChosenDevRelease | undefined;

  stages.push(
    await stage("Check your tools", async (io) => {
      const t = await ensureTools(s, pins, io);
      bunPath = t.bunPath;
      goPath = t.goPath;
      return t.ending;
    }),
  );

  stages.push(
    await stage("Check you can push to mattstack", async (io) => {
      const gh = requireGh(s);
      let auth = await p.exec([...gh, "auth", "status"], { timeoutMs: 15_000 });
      if (auth.code !== 0 && s.interactive) {
        auth = await io.pause(async () => {
          if (!(await s.confirm("You're not logged in to GitHub. Log in now?"))) return auth;
          await p.exec([...gh, "auth", "login", "--git-protocol", "https", "--web"], { inherit: true, timeoutMs: 600_000 });
          await p.exec([...gh, "auth", "setup-git"], { timeoutMs: 15_000 });
          return p.exec([...gh, "auth", "status"], { timeoutMs: 15_000 });
        });
      }
      if (auth.code !== 0) {
        throw new UserActionableError("dev-gh-login", "You're not logged in to GitHub", {}, { why: "Pushing your branches needs it.", next: `${gh.join(" ")} auth login` });
      }
      const push = await p.exec([...gh, "api", "repos/m4ttstack/mattstack", "--jq", ".permissions.push"], { timeoutMs: 15_000 });
      const answer = push.stdout.trim();
      if (push.code === 0 && answer === "false") {
        throw new UserActionableError("dev-no-push-access", "You can't push to mattstack yet", {}, { why: "Ask the mattstack maintainers to add you as a collaborator." });
      }
      if (push.code !== 0 || answer !== "true") {
        throw new UserActionableError("dev-access-unreadable", "rt could not check your access to mattstack", {}, { why: "GitHub did not answer.", log: push.stderr || push.stdout, next: "rt dev setup" });
      }
      return { status: "done", title: "You can push to mattstack" };
    }),
  );

  stages.push(
    await stage("Find the dev app", async () => {
      chosen = await findDevRelease(s);
      return { status: "done", title: `Found the dev app ${chosen.release.version}` };
    }),
  );

  stages.push(
    await stage("Clone mattstack", async (io) => {
      if (folder === "ours") return { status: "skipped", title: "Using your clone", hint: dir };
      io.sub(`Cloning into ${dir}`);
      const r = await p.exec(["git", "clone", CLONE_URL, dir], { timeoutMs: 30 * 60_000 });
      if (r.code !== 0) throw new UserActionableError("dev-clone-failed", "Cloning mattstack failed", {}, { log: r.stderr || r.stdout });
      return { status: "done", title: "Cloned mattstack", hint: dir };
    }),
  );

  stages.push(
    await stage("Build your clone", async (io) => {
      io.sub("Installing packages");
      const install = await p.exec([bunPath, "install"], { cwd: dir, env: toolchainEnv(s, { bunPath, goPath }), timeoutMs: 30 * 60_000 });
      if (install.code !== 0) throw new UserActionableError("dev-build-failed", "Installing packages in your clone failed", {}, { log: install.stderr || install.stdout });
      io.sub("Building rt's terminal helper");
      await buildRtUi(s, dir, { bunPath, goPath });
      return { status: "done", title: "Built your clone" };
    }),
  );

  stages.push(
    await stage("Point rt at your clone", async () => {
      if (stored === dir) return { status: "skipped", title: "rt already runs your clone" };
      s.saveSourcePath(dir, bunPath);
      return { status: "done", title: "rt will run your clone", hint: dir };
    }),
  );

  stages.push(await stage("Install the dev app", (io) => ensureDevApp(s, io, "setup", chosen)));

  stages.push(
    await stage("Switch to the dev app", async () => {
      if (s.devWrapperOwnsRt()) return { status: "skipped", title: "The dev app already runs this Mac" };
      const open = await p.exec(OPEN_DEV_APP, { timeoutMs: 30_000 });
      if (open.code !== 0) throw new UserActionableError("dev-switch-failed", "The dev app did not open", {}, { log: open.stderr || open.stdout, next: "rt dev setup" });
      for (let i = 0; i < SWITCH_WAIT_S; i++) {
        if (s.devWrapperOwnsRt()) return { status: "done", title: "Switched to the dev app" };
        await s.swap.sleep(1000);
      }
      throw new UserActionableError(
        "dev-switch-timeout",
        "The dev app did not take over this Mac",
        {},
        { why: "The regular mattstack app may still be running this Mac. Opening it switches you back.", next: `open ${PROD_APP_PATH}` },
      );
    }),
  );

  stages.push(
    await stage("Serve the apps from your clone", async (io) => {
      await registerApps(s, dir, io);
      return { status: "done", title: "The apps run from your clone" };
    }),
  );

  return { kind: "done", clone: dir, stages };
}

/** Shared with `rt dev update`, which re-runs it: a setup that stopped after the switch resumes there, since setup itself now answers "already". Waits for the dev deck first, since the dev app may have just been (re)opened. */
export async function registerApps(s: DevSeams, dir: string, io: { sub(text: string): void }): Promise<void> {
  let answered = false;
  for (let i = 0; i < DECK_WAIT_S && !answered; i++) {
    answered = (await s.probes.exec([DEV_DECK, "list"], { timeoutMs: 10_000 })).code === 0;
    if (!answered) await s.swap.sleep(1000);
  }
  if (!answered) throw new UserActionableError("dev-deck-silent", "The dev app's deck did not answer", {}, { next: "rt dev update" });
  for (const app of REGISTERED_APPS) {
    io.sub(`Registering ${app}`);
    const r = await s.probes.exec([DEV_DECK, "register", "--dir", `${dir}/apps/${app}`], { timeoutMs: 120_000 });
    if (r.code !== 0) throw new UserActionableError("dev-register-failed", `deck could not serve ${app} from your clone`, {}, { log: r.stderr || r.stdout, next: "rt dev update" });
  }
}
