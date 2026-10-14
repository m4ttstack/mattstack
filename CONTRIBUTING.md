# Contributing to mattstack

Issues and pull requests are welcome at
[github.com/m4ttstack/mattstack](https://github.com/m4ttstack/mattstack).

To work on mattstack day to day, run the dev app: **mattstack-dev.app**. It is
the same menu bar app, but its daemon, `rt` and the served apps (board,
console, chat, boxscore and deck) run from your own clone of this repo, so
your Mac runs the code you are changing.

## Before you start

- You have write access to `m4ttstack/mattstack`. Ask the maintainers to add
  you as a collaborator. You clone this repo directly, not a fork.
- mattstack.app is installed and set up on your Mac. See
  [Install](README.md#install).

## Set up the dev app

Run this in a terminal:

```bash
rt dev setup
```

Each step checks whether it is already done, so if one stops, fix what it
names and run the command again. It:

1. Checks for git, bun and Go, and offers to install any that are missing or
   too old. node is optional; it only warns.
2. Checks that your GitHub login can push to `m4ttstack/mattstack`. If you are
   not logged in, it prints the login command to run.
3. Clones the repo into your repo folder, as `mattstack/`. A clone already
   there is reused as it is.
4. Builds the clone.
5. Points `rt` at your clone.
6. Downloads the dev app from the newest release and installs it in
   Applications.
7. Opens the dev app, which takes this Mac over from mattstack.app.
8. Serves board, console, chat, boxscore and deck from your clone.

To go back to the regular app at any time, open mattstack.app.

## Keep it current

```bash
rt dev update
```

This updates your tools, rebuilds the terminal helper when its source
changed, and installs a newer dev app when a release has one. It never pulls,
rebases or switches branches in your clone: the checkout is yours to manage
like any other repo.

## What you can change

- rt, the served apps, the packages and the skills: the dev app runs them
  from your clone.
- The menu bar app itself (`rt-tray/`) and the dev shim: these need the
  maintainers' signing certificate to build, so the dev app's Rebuild menu
  refuses on your Mac. Open a pull request and a maintainer builds it.

[`docs/development.md`](docs/development.md) has more on how dev mode works.

## Pull requests

CI runs the tests and checks on every pull request. This repo is public, so
use neutral placeholders such as `acme`, `ACME-1234` and `gitlab.example.com`
instead of any real company, customer or internal names that may be associated with your work data.

