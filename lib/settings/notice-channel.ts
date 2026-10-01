/**
 * A settings share tip is information, so a person at a terminal gets it on
 * stdout, drawn as a tip. Anything else reading stdout (a --json envelope, a
 * pipe, the app) owns that channel, so the tip stays on the library's stderr
 * default there.
 */
export function settingsNoticeChannel(args: string[], stdoutIsTTY: boolean): "stdout" | "stderr" {
  return stdoutIsTTY && !args.includes("--json") ? "stdout" : "stderr";
}

// cli.ts loads this module on every dispatch, so the write path and the
// output layer are imported only on the branch that uses them.
export async function routeSettingsNotices(args: string[]): Promise<void> {
  if (settingsNoticeChannel(args, process.stdout.isTTY === true) !== "stdout") return;
  const [{ setSettingsNoticeSink }, out, { noticeBlocks }] = await Promise.all([import("./write.ts"), import("../ui/out.ts"), import("./notice-blocks.ts")]);
  setSettingsNoticeSink((line, notice) => out.print(...noticeBlocks(notice ?? line)));
}
