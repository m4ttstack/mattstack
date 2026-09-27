---
name: rt:mattstack-release
description: Use when a mattstack.app release run fails midway, when release.yml needs rehearsing or debugging outside CI, or when reproducing any single release step by hand (build, sign, notarize, zip/dmg, clean-room, appcast, publish).
---

# mattstack.app Release (by hand)

`.github/workflows/release.yml` in this repo is the sequence of record; this skill is how to run
its steps by hand and the setup and footgun knowledge that lives in no file. **Read the workflow
first, then come here.** Do not trust any prose restatement of the step list, including an older
revision of this skill: step lists copied into prose are exactly what went stale last time.

Division of duties: `rt:release` owns version judgment, docs, `RELEASE_NOTES.md`, the tag push,
verifying the run, and deploying rt.cool. It is current; follow it for a normal release. Its
Publish and finish stage's `upload flake persists` and `assets missing` takes land here on the
`sent by rt:release: its one rerun already ran` edge, which skips the delete and rerun and goes
straight to verify. This skill is the other half: running or debugging the build, sign and publish
pipeline itself. Distribution reality, key material and the footguns are in `reference.md`
beside this file.

`rt release verify` is not agent-safe: it runs on Bash, never through `rt_verb`. Every `gh ...`
command runs on Bash too; no MCP tool covers them. The GitHub repo is `m4ttstack/mattstack`. The
old name `m4ttstack/rt` is never recreated: apps installed before the rename fetch their Sparkle
feed through GitHub's redirect from it, and a new repo there would capture those requests.

## Process

```dot
digraph mattstack_release {
    rankdir=TB;

    "Held: the turn ends naming the gate" [shape=doublecircle];
    "Handed back to Matt" [shape=doublecircle];
    "Trigger: a release run failed or needs rehearsing by hand" [shape=ellipse];
    "Read release.yml, the sequence of record" [shape=box];
    "What does the run need?" [shape=diamond];
    "gh workflow run release.yml --ref <branch>" [shape=plaintext];
    "Watch the dispatch run" [shape=box];
    "Dispatch run result?" [shape=diamond];
    "Rehearsed" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Rehearsal attempts = 3?" [shape=diamond];
    "Diagnose the failing rehearsal step" [shape=box];
    "Run the step with the workflow's env" [shape=box];
    "Step result?" [shape=diamond];
    "Step reproduced" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Step attempts = 3?" [shape=diamond];
    "Diagnose the failing hand step" [shape=box];
    "gh release delete <tag>" [shape=plaintext];
    "gh run rerun <run-id> --failed" [shape=plaintext];
    "rt release verify <tag> --json" [shape=plaintext];
    "Assets complete?" [shape=diamond];
    "STOP: CI creates the release on a tag push; hand-complete the assets instead" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Hand-complete the assets" [shape=box];
    "Gate: upload the hand-completed assets" [shape=box];
    "gh release upload <tag> <files> --clobber" [shape=plaintext];
    "Upload result?" [shape=diamond];
    "Upload attempts = 5?" [shape=diamond];
    "Wait a few minutes before the next upload" [shape=box];
    "Draft published?" [shape=diamond];
    "gh release edit <tag> --draft=false" [shape=plaintext];
    "rt release verify <tag> --json, after the hand completion" [shape=plaintext];
    "Hand completion verified?" [shape=diamond];
    "Completed by hand" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Run every pipeline step with the workflow's env" [shape=box];
    "Pipeline run result?" [shape=diamond];
    "Pipeline attempts = 3?" [shape=diamond];
    "Diagnose the failing pipeline step" [shape=box];
    "Gate: publish the by-hand release" [shape=box];
    "gh release create <tag> out/... --notes-file RELEASE_NOTES.md" [shape=plaintext];
    "rt release verify <tag> --json, after the hand publish" [shape=plaintext];
    "Hand publish verified?" [shape=diamond];
    "Published by hand" [shape=doublecircle style=filled fillcolor=lightgreen];
    "Handed to Matt: second-user smoke or key backup" [shape=doublecircle];
    "Off-script gate: dispatch run wedged" [shape=box];
    "Dispatch run wedged: gate rounds = 2?" [shape=diamond];
    "Fix needs a commit on the branch?" [shape=diamond];
    "Commit the fix on the rehearsal branch" [shape=box];
    "git_push {tree: <root>, setUpstream: true}" [shape=plaintext];
    "Fix push result?" [shape=diamond];
    "Off-script gate: rehearsal fix push refused" [shape=box];
    "Rehearsal fix push refused: gate rounds = 2?" [shape=diamond];
    "Off-script gate: rehearsal keeps failing" [shape=box];
    "Rehearsal keeps failing: gate rounds = 2?" [shape=diamond];
    "Off-script gate: hand step keeps failing" [shape=box];
    "Hand step keeps failing: gate rounds = 2?" [shape=diamond];
    "Off-script gate: asset rerun failed another way" [shape=box];
    "Asset rerun failed another way: gate rounds = 2?" [shape=diamond];
    "Off-script gate: uploads keep failing" [shape=box];
    "Uploads keep failing: gate rounds = 2?" [shape=diamond];
    "Propagation reruns = 4?" [shape=diamond];
    "rt release verify <tag> --json, rerun after the wait" [shape=plaintext];
    "Off-script gate: hand completion does not verify" [shape=box];
    "Hand completion does not verify: gate rounds = 2?" [shape=diamond];
    "Off-script gate: by-hand pipeline keeps failing" [shape=box];
    "By-hand pipeline keeps failing: gate rounds = 2?" [shape=diamond];
    "Publish propagation reruns = 4?" [shape=diamond];
    "rt release verify <tag> --json, rerun after the publish wait" [shape=plaintext];
    "Off-script gate: hand publish does not verify" [shape=box];
    "Hand publish does not verify: gate rounds = 2?" [shape=diamond];

    "Trigger: a release run failed or needs rehearsing by hand" -> "Read release.yml, the sequence of record";
    "Read release.yml, the sequence of record" -> "What does the run need?";
    "What does the run need?" -> "gh workflow run release.yml --ref <branch>" [label="a rehearsal"];
    "What does the run need?" -> "Run the step with the workflow's env" [label="one step by hand"];
    "What does the run need?" -> "gh release delete <tag>" [label="asset uploads failed on a tag"];
    "What does the run need?" -> "rt release verify <tag> --json" [label="sent by rt:release: its one rerun already ran"];
    "What does the run need?" -> "Run every pipeline step with the workflow's env" [label="a fully by-hand pipeline, CI not involved"];
    "What does the run need?" -> "Handed to Matt: second-user smoke or key backup" [label="a Matt-gated step"];
    "gh workflow run release.yml --ref <branch>" -> "Watch the dispatch run";
    "Watch the dispatch run" -> "Dispatch run result?";
    "Dispatch run result?" -> "Rehearsed" [label="green"];
    "Dispatch run result?" -> "Rehearsal attempts = 3?" [label="red"];
    "Off-script gate: dispatch run wedged" -> "Rehearsed" [label="take: Matt reports it finished green"];
    "Off-script gate: dispatch run wedged" -> "Dispatch run wedged: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: dispatch run wedged" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: dispatch run wedged" -> "Handed back to Matt" [label="hand back"];
    "Dispatch run wedged: gate rounds = 2?" -> "gh workflow run release.yml --ref <branch>" [label="no: retry"];
    "Dispatch run wedged: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Dispatch run result?" -> "Off-script gate: dispatch run wedged" [label="still running past 90 minutes"];
    "Rehearsal attempts = 3?" -> "Diagnose the failing rehearsal step" [label="no"];
    "Diagnose the failing rehearsal step" -> "Fix needs a commit on the branch?";
    "Fix needs a commit on the branch?" -> "gh workflow run release.yml --ref <branch>" [label="no: a transient failure"];
    "Fix needs a commit on the branch?" -> "Commit the fix on the rehearsal branch" [label="yes"];
    "Commit the fix on the rehearsal branch" -> "git_push {tree: <root>, setUpstream: true}";
    "git_push {tree: <root>, setUpstream: true}" -> "Fix push result?";
    "Fix push result?" -> "gh workflow run release.yml --ref <branch>" [label="ok"];
    "Off-script gate: rehearsal fix push refused" -> "gh workflow run release.yml --ref <branch>" [label="take: Matt pushed the fix himself"];
    "Off-script gate: rehearsal fix push refused" -> "Rehearsal fix push refused: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: rehearsal fix push refused" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: rehearsal fix push refused" -> "Handed back to Matt" [label="hand back"];
    "Rehearsal fix push refused: gate rounds = 2?" -> "git_push {tree: <root>, setUpstream: true}" [label="no: retry"];
    "Rehearsal fix push refused: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Fix push result?" -> "Off-script gate: rehearsal fix push refused" [label="refused"];
    "Off-script gate: rehearsal keeps failing" -> "Rehearsed" [label="take: Matt names a green run"];
    "Off-script gate: rehearsal keeps failing" -> "Rehearsal keeps failing: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: rehearsal keeps failing" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: rehearsal keeps failing" -> "Handed back to Matt" [label="hand back"];
    "Rehearsal keeps failing: gate rounds = 2?" -> "gh workflow run release.yml --ref <branch>" [label="no: retry"];
    "Rehearsal keeps failing: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Rehearsal attempts = 3?" -> "Off-script gate: rehearsal keeps failing" [label="yes: budget spent"];
    "Run the step with the workflow's env" -> "Step result?";
    "Step result?" -> "Step reproduced" [label="ok"];
    "Step result?" -> "Step attempts = 3?" [label="failed"];
    "Step attempts = 3?" -> "Diagnose the failing hand step" [label="no"];
    "Diagnose the failing hand step" -> "Run the step with the workflow's env";
    "Off-script gate: hand step keeps failing" -> "Step reproduced" [label="take: Matt reproduced it himself"];
    "Off-script gate: hand step keeps failing" -> "Hand step keeps failing: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: hand step keeps failing" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: hand step keeps failing" -> "Handed back to Matt" [label="hand back"];
    "Hand step keeps failing: gate rounds = 2?" -> "Run the step with the workflow's env" [label="no: retry"];
    "Hand step keeps failing: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Step attempts = 3?" -> "Off-script gate: hand step keeps failing" [label="yes: budget spent"];
    "gh release delete <tag>" -> "gh run rerun <run-id> --failed";
    "gh run rerun <run-id> --failed" -> "rt release verify <tag> --json";
    "rt release verify <tag> --json" -> "Assets complete?";
    "Assets complete?" -> "Draft published?" [label="yes"];
    "Assets complete?" -> "Hand-complete the assets" [label="a large asset keeps dying"];
    "Off-script gate: asset rerun failed another way" -> "Draft published?" [label="take: Matt recovered the run by hand"];
    "Off-script gate: asset rerun failed another way" -> "Asset rerun failed another way: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: asset rerun failed another way" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: asset rerun failed another way" -> "Handed back to Matt" [label="hand back"];
    "Asset rerun failed another way: gate rounds = 2?" -> "gh release delete <tag>" [label="no: retry"];
    "Asset rerun failed another way: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Assets complete?" -> "Off-script gate: asset rerun failed another way" [label="the rerun failed another way"];
    "Assets complete?" -> "STOP: CI creates the release on a tag push; hand-complete the assets instead" [label="tempted to create the release on top of the tag push"];
    "STOP: CI creates the release on a tag push; hand-complete the assets instead" -> "Hand-complete the assets";
    "Hand-complete the assets" -> "Gate: upload the hand-completed assets";
    "Gate: upload the hand-completed assets" -> "gh release upload <tag> <files> --clobber" [label="approve"];
    "Gate: upload the hand-completed assets" -> "Held: the turn ends naming the gate" [label="hold"];
    "Gate: upload the hand-completed assets" -> "Handed back to Matt" [label="hand back"];
    "gh release upload <tag> <files> --clobber" -> "Upload result?";
    "Upload result?" -> "Draft published?" [label="ok"];
    "Upload result?" -> "Upload attempts = 5?" [label="500"];
    "Upload attempts = 5?" -> "Wait a few minutes before the next upload" [label="no"];
    "Wait a few minutes before the next upload" -> "gh release upload <tag> <files> --clobber";
    "Off-script gate: uploads keep failing" -> "Draft published?" [label="take: Matt uploaded them himself"];
    "Off-script gate: uploads keep failing" -> "Uploads keep failing: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: uploads keep failing" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: uploads keep failing" -> "Handed back to Matt" [label="hand back"];
    "Uploads keep failing: gate rounds = 2?" -> "gh release upload <tag> <files> --clobber" [label="no: retry"];
    "Uploads keep failing: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Upload attempts = 5?" -> "Off-script gate: uploads keep failing" [label="yes: budget spent"];
    "Draft published?" -> "rt release verify <tag> --json, after the hand completion" [label="yes"];
    "Draft published?" -> "gh release edit <tag> --draft=false" [label="no"];
    "gh release edit <tag> --draft=false" -> "rt release verify <tag> --json, after the hand completion";
    "rt release verify <tag> --json, after the hand completion" -> "Hand completion verified?";
    "Hand completion verified?" -> "Completed by hand" [label="yes"];
    "Hand completion verified?" -> "Propagation reruns = 4?" [label="pending: releases/latest still propagating"];
    "Propagation reruns = 4?" -> "rt release verify <tag> --json, rerun after the wait" [label="no"];
    "rt release verify <tag> --json, rerun after the wait" -> "Hand completion verified?";
    "Propagation reruns = 4?" -> "Off-script gate: hand completion does not verify" [label="yes: budget spent"];
    "Off-script gate: hand completion does not verify" -> "Completed by hand" [label="take: Matt confirms the release is live"];
    "Off-script gate: hand completion does not verify" -> "Hand completion does not verify: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: hand completion does not verify" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: hand completion does not verify" -> "Handed back to Matt" [label="hand back"];
    "Hand completion does not verify: gate rounds = 2?" -> "rt release verify <tag> --json, after the hand completion" [label="no: retry"];
    "Hand completion does not verify: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Hand completion verified?" -> "Off-script gate: hand completion does not verify" [label="no"];
    "Run every pipeline step with the workflow's env" -> "Pipeline run result?";
    "Pipeline run result?" -> "Gate: publish the by-hand release" [label="ok"];
    "Pipeline run result?" -> "Pipeline attempts = 3?" [label="failed"];
    "Pipeline attempts = 3?" -> "Diagnose the failing pipeline step" [label="no"];
    "Diagnose the failing pipeline step" -> "Run every pipeline step with the workflow's env";
    "Off-script gate: by-hand pipeline keeps failing" -> "Gate: publish the by-hand release" [label="take: Matt finished the pipeline himself"];
    "Off-script gate: by-hand pipeline keeps failing" -> "By-hand pipeline keeps failing: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: by-hand pipeline keeps failing" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: by-hand pipeline keeps failing" -> "Handed back to Matt" [label="hand back"];
    "By-hand pipeline keeps failing: gate rounds = 2?" -> "Run every pipeline step with the workflow's env" [label="no: retry"];
    "By-hand pipeline keeps failing: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Pipeline attempts = 3?" -> "Off-script gate: by-hand pipeline keeps failing" [label="yes: budget spent"];
    "Gate: publish the by-hand release" -> "gh release create <tag> out/... --notes-file RELEASE_NOTES.md" [label="approve"];
    "Gate: publish the by-hand release" -> "Held: the turn ends naming the gate" [label="hold"];
    "Gate: publish the by-hand release" -> "Handed back to Matt" [label="hand back"];
    "gh release create <tag> out/... --notes-file RELEASE_NOTES.md" -> "rt release verify <tag> --json, after the hand publish";
    "rt release verify <tag> --json, after the hand publish" -> "Hand publish verified?";
    "Hand publish verified?" -> "Published by hand" [label="yes"];
    "Hand publish verified?" -> "Publish propagation reruns = 4?" [label="pending: releases/latest still propagating"];
    "Publish propagation reruns = 4?" -> "rt release verify <tag> --json, rerun after the publish wait" [label="no"];
    "rt release verify <tag> --json, rerun after the publish wait" -> "Hand publish verified?";
    "Publish propagation reruns = 4?" -> "Off-script gate: hand publish does not verify" [label="yes: budget spent"];
    "Off-script gate: hand publish does not verify" -> "Published by hand" [label="take: Matt confirms the release is live"];
    "Off-script gate: hand publish does not verify" -> "Hand publish does not verify: gate rounds = 2?" [label="iterate: Matt fixed the cause"];
    "Off-script gate: hand publish does not verify" -> "Held: the turn ends naming the gate" [label="hold"];
    "Off-script gate: hand publish does not verify" -> "Handed back to Matt" [label="hand back"];
    "Hand publish does not verify: gate rounds = 2?" -> "rt release verify <tag> --json, after the hand publish" [label="no: retry"];
    "Hand publish does not verify: gate rounds = 2?" -> "Handed back to Matt" [label="yes: budget spent"];
    "Hand publish verified?" -> "Off-script gate: hand publish does not verify" [label="no"];
}
```

The asset-upload branch is v2.9.0's path. GitHub's release-asset endpoint can 500 on large uploads
("other side closed" from CI, "HTTP 500: Error saving asset" from `gh`) while small assets land
fine; v2.9.0 took three runs. Deleting the partial release keeps the TAG, and the failed job
reruns once. Assets from different attempts must never mix: each rebuild re-signs, so attempt N's
appcast and SHA256SUMS do not describe attempt M's binaries. `Assets complete?` reads verify's
asset rows.

`Draft published?` exists because the release is still a DRAFT after an aborted run or a hand
completion. The action publishes last, so an aborted run never flips it, and `gh release view`
renders a draft exactly like a published release while `releases/latest` and the site keep
serving the previous tag. After the flip, verify must see `releases/latest` resolve the new tag;
it reports `pending` for up to about 20 minutes while that endpoint propagates, so wait about five
minutes between propagation reruns.

Counters say what one count is. The attempt counters include the first attempt, and an iterate
answer never resets them. `Rehearsal attempts = 3?` counts every dispatch run in this rehearsal.
`Step attempts = 3?` counts every run of the hand step. `Upload attempts = 5?` counts every upload
of the hand-completed assets. `Pipeline attempts = 3?` counts every by-hand pipeline run.
`Propagation reruns = 4?` counts the verify reruns after the hand completion's first `pending`,
and `Publish propagation reruns = 4?` the same after the hand publish's; each is yes after the
fourth. Each `<origin>: gate rounds = 2?` counts the iterate answers received at that gate: it is
yes once Matt has answered iterate twice.

### Read release.yml, the sequence of record

Read `.github/workflows/release.yml` at the commit in question, not from memory and not from this
skill: its jobs, their order, each step's `env`, and which steps a rehearsal skips. A fully by-hand
pipeline is only for a run CI is deliberately not part of; a failed tag run is the asset-upload
branch, never a by-hand publish.

### Watch the dispatch run

`gh workflow run release.yml` (no inputs) runs the whole pipeline against a synthetic
`v0.0.0-ci<run>` tag and skips only the publish. This pipeline's defects are invisible until the step
before them works, and a tag that fails midway has already re-signed the app, so a release is
rehearsed at the exact commit its tag will point to. After a merge, a PR branch's commit is not
that commit: rehearsing main again before the tag belongs to `rt:release`.

Poll `gh run view <run-id> -R m4ttstack/mattstack --json status,conclusion,jobs` every few
minutes (the run id from `gh run list -R m4ttstack/mattstack --workflow release.yml --limit 1`,
its `headSha` the commit dispatched), never a blocking watch past the tool timeout. The ceiling is
90 minutes: the SPM hang wedges a run silently inside `swift build`, with no output and no failure.

### Diagnose the failing rehearsal step

Read the first failing step of `gh run view <run-id> -R m4ttstack/mattstack --log-failed`. A new
failure after a fix is often progress: the step before it works now. Name the cause and the fix
before the next dispatch; `reference.md`'s footguns hold the causes seen so far.

### Commit the fix on the rehearsal branch

`git add` the files the fix touched by name, never a wildcard, and commit them on the rehearsal
branch, a non-default branch (`git_push` refuses main). The PR that takes the fix to main, and the
rehearsal of main after it merges, belong to `rt:release`.

### Run the step with the workflow's env

Mirror the workflow's env and order. The deltas that matter outside CI:

- **Versions**: `TAG=vX.Y.Z` (what `--define RT_VERSION` gets and what `rt --version` prints),
  `VERSION=X.Y.Z` bare (Info.plist; `build.sh` rejects anything non-numeric).
- **Signing**: locally `build.sh` uses whatever Developer ID Application identity is in your login
  keychain (`security find-identity -v -p codesigning`); CI imports it fresh from the
  `APPLE_CERT_P12_*` secrets.
- **Sparkle is vendored, not resolved.** `swift build` performs **zero SPM network**: the
  xcframework rides `deps.lock` (`sparkle-xcframework` row) and `Package.swift` consumes it as a
  local `.binaryTarget`. If `fetch-deps.sh` hasn't run, the swift build fails naming the missing
  path: run `scripts/fetch-deps.sh arm64`, don't add a remote dep back.
- **Notarization**: `scripts/release/notarize.sh` takes `NOTARY_PROFILE` (local keychain profile
  via `xcrun notarytool store-credentials`) or the three `APPLE_ID`/`APPLE_ID_PASSWORD`/
  `APPLE_TEAM_ID` vars (what CI uses).
- **Clean-room gate**: `scripts/e2e-cleanroom.sh out/mattstack-*.zip` refuses to run on a
  provisioned Mac (exit 3); use the VM harness (`rt-tray/vm/README.md`), the second-user smoke, or
  `--home <throwaway>` after reading the script's guard message.
- **Appcast**: `scripts/release/appcast.sh out "$TAG"` needs `SPARKLE_ED_KEY`; exporting it
  (`rt-tray/deps/tools/sparkle/bin/generate_keys -x /dev/stdout`) prints the production private
  key to your terminal, so treat it like the gh secret.

### Diagnose the failing hand step

Read the step's output, then diff the env you ran with against that step's `env` block in
release.yml and the deltas in `Run the step with the workflow's env`. Check `reference.md`'s
footguns before inventing a new cause, and change one thing per attempt.

### Hand-complete the assets

Use this when a large asset lands and its sibling keeps dying. Complete by hand from whatever CI
DID upload. The dmg and zip wrap the same signed app, but a local re-zip will NOT hash-match CI's
zip (`ditto` is not deterministic across mounts), so a hand-completed release regenerates the
metadata instead:

1. Mount CI's dmg and `make-zip.sh` the app out of it (bit-identical bundle, new container).
2. Regenerate the appcast with the real key: `SPARKLE_ED_KEY` exported from the login keychain via
   `deps/tools/sparkle/bin/generate_keys -x <fresh path>`. The delta step failing is expected:
   Sparkle deltas are impossible while `Contents/Helpers` is signed per-file (the MAT-395 ruling),
   and full downloads are the accepted path.
3. Regenerate SHA256SUMS for all three (dmg, zip, appcast).

### Gate: upload the hand-completed assets

Quote the files to upload, their SHA256SUMS lines, and which assets CI already landed. Approve
uploads them with `--clobber`. Hold resumes at this gate with the files in place. Hand back reports the completed files, not uploaded.

### Wait a few minutes before the next upload

A 500 can need several attempts minutes apart. Re-upload the same files; never rebuild them
between attempts.

### Run every pipeline step with the workflow's env

Run release.yml's steps in its order, each
as in `Run the step with the workflow's env`, up to but not including the publish, leaving the
assets in `out/`.

### Diagnose the failing pipeline step

As in `Diagnose the failing hand step`, for the first step that failed. Rerun from that step
onward when nothing upstream changed; after an upstream change, run from the change.

### Gate: publish the by-hand release

Quote the tag, the assets in
`out/`, SHA256SUMS, and confirm no release.yml run exists for this tag. Approve runs the create
with `--notes-file RELEASE_NOTES.md`. Hold resumes at this gate with `out/` intact. Hand back reports the built assets, unpublished.

### Off-script gate: dispatch run wedged

Quote the run id, the step it sits in, and how long it has run. Take: Matt reports it finished
green. Iterate: Matt fixed the cause (cancelled the run, fixed the hang), and the dispatch runs
again.

### Off-script gate: rehearsal keeps failing

Quote the failing step's log from the third red run and the causes tried. Take: Matt names a green
run. Iterate: Matt fixed the cause, and the dispatch runs again.

### Off-script gate: rehearsal fix push refused

Quote `git_push`'s refusal and the branch it was asked to push. Take: Matt pushed the fix himself,
and the dispatch runs. Iterate: Matt fixed the cause (a branch that tracks the wrong remote, a fix
committed on main instead of a PR branch), and `git_push` runs again.

### Off-script gate: hand step keeps failing

Quote the step, its env, and the third failure's output. Take: Matt reproduced it himself.
Iterate: Matt fixed the cause (a keychain item, a profile, a missing dep), and the step runs again.

### Off-script gate: asset rerun failed another way

Quote verify's rows and the rerun's failing step when it is not the upload 500. Take: Matt
recovered the run by hand, and the graph continues at `Draft published?`. Iterate: Matt fixed the
cause, and the delete and rerun run again.

### Off-script gate: uploads keep failing

Quote the fifth upload's error and the asset it died on. Take: Matt uploaded them himself.
Iterate: Matt fixed the cause (or waited out the endpoint), and the upload runs again.

### Off-script gate: hand completion does not verify

Quote verify's rows (draft state, the asset hashes, what `releases/latest` resolves). Take: Matt
confirms the release is live. Iterate: Matt fixed the cause, and verify runs again.

### Off-script gate: by-hand pipeline keeps failing

Quote the step that failed the third run and its output. Take: Matt finished the pipeline himself,
and the publish gate follows. Iterate: Matt fixed the cause, and the pipeline runs again.

### Off-script gate: hand publish does not verify

Quote verify's rows after the create. Take: Matt confirms the release is live. Iterate: Matt fixed
the cause, and verify runs again.

## How gates ask

Attended, a gate is an AskUserQuestion form in the pane; in a herd, `herd_ask`; in a pipeline run,
`gate_ask`. The first option is the recommendation, and the question quotes what the gate's
section names. Record the answer before acting on it. A gate always puts its question, even when
Matt is away: that is when it matters most, and the agent never picks hold or any other answer
for him.

A hold ends at `Held: the turn ends naming the gate`: name the resume point (the node to re-enter
and what it needs) in the gate answer and the turn's final message, never in a #rt post. Take means
Matt made the move (or ruled it made) and the graph continues past the failed step; the agent never
makes an off-graph move itself. Iterate means Matt fixed the cause and the failed step runs again,
counted by that gate's rounds counter. Hand back ends at `Handed back to Matt`, reporting what
stands unresolved to whoever sent the run.

## Matt-gated

- The guided second-user smoke (`rt-tray/vm/run/second-user.sh`) needs a second real macOS user on
  Matt's Mac; it cannot run unattended.
- Confirming/creating the offline Sparkle private-key backup.
