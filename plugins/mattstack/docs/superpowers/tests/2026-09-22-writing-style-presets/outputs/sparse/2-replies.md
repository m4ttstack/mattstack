1. good call. switched it to `Record<Status, string>`.

2. i'd keep it sync for now. nothing loads labels from the API today, and async would ripple through six synchronous callers.
