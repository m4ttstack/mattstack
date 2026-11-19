---
paths:
  - "lib/claude-rules/**"
  - "lib/setup/steps/claude-rules.ts"
  - "lib/daemon/claude-rules-pull-hook.ts"
  - "plugins/mattstack/rules/**"
---

# Shared Claude rules

`reconcileClaudeRules` (`lib/claude-rules/reconcile.ts`) owns
`~/.mattstack/claude/rules/`: a `mattstack` link into the mattstack
marketplace clone's `plugins/mattstack/rules/`, and one `<org>-<pack>`
folder per base pack and the active team's pack, copied from the org's data
branch (never the working tree). Each Claude config dir rt manages, cswap
sessions included, gets a `rules/mattstack` link to it. Three callers run
it: the update-safe `claude.rules` step, the daemon's org-pull hook and
`rt team use`; `rt uninstall` removes only links that point at it.

It is the one update-safe step that recreates what a member removed: the
rules are standard to every install, so a member opts out by putting a real
folder at `rules/mattstack`, which rt did not make and leaves alone. A pack
git cannot read keeps its entry, and a marketplace list caught mid-write
keeps the `mattstack` link.

A file in `plugins/mattstack/rules/` loads in every member's session, in
every repo: plain markdown, a `#` title, no frontmatter, written for any
member (never a person's name or path). The
`no-personal-names-in-shipped-rules` guard checks that, and the plugin
version bumps with it.
