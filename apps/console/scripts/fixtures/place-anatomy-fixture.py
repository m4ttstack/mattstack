"""Turns one `rt skills anatomy --json` payload into a committed console fixture.

usage: place-anatomy-fixture.py <scratch-pack-dir> <payload.json> <fixture.json>

Rewrites the scratch pack's paths to the fixture's (`fixture_paths.py`), so a
block's file and its anatomy source name the same path. A prop source the
manifest's `layered` block takes from the `base:acme-base` layer is tagged as
the org base's, the way rt tags a fill from a real org base pack, so History
names the same layer the blocks payload does.
"""
import json
import os
import sys

# -I keeps the script's own folder off the path; no cache lands beside it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixture_paths import BASE, BASE_VERSION, base_files, placed

scratch, source, dest = sys.argv[1:4]
data = json.loads(placed(open(source).read(), scratch))

base = base_files(scratch)
for part in data["parts"]:
    source_ = part.get("source")
    if part["kind"] != "prop" or not source_:
        continue
    if any(source_["path"].endswith("/" + file) for file in base):
        source_.update(origin="base", base=BASE, baseVersion=BASE_VERSION)

with open(dest, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(dest, os.path.getsize(dest))
