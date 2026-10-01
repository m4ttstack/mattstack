import * as out from "../ui/out.ts";
import type { Block } from "../ui/protocol.ts";
import type { SettingsNotice } from "./write.ts";

/**
 * The sentence as a tip, the command as a next; both attach under whatever
 * printed before them in the same call. A bare line (a sink called with one
 * argument) is a tip with no command.
 */
export function noticeBlocks(notice: SettingsNotice | string): Block[] {
  const n = typeof notice === "string" ? { text: notice } : notice;
  return [out.callout("tip", n.text), ...(n.next ? [out.callout("next", out.cmd(n.next))] : [])];
}
