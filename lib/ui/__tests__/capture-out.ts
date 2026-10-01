import * as out from "../out.ts";

export interface CapturedOut {
  stdout(): string;
  stderr(): string;
  /** stdout split on newlines, without the trailing empty line. */
  lines(): string[];
  errLines(): string[];
  /** out.__test__.reset(): the gate and humanStream go back to their defaults; set the gate again after it. */
  reset(): void;
  /** Puts the real stream writers back, then reset(). Call it in a finally or afterEach. */
  restore(): void;
}

/**
 * Captures every write to process.stdout and process.stderr until restore().
 * The human gate is the caller's: call out.__test__.setHuman(() => false)
 * after this to read plain text, or set a fake helper to read what it sends.
 */
export function captureOut(): CapturedOut {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const text = (chunk: string | Uint8Array) => (typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  const split = (joined: string) => (joined === "" ? [] : joined.replace(/\n$/, "").split("\n"));
  process.stdout.write = ((chunk: string | Uint8Array) => {
    outChunks.push(text(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errChunks.push(text(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout: () => outChunks.join(""),
    stderr: () => errChunks.join(""),
    lines: () => split(outChunks.join("")),
    errLines: () => split(errChunks.join("")),
    reset: () => out.__test__.reset(),
    restore: () => {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
      out.__test__.reset();
    },
  };
}
