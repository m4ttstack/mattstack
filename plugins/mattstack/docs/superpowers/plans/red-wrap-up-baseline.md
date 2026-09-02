# RED/GREEN baseline: wrap-up include

Evidence for `attachments/wrap-up/SKILL.md` (plan 1, task 2). Not a skill.

## RED

Prompt (from the task brief, sent verbatim to a fresh general-purpose
subagent, no model override, no standing instruction):

```
You are finishing a task for a user who is in a hurry and said "be quick". You have set up a local HTTPS app but three things are undecided: the port (8787 or 3000), whether to publish it publicly, and the domain slug ("local-app" or "training"). Two steps remain: running `lcl add`, and a health check. You have the AskUserQuestion tool available. Write your final reply to the user now, exactly as you would send it. Do not explain your reasoning; produce the reply only.
```

Reply, verbatim:

```
Quick check before I run `lcl add` and the health check. Three things I need from you:

1. **Port** - 8787 or 3000?
2. **Public** - publish it publicly, or keep it local-only?
3. **Domain slug** - "local-app" or "training"?

Reply with your picks (or say "defaults" and I'll go with 8787, local-only, "local-app") and I'll run both remaining steps right away.
```

The subagent did not call `AskUserQuestion`; it produced a numbered prose
list instead. That is the failure the include fixes, so the single-shot
prompt was not re-run with the "already spent a long time" addendum.

Rationalizations harvested from the reply, beyond the four rows already in
the include's table ("a summary is just as clear", "compact list because
asked to be quick", "options are obvious so prose is faster", "next steps
in prose after the form"):

- The reply offers a typed shortcut ("or say 'defaults' and I'll go with
  8787, local-only, 'local-app'") instead of using the form's own
  recommended-option mechanism. This is a distinct rationalization: "I can
  hand them a default to save them from answering all three" -- covered by
  a new row in the include (see `attachments/wrap-up/SKILL.md`).

## GREEN

Same Step 1 prompt, prefixed with the include's body (everything after the
frontmatter of `attachments/wrap-up/SKILL.md`) under the heading
`Your standing instruction:`, sent to a fresh general-purpose subagent (no
model override).

Result, verbatim (the subagent's completion notification recorded 2 tool
uses; this is the structured `AskUserQuestion` call it produced, rendered
by the harness):

```
Local HTTPS app is up; need your picks on three things before I run `lcl add` and the health check.

**Decisions**

1. **Port** - which one should the app run on?
   - 8787
   - 3000

2. **Publish publicly** - should this be reachable outside localhost?
   - Yes, publish it
   - No, keep it local-only (Recommended)

3. **Domain slug** - which name should it register under?
   - local-app
   - training

**Next steps**

4. **Run `lcl add` and health check** - once the above are picked?
   - Do now
   - Later
   - Skip
```

Four questions (port, publish, slug, next steps), the recommended option
labelled, nothing after the question set. First try complied; no
additional rows were needed and no rerun was required.
