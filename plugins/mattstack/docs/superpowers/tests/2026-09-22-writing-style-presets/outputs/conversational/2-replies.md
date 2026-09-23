1. Good call, switched to `Record<Status, string>`.

2. I'd keep it sync for now. Nothing loads labels from the API yet, and going async would ripple through six synchronous callers.
