1. good call. changed to `Record<Status, string>`.

2. probably not worth it yet. nothing loads labels from the api today, and going async would ripple through six sync callers.
