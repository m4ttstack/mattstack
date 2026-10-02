/**
 * The rt.ui.background setting, handed to rt-ui's render and steps verbs as
 * RT_UI_BACKGROUND. rt-ui owns the colors; this side only passes the word.
 */
import { getSetting } from "../settings/resolve.ts";
import { warn } from "./warn.ts";

export type BackgroundSetting = "auto" | "dark" | "light";

const WORDS: readonly string[] = ["auto", "dark", "light"];

const readSetting = (): unknown => getSetting<unknown>("rt.ui.background").value;
let read = readSetting;
let cached: BackgroundSetting | undefined;

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

/** The environment rt-ui's render and steps verbs run under. */
export function rtUiEnv(): Record<string, string | undefined> {
  return { ...process.env, RT_UI_BACKGROUND: backgroundSetting() };
}

export const __test__ = {
  reset(): void {
    cached = undefined;
    read = readSetting;
  },
  setRead(fn: () => unknown): void {
    read = fn;
  },
};
