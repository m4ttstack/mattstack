---
node: repro_browser
---

# Self-review repro takes a browser screenshot?

Yes at `repro` depth when EVIDENCE CHECK is `screenshot` and the Criteria
point at a browser target (a `## Browser target` section, in the criteria
or in the file they point at for it) whose What proves a change names a
view for this change, or that has no What proves a change block. Bound
criteria with no browser target answer no: the repro keeps the domain's
own method. With nothing bound, yes when the repro's evidence is a
screenshot of a web page. `read` and `verify` depth answer no.
