A fix release for setting up a new Mac. Setup now works on a Mac whose Command Line Tools carry an older git, and the Just me path asks for less.

### Setup

- setup no longer stops at "Couldn't set up your settings folder" on git older than 2.28: the settings folder and team create no longer use `git init -b` (#1049)
- the **Git tools** row reads git older than 2.35 as too old and offers **Update**; when macOS offers no update, **Show steps…** gives the manual reinstall, including on a run that already stopped on it (#1049)
- on Just me, the folder new clones go in shows the one setup found, such as `~/Documents/GitHub`, with **Change**, so **Continue** needs no Finder pick (#1049)
- the setup window's loading screen reads "Getting setup ready…", which fits a first launch (#1049)

### Menu bar app

- apps you turn off, or that Just me turns off, lose their tabs in the mattstack window (#1049)

### Board

- the flock menu loads in the background, so a right-click shows it at once

### Held pins

- glab stays at 1.127.0 (1.128.0 is out) and Sparkle at 2.10.0 (2.10.1 is out); Sparkle gets its own release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.30.0...v2.30.1
