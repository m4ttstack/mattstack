/**
 * rt telemetry open: open the switchboard's version-telemetry page in the
 * default browser, with the view key from rt's personal secrets filled in.
 * The key rides in the URL only; it is never printed.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { createFileActions } from "../lib/file-actions.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { createRealSecretsExecSeam, readSecret } from "../lib/secrets/store.ts";
import * as out from "../lib/ui/out.ts";
import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";

export interface TelemetryOpenDeps {
  readKey: () => Promise<string | null>;
  baseUrl: () => string;
  /** Whether the browser launcher exited 0. */
  open: (url: string) => boolean;
}

export function telemetryPageUrl(base: string, key: string): string {
  return `${base}/telemetry?key=${encodeURIComponent(key)}`;
}

function realDeps(): TelemetryOpenDeps {
  return {
    readKey: () => readSecret("rt", "switchboardTelemetryToken", { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    baseUrl: () => switchboardUrl(),
    open: (url) => createFileActions().open(url),
  };
}

export async function telemetryOpen(_args: string[], _ctx: CommandContext = {}, deps: TelemetryOpenDeps = realDeps()): Promise<void> {
  const key = await deps.readKey();
  if (!key) {
    throw new UserActionableError("telemetry-key-missing", "No telemetry key is stored on this Mac", {}, { next: "rt secrets set rt switchboardTelemetryToken" });
  }
  if (!deps.open(telemetryPageUrl(deps.baseUrl(), key))) {
    throw new UserActionableError("telemetry-open-failed", "rt could not open your browser", {}, { why: "The telemetry page needs the default browser to open it." });
  }
  out.print(out.line("done", "Opened the telemetry page"));
}
