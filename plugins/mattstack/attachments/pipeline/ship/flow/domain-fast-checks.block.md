---
node: domain_fast_checks
props:
  rules:
    merge: add
    default: ""
---

# Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files; revert generated
drift they leave. A full suite the domain rules out stays out. A finished
rebase, clean or resolved, sends the checks round again; the "no rebase
finished this pass" guard stops that round rebasing again, so a
force-with-lease push always follows checks on the rewritten tree.

{{props.rules}}
