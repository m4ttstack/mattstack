---
node: superpowers_chain
---

# Run the superpowers chain

superpowers:brainstorming, then the spec, then superpowers:writing-plans,
then subagent execution. TDD still holds inside every task. When
dispatching sub-agents, apply the orchestrator's resolved tiering skill if
it announced one.

The brief names each file it passes by its absolute path from this run's
`skills_resolve` map, never by `@key`. A subagent that reads a written
skill itself makes that skill's one `skills_resolve` call.
