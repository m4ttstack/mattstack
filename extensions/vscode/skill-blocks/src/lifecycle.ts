export interface ServerClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

/** A client whose start failed refuses stop(), so restart must skip it to reach start(). */
export function createLifecycle(create: () => ServerClient, log: (message: string) => void) {
  let client: ServerClient | undefined;
  let queue: Promise<void> = Promise.resolve();

  // Serialized because isRunning() reads false while a start is in flight, so an overlapping stop would skip that client and leak it.
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  async function stopNow(): Promise<void> {
    const old = client;
    client = undefined;
    if (!old?.isRunning()) return;
    try {
      await old.stop();
    } catch (err) {
      log(`stop failed: ${String(err)}`);
    }
  }

  async function startNow(): Promise<void> {
    client = create();
    try {
      await client.start();
    } catch (err) {
      log(`start failed: ${String(err)}`);
    }
  }

  return {
    start: () => enqueue(startNow),
    stop: () => enqueue(stopNow),
    restart: () =>
      enqueue(async () => {
        await stopNow();
        await startNow();
      }),
  };
}
