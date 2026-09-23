1. good call. changed to `Record<Status, string>`.

2. i think i'd keep it sync for now. nothing loads labels from the api today, and async would ripple through six sync callers.
