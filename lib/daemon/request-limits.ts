/**
 * Shared cap on request body size for both daemon servers (api-server.ts's
 * :9401 HTTP/WS surface and socket-server.ts's unix-socket IPC channel).
 * Neither transport authenticates reads, so an unbounded body (Bun's
 * default is 128 MB) lets any same-user process or a cross-origin browser
 * request stall the daemon's single event loop parsing a giant payload.
 * Real payloads on both transports are kilobytes; 1 MiB costs nothing and
 * turns an oversized request into an immediate 413 instead.
 */
export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

/**
 * Gate verbs carry the review context and question text of a whole MR, which
 * has no natural bound; they get a larger cap than every other command.
 */
export const GATE_REQUEST_LIMIT_BYTES = 16 * 1024 * 1024;

const GATE_BODY_COMMANDS = new Set(["gate:open", "gate:ask"]);

export function bodyLimitFor(cmd: string): number {
  return GATE_BODY_COMMANDS.has(cmd) ? GATE_REQUEST_LIMIT_BYTES : MAX_REQUEST_BODY_SIZE;
}

/** Bun enforces one cap per server, so both servers listen at the larger
 *  gate cap and this enforces the per-command cap before the body is parsed. */
export async function readCommandBody(
  req: Request,
  cmd: string,
): Promise<{ payload: any } | { refused: Response }> {
  const limit = bodyLimitFor(cmd);
  const refuse = (): { refused: Response } => ({
    refused: Response.json(
      {
        ok: false,
        error: `request body over the ${Math.round(limit / (1024 * 1024))} MiB limit for ${cmd}`,
      },
      { status: 413 },
    ),
  });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return refuse();
  if (!req.body) return { payload: {} };
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return refuse();
    }
    chunks.push(value);
  }
  try {
    return { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { payload: {} };
  }
}
