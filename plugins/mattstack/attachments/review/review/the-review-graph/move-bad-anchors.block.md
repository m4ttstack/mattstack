---
node: move_bad_anchors
---

# Move the bad-anchor findings into the summary

`badAnchors` names comments by `index`, zero-based in the `comments` sent;
nothing posted. When the json carries drafts, append each to the summary,
preceded by one blank line: its `file:line` alone on a line, then the text
its comment carried, word for word: the `texts` entry at its id, else its
`comment` in the report json, never its `body`. That `file:line` is the one
change the post step makes to text the human saw. With no drafts, move each into the summary's issue
list, its `file:line` in the text. Then call again with the rest
unchanged.
