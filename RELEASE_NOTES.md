A fix release for updating a Mac that is already set up. **Update proxy** no longer fails the first time, and Setup status now opens by itself after an update when something needs you.

### Setup

- **Update proxy** waits for the old proxy to stop before starting the new one, so it no longer fails the first time with "bootstrap failed (5)" and needs a Retry (#1036)
- after an update, the app opens Setup status by itself when a row needs you, once per version (#1037)
- when a file rt did not make sits where an intercept shim goes, such as a Doppler installed by its own installer, the Intercept shims row and `rt intercept status` name the file and give the steps to move it, instead of offering **Re-install shims** (#1038)
- a failed Install press on the tools screen keeps showing **Installing** until setup reads the row again, instead of flashing an error first (#1035)
- an org requirements tool name that is not a plain command now says so, instead of reading as malformed (#1035)

### Console

- a live run's cost updates as it runs, and a Usage step says when its session's transcript is gone (#1030)

### Releasing

- `rt release update-machine` installs the dev app's packages before fetching its dependencies, so the dev app rebuild no longer fails on a fresh clone (#1033)
- `docs/ci.md` suggests a 1500 second `rt.check` timeout, since a full local check takes 11 to 15 minutes (#1034)

### Held pins

- glab stays at 1.127.0 (1.128.0 is out) and Sparkle at 2.10.0 (2.10.1 is out); Sparkle gets its own release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.29.0...v2.29.1
