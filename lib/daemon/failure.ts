/**
 * Shared code/message derivation for a thrown error reaching a request
 * boundary: the REST layer's own throws in api-app.ts, socket-server.ts's,
 * and createHandleCommand's throw-to-envelope path in daemon.ts.
 */
export function deriveFailure(err: unknown): { code: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : "handler-threw";
  return { code, message };
}
