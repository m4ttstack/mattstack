---
node: verify_blocking
---

# Verify each blocking finding against the MR head

Blocking is Critical and Important; Minor is not verified. Check each
blocking finding's facts, never its reasoning:

- **Anchor:** the file exists at the head sha and the cited line is
  non-blank there (`git show <head>:<file>`, head `origin/mr-<iid>` or
  `origin/pr-<n>`), in the diff or not, since a change can break an
  unchanged line. No `file` anchor: check quote and command only.
- **Quote:** quoted code appears at or near that line.
- **Command:** a named command re-runs only in the MR-head checkout; with
  none, skip and note it ("not run at read depth" at `read`). One that
  passes where the finding says it fails is a failed check.

A round leaving a blocking finding unverified charges
`verify-rounds:<depth>`, the depth in force (`read`, `verify`, `repro`).
