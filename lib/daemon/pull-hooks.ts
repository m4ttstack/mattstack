/** Runs post-pull hooks one after another; each logs its own failure, and one that throws must not stop the next. */
export function composePullHooks(hooks: ((slug: string) => Promise<void>)[]): (slug: string) => Promise<void> {
  return async (slug) => {
    for (const hook of hooks) {
      try {
        await hook(slug);
      } catch {
        // The hook already logged; the chain only guarantees the next one runs.
      }
    }
  };
}
