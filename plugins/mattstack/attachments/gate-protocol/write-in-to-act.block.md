---
node: write_in_to_act
label: Write-in to act on
---

# A write-in to act on (actOnWriteIn)?

Read `actOnWriteIn` off the tool result: it is the deliberate-pick rule. A
write-in is acted on only when `next` is absent, `proceed` or `iterate`;
any other `next` (`hold`, `go-back`, Abandon) was picked on purpose, and the
site takes it with the write-in as its note. With no tool result, apply the
rule yourself.
