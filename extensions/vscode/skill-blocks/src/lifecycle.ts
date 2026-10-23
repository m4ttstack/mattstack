export interface ServerClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

/** A client whose start failed refuses stop(), so restart must skip it to reach start(). */
export function createLifecycle(create: () => ServerClient, log: (message: string) => void) {
  let client: ServerClient | undefined;

  async function stop(): Promise<void> {
    const old = client;
    client = undefined;
    if (!old?.isRunning()) return;
    try {
      await old.stop();
    } catch (err) {
      log(`stop failed: ${String(err)}`);
    }
  }

  async function start(): Promise<void> {
    client = create();
    try {
      await client.start();
    } catch (err) {
      log(`start failed: ${String(err)}`);
    }
  }

  async function restart(): Promise<void> {
    await stop();
    await start();
  }

  return { start, stop, restart };
}
