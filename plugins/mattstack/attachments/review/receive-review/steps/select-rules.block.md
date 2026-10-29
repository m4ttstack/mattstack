---
node: select_rules
---

# Select the rules for the change

Rule selector's Select the rules, run once the unresolved threads are in
hand. The diff it gets is the diff range the adjudicator is handed. The
scratch dir it makes is the one every later step that writes a file for
this run reuses. With no selector bound, or `selector: none`, skip it and
go straight to the dispatch. The selection only ever reaches the adjudicator
as reference: this verb asks for no verdict set and runs no later rule step.
A revise reaches this step again before its fresh dispatch: when this run
already made a selection, reuse it and run nothing; when it has none (an
unspent handed plan never passed here), select now.
