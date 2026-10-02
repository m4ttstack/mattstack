/**
 * The rt.ui.background setting, handed to rt-ui's render and steps verbs as
 * RT_UI_BACKGROUND. rt-ui owns the colors; this side only passes the word.
 */
import { getSetting } from "../settings/resolve.ts";
import { warn } from "./warn.ts";

export type BackgroundSetting = "auto" | "dark" | "light";
type Resolved = "dark" | "light" | "unknown";
type Stream = "stdin" | "stdout" | "stderr";

const WORDS: readonly string[] = ["auto", "dark", "light"];

const readSetting = (): unknown => getSetting<unknown>("rt.ui.background").value;
const realTTY = (stream: Stream): boolean => process[stream].isTTY === true;
let read = readSetting;
let isTTY = realTTY;
let cached: BackgroundSetting | undefined;
let resolved: Resolved | undefined;

/** Read once per process: every print would otherwise reread the stores. */
export function backgroundSetting(): BackgroundSetting {
  if (cached) return cached;
  cached = "auto";
  try {
    const value = read();
    if (typeof value === "string" && WORDS.includes(value)) cached = value as BackgroundSetting;
    else if (value !== undefined) warn("ui", `rt.ui.background is ${JSON.stringify(value)}, not auto, dark or light; using auto`);
  } catch (err) {
    warn("ui", `rt.ui.background could not be read, using auto: ${err instanceof Error ? err.message : String(err)}`);
  }
  return cached;
}

// auto lets the helper ask the terminal, so it goes only where a person is
// at all three streams: with a pager or a picker on the other end, the reply
// would reach that program as keys. The test preload sets
// RT_UI_NO_TERMINAL_QUERY, so no test run asks the terminal it runs in.
function word(): string | undefined {
  const setting = backgroundSetting();
  if (setting !== "auto") return setting;
  if (resolved) return resolved;
  if (process.env.RT_UI_NO_TERMINAL_QUERY) return undefined;
  return (["stdin", "stdout", "stderr"] as const).every(isTTY) ? "auto" : undefined;
}

// Helpers given one run id share one terminal answer, whatever order they
// start in.
let run: string | undefined;

/** The environment rt-ui's render and steps verbs run under. */
export function rtUiEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  const w = word();
  if (w) env.RT_UI_BACKGROUND = w;
  else delete env.RT_UI_BACKGROUND;
  if (w === "auto") env.RT_UI_BACKGROUND_RUN = run ??= crypto.randomUUID();
  else delete env.RT_UI_BACKGROUND_RUN;
  return env;
}

/** Keeps what a render resolved auto to, so later helpers never ask again. */
export function noteBackgroundReport(stderr: string): void {
  const m = /^background=(dark|light|unknown)$/m.exec(stderr);
  if (m) resolved = m[1] as Resolved;
}

export const __test__ = {
  reset(): void {
    cached = undefined;
    resolved = undefined;
    read = readSetting;
    isTTY = realTTY;
  },
  setRead(fn: () => unknown): void {
    read = fn;
  },
  setTTY(fn: (stream: Stream) => boolean): void {
    isTTY = fn;
  },
};
