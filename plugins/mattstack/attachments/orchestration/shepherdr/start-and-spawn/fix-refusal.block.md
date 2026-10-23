---
node: fix_refusal
---

# Fix what the refusal names

- **An unfilled marker**: the refusal lists the leftover slots; add a `fill` entry for each.
- **A path outside every root**: the loaded skill dir is stale (the plugin updated mid-session) or a dev checkout. Run `/reload-plugins` (in a herdr pane, queue it on yourself with `rt pane send self --text "/reload-plugins" --then "Continue: ..."` and end the turn), then retry from the reloaded base directory.
- **Any other refusal**: correct the input it names and retry.

Never copy the template or the strategies file elsewhere to get past a
refusal; the retry budget hands a stubborn one to the off-script gate.
