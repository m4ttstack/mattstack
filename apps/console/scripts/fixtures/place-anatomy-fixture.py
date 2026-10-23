"""Turns one `rt skills anatomy --json` payload into a committed console fixture.

usage: place-anatomy-fixture.py <scratch-pack-dir> <payload.json> <fixture.json>

Rewrites the scratch pack's path to the root the blocks fixtures use, so a
block's file and its anatomy source name the same path.
"""
import json
import os
import sys

FIXTURE_ROOT = "/Users/acme/.mattstack-fixture"

scratch, source, dest = sys.argv[1:4]
text = open(source).read().replace(scratch, FIXTURE_ROOT)
assert scratch not in text, "scratch path left in the payload"
data = json.loads(text)

with open(dest, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(dest, os.path.getsize(dest))
