1. Changed to `Record<Status, string>`.

2. Keeping it sync: nothing loads labels from the API today, and async would ripple through six synchronous callers.
