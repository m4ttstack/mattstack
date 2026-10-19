import re, subprocess, sys, pathlib
T = pathlib.Path(__file__).resolve().parent
ROOT = T.parents[5]
ATT = "plugins/mattstack/attachments"
mode = sys.argv[1]  # red: skill text at <ref> (default HEAD); green: the working tree
ref = sys.argv[2] if len(sys.argv) > 2 else "HEAD"

def read(rel):
    if mode == "red":
        return subprocess.run(["git", "-C", str(ROOT), "show", f"{ref}:{rel}"], capture_output=True, text=True, check=True).stdout
    return (ROOT / rel).read_text()

names = {}
for p in (ROOT / ATT).rglob("SKILL.md"):
    m = re.search(r"^name:\s*(\S+)", p.read_text(), re.M)
    if m and "/parts/" not in str(p): names.setdefault(m.group(1), str(p.relative_to(ROOT)))

def body(text):
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)

def inline(text, depth=0):
    def rep(m):
        n = m.group(1)
        return inline(body(read(names[n])), depth + 1) if n in names and depth < 3 else m.group(0)
    return re.sub(r"^\{\{include:([a-z0-9-]+)\}\}$", rep, text, flags=re.M)

SUBS = {
 "red": {"FIX_LIMIT": "3", "FIX_REMAINING": "0", "FIX_EXHAUSTED": "true",
         "WAIT_LIMIT": "4", "WAIT_REMAINING": "0", "WAIT_EXHAUSTED": "true",
         "CAP_LIMIT": "2", "CAP_REMAINING": "0", "CAP_EXHAUSTED": "true"},
 "green": {"FIX_LIMIT": "4", "FIX_REMAINING": "1", "FIX_EXHAUSTED": "false",
           "WAIT_LIMIT": "5", "WAIT_REMAINING": "1", "WAIT_EXHAUSTED": "false",
           "CAP_LIMIT": "3", "CAP_REMAINING": "1", "CAP_EXHAUSTED": "false"},
}
SC = {"ship": ["pipeline/stage-ship"], "watch-ci": ["pipeline/stage-watch-ci"],
      "evidence": ["pipeline/stage-evidence"], "rebase-worktree": ["forge/rebase-worktree"],
      "checkout": ["forge/checkout"], "checkout-hold": ["forge/checkout"]}
for name, skills in SC.items():
    h = (T / "headers" / f"{name}.md").read_text()
    for k, v in SUBS[mode].items(): h = h.replace("{{" + k + "}}", v)
    out = h
    for s in skills:
        out += f"\n---- SKILL: {s.split('/')[-1]} ----\n" + inline(read(f"{ATT}/{s}/SKILL.md"))
    (T / f"{mode}-{name}.md").write_text(out)
    print(mode, name, len(out.split()))
