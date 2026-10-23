---
node: print_triage_block
props:
  rules:
    merge: add
    default: ""
---

# Print the triage block

<HARD-GATE>
Print the block before any implementation action: before writing or
editing code, before creating a file, before dispatching an implementer
subagent. Not optional, not internal reasoning, not skippable for
"obvious" work.
</HARD-GATE>

Print verbatim, one tier, plus every line the domain policy defines,
exactly as it specifies:

> APPROACH: trivial -- <one-line reason>
> EVIDENCE: <per the domain policy; "none -- no policy bound" otherwise>

> APPROACH: direct-tdd -- <one-line reason>
> FAILING TEST: <the test you will write first, named>
> EVIDENCE: <as above>

> APPROACH: superpowers -- <one-line reason>
> EVIDENCE: <as above>

On direct-tdd the FAILING TEST line is mandatory: naming the test before
touching code is the point. Record nothing yet: the printed block is the
proposal, and the gate records the decision.

| Thought | Reality |
|---|---|
| "This is an obvious one-line fix, I'll just do it" | Print the block. An obvious fix is `direct-tdd`, not an exemption. |
| "I'll state the approach after I look at the code" | The gate is before code, not after. Print it now. |
| "It's basically trivial" | Only docs, config or a rename are trivial. Behavior change is direct-tdd. |
| "I already know this is a superpowers job" | Say so. The block is how the human and the run verify the triage. |
| "I'll skip the FAILING TEST line, I know what I'll test" | Then writing it costs nothing. Skipping it is how TDD becomes tests-after. |
| "The tier is obvious, I'll record it and move on" | Printing is the proposal. Recording without the gate takes the human's decision. |

{{props.rules}}
