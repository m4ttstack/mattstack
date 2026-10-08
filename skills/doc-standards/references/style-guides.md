# House style digest — Google developer documentation style guide + Microsoft Writing Style Guide

The two de-facto standards for developer docs. They agree on ~90% of rules; where they
differ, this digest picks the Google position (it is the more common default in
docs-as-code and has a maintained Vale package). Source of truth:
https://developers.google.com/style and https://learn.microsoft.com/style-guide.

## Voice and person

- **Second person.** "You" is the reader. Never "the user" in instructions, never "we"
  for actions the reader takes. ("We recommend" is fine for the project's own opinion.)
- **Present tense.** "The command prints" not "the command will print". Future tense
  only for genuinely future events (deprecation dates).
- **Conversational but precise.** Contractions are fine ("don't"). Slang and idioms are
  not — a global audience (and a translator) must parse every sentence literally.

## Words to ban outright

- **simply, just, easy, easily, quickly, obviously, of course** — they insult the reader
  the moment the step fails.
- **please** — instructions are not requests.
- **e.g., i.e., etc., via, vs.** — write "for example", "that is", "and more", "through",
  "versus". Latin abbreviations misread globally.
- **above/below as references** — "as shown above" breaks under reflow and retrieval;
  link to the section instead.
- **leverage, utilize, facilitate, performant** — use, use, help, fast.

## Procedures

- **State the goal before the action.** "To create a project, run:" — the reader decides
  relevance before investing in the step.
- **Numbered list, one action per step.** Sub-results ("The dialog opens.") are separate
  lines inside the step, not steps.
- **Name the exact UI label / command.** Bold for UI elements you click (**Save**), code
  font for anything you type, exact capitalization from the interface.
- **Show expected output** after commands, and state how the reader knows it worked.

## Headings and structure

- **Sentence case** for all headings ("Install the CLI", not "Install The CLI").
- **Task headings start with a verb** (bare infinitive: "Configure the daemon");
  conceptual headings are noun phrases ("Architecture overview").
- **No skipped heading levels** (h2 → h4 is a defect); one h1 per page.
- **Descriptive link text.** The linked words say where the link goes — never
  `click here`, never a bare URL in prose.

## Formatting conventions

- Code font for: commands, filenames, paths, parameter names, values, API elements.
- Placeholders in code: `UPPER_SNAKE` or `<angle-brackets>`, explained on first use.
- Oxford (serial) comma always.
- Numbers: spell out zero through nine in prose, numerals for 10+, always numerals
  with units (5 MB) and in UI/steps.
- Alt text on every image; don't put load-bearing information only in a screenshot.

## Inclusive and bias-free language (both guides, non-negotiable)

- Replace: master/slave → primary/replica; blacklist/whitelist → blocklist/allowlist;
  sanity check → validation check; grandfathered → legacy; guys → everyone.
- Gender-neutral: singular "they", or restructure to "you"/plural.
- Don't ascribe feelings to software ("the parser complains" → "the parser reports
  an error").

## Error messages and API reference (Microsoft's strongest sections)

- Error message formula: **what happened + why + what the reader does next.** Never
  blame the reader; never print an error code without a linkable explanation.
- Every parameter documented with: type, required/optional, default, constraints,
  and one realistic example value. "Obvious" parameters are exactly the ones agents
  and newcomers get wrong.
