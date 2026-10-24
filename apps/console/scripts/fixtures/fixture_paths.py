"""Where the console fixtures put the generator's scratch paths.

The scratch pack becomes the design fixture's own pack directory, so a block's
prop files sit inside the pack the history route reads; the rest of the scratch
tree (the copied mattstack plugin) goes under an invented home.
"""

BASE = "acme-base"
BASE_VERSION = "0.1.0"
FIXTURE_PACK = "/fixture/packs/acme"
FIXTURE_ROOT = "/Users/acme/.mattstack-fixture"


def placed(text: str, scratch: str) -> str:
    text = text.replace(f"{scratch}/pack/", f"{FIXTURE_PACK}/").replace(scratch, FIXTURE_ROOT)
    assert scratch not in text, "scratch path left in the payload"
    return text
