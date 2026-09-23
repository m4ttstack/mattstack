1. Good call, switched to `Record<Status, string>`.

2. I'd keep it sync for now. Nothing reads labels from the API today, and going async would ripple through six synchronous callers.
