import { existsSync } from "fs";

/**
 * Waits until the daemon at `sockPath` serves. The socket file is not enough:
 * the daemon binds it early in boot and answers "starting" (HTTP 503) until
 * its handlers are ready.
 */
export async function waitForSocket(sockPath: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(sockPath) && (await pingOk(sockPath))) return;
    if (Date.now() > deadline) {
      throw new Error(
        existsSync(sockPath)
          ? `daemon socket at ${sockPath} never started serving`
          : `daemon socket never appeared at ${sockPath}`,
      );
    }
    await Bun.sleep(100);
  }
}

async function pingOk(sockPath: string): Promise<boolean> {
  try {
    const res = await fetch("http://localhost/ping", { unix: sockPath, signal: AbortSignal.timeout(1_000) } as RequestInit);
    return res.status === 200 && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/** The body a daemon that is bound but not serving answers with, or null when nothing answers. */
export async function unavailableReply(sockPath: string): Promise<{ unavailable?: string } | null> {
  try {
    const res = await fetch("http://localhost/ping", { unix: sockPath, signal: AbortSignal.timeout(1_000) } as RequestInit);
    return (await res.json()) as { unavailable?: string };
  } catch {
    return null;
  }
}
