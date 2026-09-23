1. good call. changed to `Record<Status, string>`.

2. i'd hold off on async, i think. nothing reads labels from the API today, and it'd ripple through six sync callers. easy to flip when something does.
