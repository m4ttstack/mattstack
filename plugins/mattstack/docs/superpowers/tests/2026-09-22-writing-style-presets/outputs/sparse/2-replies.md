1. good call. changed to `Record<Status, string>`.

2. i don't think async buys us anything yet. nothing loads labels from the api, and it'd ripple through six sync callers.
