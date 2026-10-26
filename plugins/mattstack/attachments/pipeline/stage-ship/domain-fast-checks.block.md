---
node: domain_fast_checks
label: Fast checks
props:
  rules:
    merge: add
    default: ""
---

# Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files; revert generated
drift they leave. A full suite the domain rules out stays out. A finished
rebase reruns them, then the push follows: a pass never rebases twice.

{{props.rules}}
