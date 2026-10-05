A patch for new and existing team members: team tools behind an intercept (doppler) now pass the setup check from the app, and the intercepts row stops flipping back to a warning. Board peer asks no longer wait forever.

### Setup

- a team tool behind an intercept shim is found in the Homebrew folders when the app's launch PATH has none, so the doppler row no longer blocks Install with "Could not run doppler (exit 1)" (#690)
- the intercept shims row reports out of date only when the rules a newer settings file builds actually changed, not after any settings save (#690)
- a tool whose version rt cannot read says so, instead of calling it older than the minimum (#684)

### Board

- a peer ask that hears nothing for 30 minutes says so, a closed review pane is reported to the asker's board, and a running ask can be dismissed (#677)
- peer review state lives in the board's state database; leftover files are imported once (#677)
- request review sits in a nested submenu, and empty session rows are hidden (#677)

### Output

- RT-369 phase 6: agent verbs, daemon, herd and pane, services, git and skills, and chat commands print through the output layer; wording polished throughout (#681, #682, #683, #684, #686, #687, #689)

### Also

- glitter checks out a stacked branch again, and its refusals paint as a solid band (#676)
- boxscore cards scroll (918621edf)

### Held pins

- portless stays at 0.15.6 (0.15.7 is out); it moves in a later release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.20.0...v2.20.1
