"""Where the console fixtures put the generator's scratch paths.

The scratch pack becomes the design fixture's own pack directory, so a block's
prop files sit inside the pack the history route reads. The fills the manifest
takes from the org base layer go to the base pack's own folder, outside the
team pack, where rt keeps an org base's fills. The rest of the scratch tree (the
copied mattstack plugin) goes under an invented home.
"""
import json

BASE = "acme-base"
BASE_VERSION = "0.1.0"
FIXTURE_PACK = "/fixture/packs/acme"
FIXTURE_BASE = f"/fixture/orgbase/{BASE}"
FIXTURE_ROOT = "/Users/acme/.mattstack-fixture"


def base_files(scratch: str) -> set[str]:
    """The pack-relative files the manifest's `layered` block takes from the
    org base layer."""
    manifest = json.load(open(f"{scratch}/mattstack-home/repos/my-repo/skills.jsonc"))
    return {
        "attachments/" + entry["value"].split(":", 1)[1] + ".md"
        for props in manifest.get("layered", {}).values()
        for entries in props.values()
        for entry in entries
        if entry["layer"] == f"base:{BASE}"
    }


def placed(text: str, scratch: str) -> str:
    for file in sorted(base_files(scratch)):
        text = text.replace(f"{scratch}/pack/{file}", f"{FIXTURE_BASE}/{file}")
    text = text.replace(f"{scratch}/pack/", f"{FIXTURE_PACK}/").replace(scratch, FIXTURE_ROOT)
    assert scratch not in text, "scratch path left in the payload"
    return text
