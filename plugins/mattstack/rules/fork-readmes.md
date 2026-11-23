# Fork READMEs describe only the fork

A fork the team maintains gets a bare README that replaces upstream's. It
says only what the fork changes and links back to upstream for everything
else. Never keep or edit upstream's README alongside it.

Sections, in order:

1. A title naming it the mattstack fork, then one line naming the upstream
   repo and the version it is built on, and what the fork is for.
2. **What's different**: one bullet per change, bold lead-in, one or two
   sentences each.
3. **Installation**: how mattstack installs it, then the by-hand command.
4. The version scheme, `<upstream version>-<fork suffix>.<n>`.
5. **Usage**, only when the fork changes how it is used.
6. **Everything else**: links to upstream's README at the base tag and to
   upstream's latest README.
7. **License**: same as upstream, pointing at `LICENSE`.

Update the README in the same commit as each change to the fork.
