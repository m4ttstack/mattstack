/** Runs one thing at a time, in the order asked; one that throws never blocks the next. */
export interface Chain {
  run<T>(f: () => Promise<T>): Promise<T>;
}

export function createChain(): Chain {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(f) {
      const result = tail.then(f);
      tail = result.catch(() => {});
      return result;
    },
  };
}
