import type { Flavor } from "../flavor.ts";
import type { InstallResult } from "../setup/tools-install.ts";
import type { RenderStatus } from "../ui/protocol.ts";
import type { DevAppInstallSeams, DevRelease } from "./dev-app.ts";

export interface StageEnding {
  status: Exclude<RenderStatus, "running">;
  title: string;
  hint?: string;
}

export interface StageIO {
  /** A transient line under the running step. */
  sub(text: string): void;
  /** Takes the step off the screen while `fn` prompts or hands a child the terminal: rt-ui never paints under a prompt. */
  pause<T>(fn: () => Promise<T>): Promise<T>;
}

export type StageRunner = (title: string, task: (io: StageIO) => Promise<StageEnding>) => Promise<StageEnding>;

export type ChosenDevRelease = { release: DevRelease; sha: string };

export interface DevSeams extends DevAppInstallSeams {
  flavor: Flavor;
  /** A person can answer a prompt: a terminal, no --json, no RT_BATCH. */
  interactive: boolean;
  /** The running rt's version, to say when the dev app comes from an older release. */
  prodVersion: string;
  confirm(message: string): Promise<boolean>;
  /** The first rt.repoRoots entry, unexpanded, or null. */
  repoRoot(): string | null;
  storedSourcePath(): string | null;
  saveSourcePath(sourcePath: string, bunPath: string): void;
  installDevTool(tool: "bun" | "go" | "node", version: string): Promise<InstallResult>;
  /** The gh argv to run: the app's copy, else one on PATH; null when neither exists. */
  gh(): string[] | null;
  devWrapperOwnsRt(): boolean;
}

export const DEV_REFUSAL_CODES: ReadonlySet<string> = new Set(["dev-no-push-access", "dev-clone-path-taken", "dev-not-set-up", "dev-gh-login"]);
export const DEV_NEEDS_YOU_CODES: ReadonlySet<string> = new Set(["dev-no-repo-root", "dev-tool-missing", "dev-clone-missing"]);
