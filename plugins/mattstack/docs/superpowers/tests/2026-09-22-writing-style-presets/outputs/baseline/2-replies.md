1. Agreed, changed to `Record<Status, string>` so a typo fails at compile time.

2. I'd rather keep it sync for now. Nothing loads labels from the API today, and making this async would ripple through six synchronous callers for a case we don't have yet. If a remote source shows up we can introduce the async boundary then, with a real caller to shape it.
