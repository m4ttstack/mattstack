import { join } from "path";
import type { LinkOutcome } from "../deps/links.ts";

export type InstallVia = "download" | "vendor" | "apple-clt" | "bundled-link";
export interface InstallResult {
  via: InstallVia;
  ok: boolean;
  detail: string;
  /** Set when this install put the app in place, as opposed to finding it already there; excluded from the JSON envelope. */
  placed?: true;
  /** A setup step's remedy for a failure no retry of the install clears, excluded from the JSON envelope. */
  remedy?: string;
  /** Internal bundled-link classification, excluded from the JSON envelope. */
  reason?: Extract<LinkOutcome, { ok: false }>["reason"];
}

/** Where a vendor script installs `tool`. The board runs Claude Code from this exact path, since launchd's PATH has no claude on it. */
export function vendorBinPath(home: string, tool: string): string {
  return join(home, ".local", "bin", tool);
}
