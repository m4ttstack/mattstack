"""Turns one `rt skills blocks --json` payload into a committed console fixture.

usage: place-blocks-fixture.py <scratch-pack-dir> <payload.json> <fixture.json>

Rewrites the scratch pack's paths to the fixture's (`fixture_paths.py`), and
completes the org layer when the payload's values use it: the layer entry and the
`lines` row rt emits for a pack that extends a real org base.
"""
import json
import os
import sys

# -I keeps the script's own folder off the path; no cache lands beside it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixture_paths import BASE, placed

scratch, source, dest = sys.argv[1:4]
data = json.loads(placed(open(source).read(), scratch))

org_lines = 0
uses_org = False
for block in data["blocks"]:
    for prop in block["props"]:
        for value in prop["values"]:
            if value["color"] == "org":
                uses_org = True
                org_lines += value["lines"]

label = f"base:{BASE}"
if uses_org and not any(layer["color"] == "org" for layer in data["layers"]):
    data["layers"].insert(1, {"name": BASE, "label": label, "color": "org"})
    rows = data["lines"]
    at = next(i for i, row in enumerate(rows) if row["layer"] == "pack")
    rows.insert(at, {"layer": label, "count": org_lines})

with open(dest, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(dest, os.path.getsize(dest))
