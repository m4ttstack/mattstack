---
order: 4
---

# The verdict file

Save the verdict set the findings came from as `review-verdicts.json` in
the review scratch dir, always, and under the same name next to the report
json when a report path was handed in. A run with no parseable verdict set,
or with the empty selection, saves `{"verdicts": []}`. With no selection
there is no verdict file.
