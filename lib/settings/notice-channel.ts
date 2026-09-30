/**
 * A settings share tip is information, so a person at a terminal gets it on
 * stdout. Anything else reading stdout (a --json envelope, a pipe, the app)
 * owns that channel, so the tip stays on stderr there.
 */
export function settingsNoticeChannel(args: string[], stdoutIsTTY: boolean): "stdout" | "stderr" {
  return stdoutIsTTY && !args.includes("--json") ? "stdout" : "stderr";
}

export async function routeSettingsNotices(args: string[]): Promise<void> {
  if (settingsNoticeChannel(args, process.stdout.isTTY === true) !== "stdout") return;
  const { setSettingsNoticeSink } = await import("./write.ts");
  setSettingsNoticeSink((line) => console.log(line));
}
