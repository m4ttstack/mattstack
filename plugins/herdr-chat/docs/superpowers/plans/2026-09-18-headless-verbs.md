# herdr-chat Headless Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every herdr-chat feature is reachable as a non-interactive command that
prints one JSON object, so a second front end can drive it without a terminal.

**Architecture:** the decisions already live in pub functions (`peek::rows`,
`quick_send::send`, `broadcast::fan_out`, `sign::run_with`,
`launcher::origin_status`); only the TUI calls them today. This adds a `json`
module holding the wire shapes and one emit helper, then a `--json` path per
subcommand that calls those same functions and prints instead of drawing. No TUI
behaviour changes.

**Tech Stack:** Rust, clap 4 (derive), serde + serde_json 1, ratatui 0.30
(untouched by this plan).

**Spec:** `~/Documents/GitHub/flock/.worktrees/phase-0/docs/superpowers/specs/2026-09-18-flock-chat-design.md`
(the spec lives in the consumer's repo because flock is what it describes; this
plan implements its "The headless surface" section only).

## Global Constraints

- The TUI's behaviour does not change. Any existing test that has to change is a
  behaviour change to explain, not a test to update.
- `--json` never draws, never prompts, and never falls back to the TUI. A
  missing required flag is an error.
- Every verb prints exactly one JSON object on stdout and nothing else.
- Success prints the object. Failure prints `{"error":"<message>"}` and exits
  non-zero. The spec's table lists success shapes; the error envelope is this
  plan's.
- **Every test fixture is a shape rt actually sends.** A fixture is a claim
  about another program, and an invented one makes a test that passes against
  broken code. The real shapes are recorded per task, read from
  `repo-tools/commands/chat.ts` and from `src/rt.rs`'s typed wrappers.
- Field names are the contract with another repo. Every shape whose Rust field
  name differs from its wire name gets a test asserting the serialized string
  verbatim.
- Every subprocess goes through the `Runner` seam. No test spawns a process, and
  none contacts `rt`, `herdr`, or `deck`.
- **Each task adds its wire shape and a compiling stub before its test.** A test
  naming a type that does not exist yet fails to compile, and a compile error is
  not a red: it proves nothing about the rule under test.
- No em dashes or en dashes anywhere, including comments and commit messages.
- Comments state constraints the code cannot show. No narration, and never a
  reference to a task number, review, or plan.
- Commit messages: short, lowercase, imperative. Run `git log --oneline -15`
  for the house voice first.

---

## The rt shapes this plan depends on

Read once, relied on by every task. Each was verified against rt's own source.

| Call | What rt prints |
| --- | --- |
| `rt chat buddies --json` | `{"ok":true,"buddies":[{"handle":"kay","status":"live","sessionId":"s-kay","pane":"w1:p1","rooms":[]}]}` |
| `rt chat rooms --json` (and the per-session form) | `{"ok":true,"rooms":[{"room":"rt","unread":3,"mentions":1,"kind":null}]}` |
| `rt pane list --json` (not a `chat` verb; see `src/rt.rs:181`) | `{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","title":null,"cwd":null,"repo":"flock","branch":"phase-0","agentStatus":"idle","sessionId":"s-kay","presence":{"handle":"kay","status":"live","rooms":[]}}]}` |
| `rt chat sign-in --pane <id> --json` | `{"ok":true,"handle":"kay","room":"rt"}` |
| `rt chat sign-out --pane <id> --json` | `{"ok":true}` |
| a pane send | `{"ok":true,"paneId":"w1:p2","delivered":"accepted"}`, where `delivered` is `accepted`, `queued`, or `refused` |

Two consequences worth stating before anyone writes code:

- **Neither sign reply carries a state or a room list.** `sign-in` says which
  handle it took and which room it joined; `sign-out` says nothing at all. A
  sign verb that wants to report the resulting header has to go and read it.
- **A pane row has no tab id, and its `workspace` is a name, not an id.** The
  spec's `jump` and `peek` shapes were renegotiated to match, and say why.

---

## File Structure

- **Create `src/json.rs`**: every wire shape (`Serialize` only) plus `emit` and
  `fail`. The shapes are declared here rather than derived on `rt.rs` types on
  purpose: `rt.rs` mirrors what rt happens to print today, and this file is a
  promise to another repo. One file so the whole contract is readable at once.
- **Modify `src/main.rs`**: `mod json;`, a `--json` flag on every subcommand,
  three new JSON-only subcommands (`status`, `targets`, `jump`), and dispatch.
- **Modify `src/cmd/launcher.rs`, `sign.rs`, `peek.rs`, `quick_send.rs`,
  `broadcast.rs`, `jump.rs`, `open_viewer.rs`**: one headless entry point each,
  beside the existing `run`/`open`. No existing function changes signature.

Each task's tests live in that task's own file, in the `#[cfg(test)] mod tests`
block already there, using that module's existing `FakeRunner` pattern.

Run one module's tests with `cargo test --lib cmd::peek` (and so on); run
everything with `cargo test`.

---

### Task 1: The JSON module and `status --json`

Status comes first because the sign verbs answer with it, and because it is
where the envelope, the emit helper and the flag shape are established for the
eight tasks after it.

**Files:**
- Create: `src/json.rs`
- Modify: `src/main.rs` (add `mod json;`, add the `Status` subcommand)
- Modify: `src/cmd/launcher.rs` (add `status_json`)

**Interfaces:**
- Consumes: `launcher::origin_status(Option<&str>, &[rt::Buddy]) -> OriginStatus`,
  `launcher::room_tokens(&[rt::Room]) -> Vec<String>`,
  `rt::buddies(&dyn Runner) -> Result<Vec<rt::Buddy>, String>`,
  `rt::rooms_for_session(&dyn Runner, &str) -> Result<Vec<rt::Room>, String>`
- Produces:
  - `json::emit<T: serde::Serialize>(&T) -> Result<(), String>`
  - `json::fail(&str)`
  - `json::Status { handle: Option<String>, state: String, pane: Option<String>, signed_in: bool, rooms: Vec<String> }`, serialized `camelCase`
  - `cmd::launcher::status_json(&dyn Runner, Option<&str>) -> Result<json::Status, String>`

- [ ] **Step 1: Create `src/json.rs` with the shape and a stub, and register the module**

```rust
//! The wire shapes every `--json` verb prints, and the two ways to print.
//!
//! These are declared here rather than derived on `rt.rs`'s types because
//! `rt.rs` mirrors whatever rt prints today, while this file is a promise to
//! another repo: a field renamed here breaks a consumer that cannot be
//! recompiled with this crate.

use serde::Serialize;

/// What a pane is on chat right now. `state` keeps rt's own vocabulary rather
/// than a rendered phrase, so the caller decides how to say it; the one word
/// this adds is "not signed in", which rt has no row for.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub handle: Option<String>,
    pub state: String,
    pub pane: Option<String>,
    pub signed_in: bool,
    pub rooms: Vec<String>,
}

/// Prints `value` as one line on stdout.
pub fn emit<T: Serialize>(value: &T) -> Result<(), String> {
    let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
    println!("{line}");
    Ok(())
}

/// Prints the error envelope. The caller exits non-zero; this only writes it,
/// so a verb's failure is machine-readable on the same stream as its success.
pub fn fail(message: &str) {
    let body = serde_json::json!({ "error": message });
    println!("{body}");
}
```

Add `mod json;` to `src/main.rs`'s module list, beside `mod rt;`.

Then add the stub in `src/cmd/launcher.rs`, so the next step's test compiles:

```rust
pub fn status_json(
    _r: &dyn Runner,
    _pane: Option<&str>,
) -> Result<crate::json::Status, String> {
    Ok(crate::json::Status {
        handle: None,
        state: String::new(),
        pane: None,
        signed_in: false,
        rooms: Vec::new(),
    })
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/json.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// `signedIn` is the one field here whose Rust name differs from its wire
    /// name, and the consumer reads the wire name.
    #[test]
    fn status_serializes_signed_in_as_camel_case() {
        let out = serde_json::to_string(&Status {
            handle: Some("kay".to_string()),
            state: "live".to_string(),
            pane: Some("w1:p1".to_string()),
            signed_in: true,
            rooms: vec!["#rt".to_string()],
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"handle":"kay","state":"live","pane":"w1:p1","signedIn":true,"rooms":["#rt"]}"#
        );
    }

    #[test]
    fn a_missing_handle_is_null_rather_than_absent() {
        let out = serde_json::to_string(&Status {
            handle: None,
            state: "not signed in".to_string(),
            pane: None,
            signed_in: false,
            rooms: Vec::new(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"handle":null,"state":"not signed in","pane":null,"signedIn":false,"rooms":[]}"#
        );
    }
}
```

Append to `src/cmd/launcher.rs`'s `mod tests`. If that module's tests have no
`FakeRunner::sequence`, copy the one in `src/cmd/jump.rs`'s test module
verbatim: it serves canned stdout per call, in order, and counts calls.

```rust
    #[test]
    fn status_json_names_the_pane_identity_and_lists_its_rooms() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"live","sessionId":"s-kay","pane":"w1:p1"}]}"#,
            r#"{"ok":true,"rooms":[{"room":"rt","unread":0},{"room":"dm-1","kind":"dm"}]}"#,
        ]);
        let s = status_json(&r, Some("w1:p1")).unwrap();
        assert_eq!(s.handle.as_deref(), Some("kay"));
        assert_eq!(s.state, "live");
        assert_eq!(s.pane.as_deref(), Some("w1:p1"));
        assert!(s.signed_in);
        assert_eq!(s.rooms, vec!["#rt".to_string(), "dm".to_string()]);
    }

    #[test]
    fn status_json_for_an_unmatched_pane_is_signed_out_with_no_rooms() {
        let r = FakeRunner::sequence(&[r#"{"ok":true,"buddies":[]}"#]);
        let s = status_json(&r, Some("w9:p9")).unwrap();
        assert_eq!(s.handle, None);
        assert_eq!(s.state, "not signed in");
        assert!(!s.signed_in);
        assert!(s.rooms.is_empty());
    }

    /// An offline buddy row still identifies the pane, and must not be read as
    /// signed in: rt keeps the row after a sign-out.
    #[test]
    fn an_offline_buddy_row_is_not_signed_in() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"offline","pane":"w1:p1"}]}"#,
        ]);
        let s = status_json(&r, Some("w1:p1")).unwrap();
        assert_eq!(s.handle.as_deref(), Some("kay"));
        assert!(!s.signed_in);
        assert!(s.rooms.is_empty(), "an offline row has no rooms to list");
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::launcher json`
Expected: the two `json` tests PASS (the shape is already right), and the three
launcher tests FAIL on assertions, the first on
`assert_eq!(s.handle.as_deref(), Some("kay"))` with left `None`.

- [ ] **Step 4: Implement**

Replace the stub in `src/cmd/launcher.rs`:

```rust
/// The popover header's whole content. An offline buddy row still identifies
/// the pane, which is why the handle survives a sign-out while `signed_in`
/// does not.
pub fn status_json(r: &dyn Runner, pane: Option<&str>) -> Result<crate::json::Status, String> {
    let buddies = rt::buddies(r)?;
    let matched = pane.and_then(|p| buddies.iter().find(|b| b.pane.as_deref() == Some(p)));
    let base = origin_status(pane, &buddies);
    let signed_in = base.status.as_deref().is_some_and(|s| s != "offline");
    let rooms = match (signed_in, matched.and_then(|b| b.session_id.as_deref())) {
        (true, Some(session)) => room_tokens(&rt::rooms_for_session(r, session).unwrap_or_default()),
        _ => Vec::new(),
    };
    Ok(crate::json::Status {
        handle: base.handle,
        state: base.status.unwrap_or_else(|| "not signed in".to_string()),
        pane: base.pane,
        signed_in,
        rooms,
    })
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::launcher json`
Expected: PASS.

- [ ] **Step 6: Prove one test can fail**

Change `s != "offline"` to `true`, run `cargo test --lib cmd::launcher`, and
watch `an_offline_buddy_row_is_not_signed_in` go red. Restore it.

- [ ] **Step 7: Wire the subcommand**

In `src/main.rs`'s `Cmd`:

```rust
    /// Print the chat status of a pane. JSON only.
    Status {
        #[arg(long)]
        pane: Option<String>,
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
```

and its arm:

```rust
        Cmd::Status { pane, json: _ } => {
            let pane = pane.or_else(|| std::env::var("HERDR_PANE_ID").ok());
            match cmd::launcher::status_json(&runner, pane.as_deref()).and_then(|s| json::emit(&s)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
```

- [ ] **Step 8: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/launcher.rs
git commit -m "status: a pane's chat identity, without drawing it"
```

---

### Task 2: `sign-in --json` and `sign-out --json`

**Files:**
- Modify: `src/cmd/sign.rs` (add `run_json`)
- Modify: `src/main.rs` (`--json` and `--pane` on `SignIn`/`SignOut`)

**Interfaces:**
- Consumes: `sign::run_with(&dyn Runner, Sign, Option<&str>) -> Result<String, String>`,
  `launcher::status_json(&dyn Runner, Option<&str>) -> Result<json::Status, String>`
- Produces: `cmd::sign::run_json(&dyn Runner, Sign, Option<&str>) -> Result<json::Status, String>`

**Why it returns a status rather than rt's own reply:** rt answers `sign-in`
with `{"ok":true,"handle":"kay","room":"rt"}` and `sign-out` with `{"ok":true}`.
Neither says what the header should now read, and the caller's next question
after signing is always exactly that. Reading the status in the same call costs
one rt round trip and removes a race where the caller reads a header the sign
has not landed in yet.

- [ ] **Step 1: Add the stub**

In `src/cmd/sign.rs`:

```rust
pub fn run_json(
    _runner: &dyn Runner,
    _which: Sign,
    _pane: Option<&str>,
) -> Result<crate::json::Status, String> {
    Ok(crate::json::Status {
        handle: None,
        state: String::new(),
        pane: None,
        signed_in: false,
        rooms: Vec::new(),
    })
}
```

- [ ] **Step 2: Write the failing tests**

This module's `FakeRunner::capture` answers every call with one fixed body,
which cannot serve a sign followed by a status read. Replace it with the
sequence runner from `src/cmd/jump.rs`'s test module, and update the four
existing sign tests to pass their body as a one-element sequence. Those four
still assert the same argv and the same env scrub, so their meaning does not
change.

```rust
    #[test]
    fn sign_in_json_answers_with_the_header_the_pane_now_has() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"handle":"kay","room":"rt"}"#,
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"live","sessionId":"s-kay","pane":"w1:p1"}]}"#,
            r#"{"ok":true,"rooms":[{"room":"rt","unread":0}]}"#,
        ]);
        let s = run_json(&r, Sign::In, Some("w1:p1")).unwrap();
        assert_eq!(s.handle.as_deref(), Some("kay"));
        assert!(s.signed_in);
        assert_eq!(s.rooms, vec!["#rt".to_string()]);
    }

    /// rt answers a sign-out with a bare `{"ok":true}`. Reading the header
    /// afterwards is the only way to report the state that leaves behind.
    #[test]
    fn sign_out_json_answers_with_the_signed_out_header() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true}"#,
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"offline","pane":"w1:p1"}]}"#,
        ]);
        let s = run_json(&r, Sign::Out, Some("w1:p1")).unwrap();
        assert!(!s.signed_in);
        assert!(s.rooms.is_empty());
    }

    #[test]
    fn sign_json_without_a_pane_is_an_error_not_a_prompt() {
        let r = FakeRunner::sequence(&[]);
        assert!(run_json(&r, Sign::In, None).is_err());
    }

    /// The sign has to happen before the header is read, or the header
    /// describes the state the call was meant to change.
    #[test]
    fn the_sign_runs_before_the_status_read() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"handle":"kay","room":"rt"}"#,
            r#"{"ok":true,"buddies":[]}"#,
        ]);
        run_json(&r, Sign::In, Some("w1:p1")).unwrap();
        let first = r.argv_at(0);
        assert_eq!(first[1..4], ["chat", "sign-in", "--pane"]);
    }
```

`argv_at(n)` returns the nth recorded argv; add it to the sequence runner
beside `call_count` if it is not already there, recording each `argv` the way
`src/cmd/sign.rs`'s current `Call` struct does.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::sign`
Expected: FAIL on `assert_eq!(s.handle.as_deref(), Some("kay"))`, left `None`.

- [ ] **Step 4: Implement**

```rust
/// Signs, then reports the header that sign produced. rt's own sign replies
/// carry no state (`sign-in` names a handle and a room, `sign-out` says
/// nothing), so the state comes from reading the roster afterwards.
pub fn run_json(
    runner: &dyn Runner,
    which: Sign,
    pane: Option<&str>,
) -> Result<crate::json::Status, String> {
    let pane = pane.ok_or_else(|| "pane is required".to_string())?;
    run_with(runner, which, Some(pane))?;
    crate::cmd::launcher::status_json(runner, Some(pane))
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::sign`
Expected: PASS, including the four original sign tests.

- [ ] **Step 6: Wire the flags**

```rust
    /// Sign in to chat.
    SignIn {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pane: Option<String>,
    },
    /// Sign out of chat.
    SignOut {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pane: Option<String>,
    },
```

```rust
        Cmd::SignIn { json, pane } => sign_dispatch(&runner, cmd::sign::Sign::In, json, pane),
        Cmd::SignOut { json, pane } => sign_dispatch(&runner, cmd::sign::Sign::Out, json, pane),
```

with this helper above `main`:

```rust
/// `--pane` wins over the environment: a caller outside herdr has no
/// `HERDR_PANE_ID` to inherit, and a caller inside one may mean a pane other
/// than the one it happens to be running in.
fn sign_dispatch(
    runner: &run::RealRunner,
    which: cmd::sign::Sign,
    json: bool,
    pane: Option<String>,
) -> std::process::ExitCode {
    let pane = pane.or_else(|| std::env::var("HERDR_PANE_ID").ok());
    if !json {
        return match cmd::sign::run_with(runner, which, pane.as_deref()) {
            Ok(_) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("sign: {e}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    match cmd::sign::run_json(runner, which, pane.as_deref()).and_then(|s| json::emit(&s)) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            json::fail(&e);
            std::process::ExitCode::FAILURE
        }
    }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/main.rs src/cmd/sign.rs
git commit -m "sign: answer with the header the pane now has"
```

---

### Task 3: `peek --json`

**Files:**
- Modify: `src/json.rs` (add `Peek`, `PeekBuddy`, `PeekRoom`, `peek_from_rows`)
- Modify: `src/cmd/peek.rs` (add `rows_json`)
- Modify: `src/main.rs` (`--json` on `Peek`)

**Interfaces:**
- Consumes: `peek::rows(Vec<rt::Buddy>, Vec<rt::Room>, &HashMap<String, rt::AgentDetail>) -> Vec<Row>`
  where `Row { kind, handle, status, repo, branch, title, room, unread, mentions }`,
  and `rt::pane_list` for the pane id each buddy is signed in on
- Produces:
  - `json::PeekBuddy { handle: String, pane_id: Option<String>, status: String, repo: Option<String>, branch: Option<String>, title: Option<String>, unread: u32, mentions: u32 }`, serialized `camelCase`
  - `json::PeekRoom { room: String, unread: u32, mentions: u32 }`
  - `json::Peek { buddies: Vec<PeekBuddy>, rooms: Vec<PeekRoom> }`
  - `json::peek_from_rows(&[peek::Row], &[rt::ChatPane]) -> Peek`
  - `cmd::peek::rows_json(&dyn Runner) -> Result<json::Peek, String>`

**Why a `paneId` and no workspace or tab id:** a buddy row is only useful if the
caller can go to that agent, and rt's pane roster gives a pane id and a
workspace *name*, with nothing about tabs. flock renders the whole layout, so it
maps a pane id to its workspace and tab from the model it already holds. The
spec's table was amended to match, with the reason recorded there.

- [ ] **Step 1: Add the shapes and a stub**

In `src/json.rs`:

```rust
/// A buddy row as a consumer reads it. The identity is required, because a row
/// that cannot name who it is about is not a row anyone can act on; the pane id
/// is not, because a buddy can be signed in with no pane in the roster.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeekBuddy {
    pub handle: String,
    pub pane_id: Option<String>,
    pub status: String,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
    pub unread: u32,
    pub mentions: u32,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PeekRoom {
    pub room: String,
    pub unread: u32,
    pub mentions: u32,
}

/// Two lists rather than the TUI's one flat list: a drawing surface wants them
/// interleaved by attention, and a caller that renders its own sections wants
/// them apart. Order within each list is `rows`' own ordering, preserved.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Peek {
    pub buddies: Vec<PeekBuddy>,
    pub rooms: Vec<PeekRoom>,
}

pub fn peek_from_rows(
    _rows: &[crate::cmd::peek::Row],
    _panes: &[crate::rt::ChatPane],
) -> Peek {
    Peek { buddies: Vec::new(), rooms: Vec::new() }
}
```

`RowKind` needs `Clone, Copy` if it does not already derive them; add them to
its existing derive list.

- [ ] **Step 2: Write the failing tests**

Append to `src/json.rs`'s `mod tests`:

```rust
    #[test]
    fn peek_buddy_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&PeekBuddy {
            handle: "kay".to_string(),
            pane_id: Some("w1:p1".to_string()),
            status: "live".to_string(),
            repo: None,
            branch: None,
            title: None,
            unread: 0,
            mentions: 0,
        })
        .unwrap();
        assert!(out.contains(r#""paneId":"w1:p1""#), "got {out}");
    }
```

Append to `src/cmd/peek.rs`'s `mod tests`:

```rust
    fn buddy_row(handle: &str) -> Row {
        Row {
            kind: RowKind::Buddy,
            handle: Some(handle.to_string()),
            status: Some("live".to_string()),
            repo: Some("flock".to_string()),
            branch: Some("phase-0".to_string()),
            title: None,
            room: None,
            unread: 0,
            mentions: 0,
        }
    }

    #[test]
    fn rows_json_splits_the_flat_row_list_into_buddies_and_rooms() {
        let rows = vec![
            Row {
                kind: RowKind::Room,
                handle: None,
                status: None,
                repo: None,
                branch: None,
                title: None,
                room: Some("rt".to_string()),
                unread: 3,
                mentions: 1,
            },
            buddy_row("kay"),
        ];
        let out = crate::json::peek_from_rows(&rows, &[]);
        assert_eq!(out.rooms.len(), 1);
        assert_eq!(out.rooms[0].room, "rt");
        assert_eq!(out.rooms[0].unread, 3);
        assert_eq!(out.buddies.len(), 1);
        assert_eq!(out.buddies[0].handle, "kay");
        assert_eq!(out.buddies[0].branch.as_deref(), Some("phase-0"));
    }

    /// A buddy row cannot be jumped to without the pane it is signed in on,
    /// and the row itself does not carry one: it comes from the roster.
    #[test]
    fn a_buddy_carries_the_pane_it_is_signed_in_on() {
        let panes = vec![rt::ChatPane {
            pane_id: "w1:p1".to_string(),
            workspace: "flock".to_string(),
            title: None,
            cwd: None,
            repo: None,
            branch: None,
            agent_status: "idle".to_string(),
            session_id: None,
            presence: Some(rt::Presence {
                handle: "kay".to_string(),
                status: "live".to_string(),
                rooms: Vec::new(),
            }),
        }];
        let out = crate::json::peek_from_rows(&[buddy_row("kay")], &panes);
        assert_eq!(out.buddies[0].pane_id.as_deref(), Some("w1:p1"));
    }

    #[test]
    fn a_buddy_on_no_pane_is_still_listed_with_no_pane_id() {
        let out = crate::json::peek_from_rows(&[buddy_row("ghost")], &[]);
        assert_eq!(out.buddies.len(), 1);
        assert_eq!(out.buddies[0].pane_id, None);
    }

    #[test]
    fn a_row_missing_its_identity_field_is_dropped_rather_than_named_empty() {
        let rows = vec![Row {
            kind: RowKind::Buddy,
            handle: None,
            status: None,
            repo: None,
            branch: None,
            title: None,
            room: None,
            unread: 0,
            mentions: 0,
        }];
        let out = crate::json::peek_from_rows(&rows, &[]);
        assert!(out.buddies.is_empty());
        assert!(out.rooms.is_empty());
    }
```

`rt::ChatPane` and `rt::Presence` need `pub` fields (they already are) and may
need a `Clone`/construction path; they are plain structs, so building one
literally as above works as long as every field is listed.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::peek json`
Expected: FAIL on `assert_eq!(out.rooms.len(), 1)`, left `0`.

- [ ] **Step 4: Implement the mapping**

```rust
pub fn peek_from_rows(
    rows: &[crate::cmd::peek::Row],
    panes: &[crate::rt::ChatPane],
) -> Peek {
    let pane_for = |handle: &str| -> Option<String> {
        panes
            .iter()
            .find(|p| p.presence.as_ref().is_some_and(|pr| pr.handle == handle))
            .map(|p| p.pane_id.clone())
    };
    let mut buddies = Vec::new();
    let mut rooms = Vec::new();
    for row in rows {
        match row.kind {
            crate::cmd::peek::RowKind::Buddy => {
                if let Some(handle) = row.handle.clone() {
                    let pane_id = pane_for(&handle);
                    buddies.push(PeekBuddy {
                        handle,
                        pane_id,
                        status: row.status.clone().unwrap_or_else(|| "unknown".to_string()),
                        repo: row.repo.clone(),
                        branch: row.branch.clone(),
                        title: row.title.clone(),
                        unread: row.unread,
                        mentions: row.mentions,
                    });
                }
            }
            crate::cmd::peek::RowKind::Room => {
                if let Some(room) = row.room.clone() {
                    rooms.push(PeekRoom { room, unread: row.unread, mentions: row.mentions });
                }
            }
        }
    }
    Peek { buddies, rooms }
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::peek json`
Expected: PASS.

- [ ] **Step 6: Add the runner-level entry point**

In `src/cmd/peek.rs`:

```rust
/// The same rows the TUI draws, as data. Gathers exactly what `run` gathers,
/// so the two front ends cannot disagree about what is unread.
pub fn rows_json(r: &dyn Runner) -> Result<crate::json::Peek, String> {
    let buddies = rt::buddies(r).unwrap_or_default();
    let rooms = rt::rooms(r).unwrap_or_default();
    let panes = rt::pane_list(r).unwrap_or_default();
    let details = rt::agent_details(&panes);
    let rows = rows(buddies, rooms, &details);
    Ok(crate::json::peek_from_rows(&rows, &panes))
}
```

The `unwrap_or_default` calls match `run`'s at `src/cmd/peek.rs:149`, so an rt
that answers nothing gives an empty peek rather than an error, exactly as the
TUI already behaves.

- [ ] **Step 7: Wire the flag**

Add `#[arg(long)] json: bool` to the `Peek` variant, and in its arm, first:

```rust
            if json {
                return match cmd::peek::rows_json(&runner).and_then(|p| json::emit(&p)) {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 8: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/peek.rs
git commit -m "peek: the rows as data, each buddy with its pane"
```

---

### Task 4: `targets --json`

**Files:**
- Modify: `src/json.rs` (add `Targets`, `targets_from`, `parse_target`)
- Modify: `src/cmd/quick_send.rs` (add `targets_json`, make `Target` pub)
- Modify: `src/main.rs` (add the `Targets` subcommand)

**Interfaces:**
- Consumes: `quick_send::targets(Vec<rt::Room>, Vec<rt::Buddy>, &HashMap<String, rt::AgentDetail>) -> Vec<TargetRow>`,
  whose target field is named `target`
- Produces:
  - `json::Targets { rooms: Vec<String>, people: Vec<String> }`
  - `json::targets_from(&[quick_send::Target]) -> Targets`
  - `json::parse_target(&str) -> Option<quick_send::Target>`
  - `cmd::quick_send::targets_json(&dyn Runner) -> Result<json::Targets, String>`

- [ ] **Step 1: Add the shape and stubs**

In `src/json.rs`:

```rust
/// What a caller may send to. The prefixes are the wire form: `#room` and
/// `@handle` are one namespace a caller passes straight back as `--to`, where
/// a bare name would be ambiguous between a room and a person.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Targets {
    pub rooms: Vec<String>,
    pub people: Vec<String>,
}

pub fn targets_from(_targets: &[crate::cmd::quick_send::Target]) -> Targets {
    Targets { rooms: Vec::new(), people: Vec::new() }
}

pub fn parse_target(_s: &str) -> Option<crate::cmd::quick_send::Target> {
    None
}
```

In `src/cmd/quick_send.rs`, make `Target` public and give it the derives these
tests need: `#[derive(Debug, Clone, PartialEq, Eq)] pub enum Target`.

- [ ] **Step 2: Write the failing tests**

Append to `src/cmd/quick_send.rs`'s `mod tests`:

```rust
    #[test]
    fn targets_json_lists_rooms_with_their_hash_and_people_with_their_at() {
        let t = crate::json::targets_from(&[
            Target::Room("rt".to_string()),
            Target::Dm("scout".to_string()),
        ]);
        assert_eq!(t.rooms, vec!["#rt".to_string()]);
        assert_eq!(t.people, vec!["@scout".to_string()]);
    }

    #[test]
    fn a_target_string_round_trips_back_to_the_target_it_names() {
        assert_eq!(
            crate::json::parse_target("#rt"),
            Some(Target::Room("rt".to_string()))
        );
        assert_eq!(
            crate::json::parse_target("@scout"),
            Some(Target::Dm("scout".to_string()))
        );
    }

    /// The caller was handed prefixed names and is expected to return one. A
    /// bare name is refused rather than guessed, because guessing picks
    /// between a room and a person with no way to be sure.
    #[test]
    fn an_unprefixed_or_empty_target_is_refused() {
        assert_eq!(crate::json::parse_target("rt"), None);
        assert_eq!(crate::json::parse_target("#"), None);
        assert_eq!(crate::json::parse_target("@"), None);
        assert_eq!(crate::json::parse_target(""), None);
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::quick_send`
Expected: FAIL on `assert_eq!(t.rooms, vec!["#rt".to_string()])`, left `[]`.

- [ ] **Step 4: Implement**

```rust
pub fn targets_from(targets: &[crate::cmd::quick_send::Target]) -> Targets {
    let mut rooms = Vec::new();
    let mut people = Vec::new();
    for t in targets {
        match t {
            crate::cmd::quick_send::Target::Room(r) => rooms.push(format!("#{r}")),
            crate::cmd::quick_send::Target::Dm(h) => people.push(format!("@{h}")),
        }
    }
    Targets { rooms, people }
}

/// The inverse of [`targets_from`]'s prefixes.
pub fn parse_target(s: &str) -> Option<crate::cmd::quick_send::Target> {
    let rest = &s.get(1..)?;
    if rest.is_empty() {
        return None;
    }
    match s.as_bytes().first()? {
        b'#' => Some(crate::cmd::quick_send::Target::Room(rest.to_string())),
        b'@' => Some(crate::cmd::quick_send::Target::Dm(rest.to_string())),
        _ => None,
    }
}
```

And in `src/cmd/quick_send.rs`:

```rust
/// The same list the TUI picks from, flattened to the two prefixed namespaces.
/// Gathers what `run` gathers, so a target offered here is one the TUI would
/// have offered too.
pub fn targets_json(r: &dyn Runner) -> Result<crate::json::Targets, String> {
    let rooms = rt::rooms(r).unwrap_or_default();
    let buddies = rt::buddies(r).unwrap_or_default();
    let panes = rt::pane_list(r).unwrap_or_default();
    let details = rt::agent_details(&panes);
    let targets: Vec<Target> = targets(rooms, buddies, &details)
        .into_iter()
        .map(|row| row.target)
        .collect();
    Ok(crate::json::targets_from(&targets))
}
```

`targets` and `TargetRow` stay private: this function is in their module.

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::quick_send json`
Expected: PASS.

- [ ] **Step 6: Wire the subcommand**

```rust
    /// Print what quick-send can send to. JSON only.
    Targets {
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
```

```rust
        Cmd::Targets { json: _ } => {
            match cmd::quick_send::targets_json(&runner).and_then(|t| json::emit(&t)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
```

- [ ] **Step 7: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/quick_send.rs
git commit -m "targets: rooms and people in one prefixed namespace"
```

---

### Task 5: `quick-send --json`

**Files:**
- Modify: `src/json.rs` (add `Sent`)
- Modify: `src/cmd/quick_send.rs` (add `send_json`)
- Modify: `src/main.rs` (`--json`, `--to`, `--body` on `QuickSend`)

**Interfaces:**
- Consumes: `quick_send::send(&dyn Runner, Target, &str) -> Result<(), String>`, `json::parse_target`
- Produces:
  - `json::Sent { ok: bool, to: String }`
  - `cmd::quick_send::send_json(&dyn Runner, &str, &str) -> Result<json::Sent, String>`

- [ ] **Step 1: Add the shape and stub**

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Sent {
    pub ok: bool,
    pub to: String,
}
```

```rust
pub fn send_json(_r: &dyn Runner, _to: &str, _body: &str) -> Result<crate::json::Sent, String> {
    Ok(crate::json::Sent { ok: false, to: String::new() })
}
```

- [ ] **Step 2: Write the failing tests**

This module's test runner is `FakeRunner::capture`, which answers every call
with one fixed body and counts nothing. Replace it with the sequence runner from
`src/cmd/jump.rs`'s test module, which serves canned stdout per call in order
and exposes `call_count`, and pass each existing test's body as a one-element
sequence so its meaning does not change.

```rust
    #[test]
    fn send_json_posts_to_the_room_it_was_given_and_echoes_the_target() {
        let r = FakeRunner::sequence(&[r#"{"ok":true}"#]);
        let out = send_json(&r, "#rt", "schema v5 is mine").unwrap();
        assert!(out.ok);
        assert_eq!(out.to, "#rt");
    }

    #[test]
    fn an_unprefixed_target_is_refused_rather_than_guessed() {
        let r = FakeRunner::sequence(&[]);
        assert!(send_json(&r, "rt", "hello").is_err());
    }

    /// rt would accept an empty line, and an empty line in a room is noise
    /// nobody meant to make.
    #[test]
    fn an_empty_body_is_refused_before_anything_is_sent() {
        let r = FakeRunner::sequence(&[]);
        assert!(send_json(&r, "#rt", "   ").is_err());
        assert_eq!(r.call_count(), 0, "nothing may be sent for an empty body");
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::quick_send`
Expected: FAIL on `assert!(out.ok)`.

- [ ] **Step 4: Implement**

```rust
/// Sends `body` to the prefixed `to`. Both guards run before the send, so a
/// refused call has changed nothing.
pub fn send_json(r: &dyn Runner, to: &str, body: &str) -> Result<crate::json::Sent, String> {
    if body.trim().is_empty() {
        return Err("body is required".to_string());
    }
    let target = crate::json::parse_target(to)
        .ok_or_else(|| format!("target must be #room or @handle, got {to:?}"))?;
    send(r, target, body)?;
    Ok(crate::json::Sent { ok: true, to: to.to_string() })
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::quick_send`
Expected: PASS.

- [ ] **Step 6: Wire the flags**

```rust
    QuickSend {
        #[arg(long)]
        pane: bool,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        body: Option<String>,
    },
```

In its arm, first:

```rust
            if json {
                return match to
                    .zip(body)
                    .ok_or_else(|| "--to and --body are required with --json".to_string())
                    .and_then(|(to, body)| cmd::quick_send::send_json(&runner, &to, &body))
                    .and_then(|s| json::emit(&s))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 7: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/quick_send.rs
git commit -m "quick-send: one line to a named target, no picker"
```

---

### Task 6: `broadcast --json`

**Files:**
- Modify: `src/json.rs` (add `Broadcast`, `BroadcastResult`, `broadcast_from`)
- Modify: `src/cmd/broadcast.rs` (add `fan_out_json`)
- Modify: `src/main.rs` (`--json`, `--panes`, `--body` on `Broadcast`)

**Interfaces:**
- Consumes: `broadcast::fan_out(&dyn Runner, &[String], &str) -> Vec<rt::SendResult>`
  where `SendResult { pane_id, delivered, reason }`
- Produces:
  - `json::BroadcastResult { pane_id: String, ok: bool, delivered: String, error: Option<String> }`, serialized `camelCase`
  - `json::Broadcast { ok: bool, results: Vec<BroadcastResult> }`
  - `json::broadcast_from(&[rt::SendResult]) -> Broadcast`
  - `cmd::broadcast::fan_out_json(&dyn Runner, &[String], &str) -> Result<json::Broadcast, String>`

- [ ] **Step 1: Add the shapes and stub**

```rust
/// `delivered` is rt's own word, carried through unchanged: `ok` is the
/// question most callers ask, but "accepted" and "queued" are a real
/// difference and only rt gets to name it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastResult {
    pub pane_id: String,
    pub ok: bool,
    pub delivered: String,
    pub error: Option<String>,
}

/// `ok` is every pane taking the message, and an empty fan-out is not ok: a
/// broadcast that reached nobody is a failure the caller has to be able to see.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Broadcast {
    pub ok: bool,
    pub results: Vec<BroadcastResult>,
}

pub fn broadcast_from(_results: &[crate::rt::SendResult]) -> Broadcast {
    Broadcast { ok: true, results: Vec::new() }
}
```

- [ ] **Step 2: Write the failing tests**

In `src/json.rs`'s `mod tests`:

```rust
    #[test]
    fn broadcast_result_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&BroadcastResult {
            pane_id: "w1:p1".to_string(),
            ok: true,
            delivered: "accepted".to_string(),
            error: None,
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"paneId":"w1:p1","ok":true,"delivered":"accepted","error":null}"#
        );
    }
```

In `src/cmd/broadcast.rs`'s `mod tests`:

```rust
    fn result(pane: &str, delivered: &str, reason: Option<&str>) -> rt::SendResult {
        rt::SendResult {
            pane_id: pane.to_string(),
            delivered: delivered.to_string(),
            reason: reason.map(str::to_string),
        }
    }

    #[test]
    fn a_partial_broadcast_is_not_ok_and_names_the_pane_that_refused_it() {
        let out = crate::json::broadcast_from(&[
            result("w1:p1", "accepted", None),
            result("w2:p7", "refused", Some("not signed in")),
        ]);
        assert!(!out.ok, "two panes, one refused, is not a success");
        assert_eq!(out.results.len(), 2);
        assert!(out.results[0].ok);
        assert!(!out.results[1].ok);
        assert_eq!(out.results[1].error.as_deref(), Some("not signed in"));
    }

    /// rt answers a send with `accepted`, `queued` or `refused`, and only
    /// `refused` is a failure. A queued send is one rt has taken
    /// responsibility for, and calling it failed sends the user chasing a
    /// message that did arrive.
    #[test]
    fn a_queued_send_counts_as_delivered() {
        let out = crate::json::broadcast_from(&[result("w1:p1", "queued", None)]);
        assert!(out.ok);
        assert!(out.results[0].ok);
        assert_eq!(out.results[0].delivered, "queued");
    }

    #[test]
    fn a_refusal_with_no_reason_still_says_something() {
        let out = crate::json::broadcast_from(&[result("w1:p1", "refused", None)]);
        assert_eq!(out.results[0].error.as_deref(), Some("refused"));
    }

    #[test]
    fn a_broadcast_to_no_panes_is_not_a_silent_success() {
        assert!(!crate::json::broadcast_from(&[]).ok);
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::broadcast json`
Expected: FAIL on `assert!(!out.ok, "two panes, one refused, is not a success")`.

- [ ] **Step 4: Implement**

```rust
pub fn broadcast_from(results: &[crate::rt::SendResult]) -> Broadcast {
    let mapped: Vec<BroadcastResult> = results
        .iter()
        .map(|r| {
            let ok = r.delivered != "refused";
            BroadcastResult {
                pane_id: r.pane_id.clone(),
                ok,
                delivered: r.delivered.clone(),
                error: if ok {
                    None
                } else {
                    r.reason.clone().or_else(|| Some(r.delivered.clone()))
                },
            }
        })
        .collect();
    Broadcast { ok: !mapped.is_empty() && mapped.iter().all(|r| r.ok), results: mapped }
}
```

The three delivery words are the ones `broadcast::summary` at
`src/cmd/broadcast.rs:85` already counts.

In `src/cmd/broadcast.rs`:

```rust
/// The same fan-out the TUI runs, reported per pane. Both guards run before
/// anything is sent.
pub fn fan_out_json(
    r: &dyn Runner,
    panes: &[String],
    message: &str,
) -> Result<crate::json::Broadcast, String> {
    if panes.is_empty() {
        return Err("at least one pane is required".to_string());
    }
    if message.trim().is_empty() {
        return Err("body is required".to_string());
    }
    Ok(crate::json::broadcast_from(&fan_out(r, panes, message)))
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::broadcast json`
Expected: PASS.

- [ ] **Step 6: Prove one test can fail**

Change `r.delivered != "refused"` to `r.delivered == "accepted"`, run
`cargo test --lib cmd::broadcast`, and watch `a_queued_send_counts_as_delivered`
go red. Restore it.

- [ ] **Step 7: Wire the flags**

```rust
    Broadcast {
        #[arg(long)]
        pane: bool,
        #[arg(long)]
        json: bool,
        /// Comma-separated pane ids.
        #[arg(long, value_delimiter = ',')]
        panes: Vec<String>,
        #[arg(long)]
        body: Option<String>,
    },
```

In its arm, first:

```rust
            if json {
                return match body
                    .ok_or_else(|| "--body is required with --json".to_string())
                    .and_then(|body| cmd::broadcast::fan_out_json(&runner, &panes, &body))
                    .and_then(|b| json::emit(&b))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 8: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/broadcast.rs
git commit -m "broadcast: a result per pane, and only refused is a failure"
```

---

### Task 7: `jump --json`

`jump_to` finds the pane then focuses it through herdr. The JSON verb stops at
finding it: flock focuses panes itself, and two things moving focus fight.

**Files:**
- Modify: `src/json.rs` (add `Jump`)
- Modify: `src/cmd/jump.rs` (add `locate`)
- Modify: `src/main.rs` (add the `Jump` subcommand)

**Interfaces:**
- Consumes: `rt::pane_list(&dyn Runner) -> Result<Vec<rt::ChatPane>, String>`
- Produces:
  - `json::Jump { pane_id: String, workspace: String, handle: String }`, serialized `camelCase`
  - `cmd::jump::locate(&dyn Runner, &str) -> Result<json::Jump, String>`

**Why no workspace or tab id:** rt's pane row carries a workspace *name* and
nothing about tabs. flock maps a pane id to its workspace and tab from the
layout it already renders, so asking this binary to resolve them would mean a
herdr round trip for something the caller already knows.

- [ ] **Step 1: Add the shape and stub**

```rust
/// Where a handle is, so the caller can go there itself. Deliberately not a
/// focus: flock moves its own focus, and two clients moving it fight.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Jump {
    pub pane_id: String,
    pub workspace: String,
    pub handle: String,
}
```

```rust
pub fn locate(_r: &dyn Runner, _handle: &str) -> Result<crate::json::Jump, String> {
    Ok(crate::json::Jump {
        pane_id: String::new(),
        workspace: String::new(),
        handle: String::new(),
    })
}
```

- [ ] **Step 2: Write the failing tests**

In `src/json.rs`'s `mod tests`:

```rust
    #[test]
    fn jump_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&Jump {
            pane_id: "w1:p1".to_string(),
            workspace: "flock".to_string(),
            handle: "kay".to_string(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"paneId":"w1:p1","workspace":"flock","handle":"kay"}"#
        );
    }
```

In `src/cmd/jump.rs`'s `mod tests`:

```rust
    /// Named apart from this module's existing `ONE_PANE`, which is herdr's
    /// snapshot shape rather than rt's roster.
    const RT_ONE_PANE: &str = r#"{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","agentStatus":"idle","presence":{"handle":"kay","status":"live"}}]}"#;

    #[test]
    fn locate_answers_with_the_pane_that_handle_is_signed_in_on() {
        let r = FakeRunner::sequence(&[RT_ONE_PANE]);
        let j = locate(&r, "kay").unwrap();
        assert_eq!(j.pane_id, "w1:p1");
        assert_eq!(j.workspace, "flock");
        assert_eq!(j.handle, "kay");
    }

    /// An empty answer would be mistaken for "found it, at no pane".
    #[test]
    fn locate_is_an_error_for_a_handle_on_no_pane() {
        let r = FakeRunner::sequence(&[r#"{"ok":true,"panes":[]}"#]);
        assert!(locate(&r, "ghost").is_err());
    }

    #[test]
    fn locate_never_moves_focus() {
        let r = FakeRunner::sequence(&[RT_ONE_PANE]);
        locate(&r, "kay").unwrap();
        assert_eq!(
            r.call_count(),
            1,
            "a second call here is a focus this verb must not perform"
        );
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::jump json`
Expected: FAIL on `assert_eq!(j.pane_id, "w1:p1")`, left `""`.

- [ ] **Step 4: Implement**

```rust
/// The pane `handle` is signed in on. Errs rather than answering an empty
/// object, so a caller cannot mistake "nobody by that name" for "found it".
pub fn locate(r: &dyn Runner, handle: &str) -> Result<crate::json::Jump, String> {
    let panes = rt::pane_list(r)?;
    let pane = panes
        .iter()
        .find(|p| p.presence.as_ref().is_some_and(|pr| pr.handle == handle))
        .ok_or_else(|| format!("no pane is signed in as {handle:?}"))?;
    Ok(crate::json::Jump {
        pane_id: pane.pane_id.clone(),
        workspace: pane.workspace.clone(),
        handle: handle.to_string(),
    })
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::jump json`
Expected: PASS, including the existing `jump_to` tests, which are untouched.

- [ ] **Step 6: Wire the subcommand**

```rust
    /// Print where a handle's pane is. JSON only, and moves no focus.
    Jump {
        #[arg(long)]
        handle: String,
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
```

```rust
        Cmd::Jump { handle, json: _ } => {
            match cmd::jump::locate(&runner, &handle).and_then(|j| json::emit(&j)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
```

- [ ] **Step 7: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/jump.rs
git commit -m "jump: answer where a handle is, and move nothing"
```

---

### Task 8: `open-viewer --json`

**Files:**
- Modify: `src/json.rs` (add `Viewer`)
- Modify: `src/cmd/open_viewer.rs` (add `url_for`, and make `run` call it)
- Modify: `src/main.rs` (`--json` on `OpenViewer`)

**Interfaces:**
- Consumes: `deck::viewer_url_real(&dyn Runner) -> Result<String, String>`
- Produces:
  - `json::Viewer { url: String }`
  - `cmd::open_viewer::url_for(&dyn Runner, Option<&str>) -> Result<json::Viewer, String>`

- [ ] **Step 1: Add the shape and stub**

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Viewer {
    pub url: String,
}
```

```rust
pub fn url_for(_runner: &dyn Runner, _room: Option<&str>) -> Result<crate::json::Viewer, String> {
    Ok(crate::json::Viewer { url: String::new() })
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/cmd/open_viewer.rs`'s `mod tests`:

```rust
    #[test]
    fn url_for_resolves_without_opening_anything() {
        let r = FakeRunner::new();
        let v = url_for(&r, None).unwrap();
        assert_eq!(v.url, "https://chat.mattstack");
        assert!(
            r.calls
                .lock()
                .unwrap()
                .iter()
                .all(|c| c.first().map(String::as_str) != Some("open")),
            "resolving a URL must not open it"
        );
    }

    #[test]
    fn url_for_appends_the_room_suffix() {
        let r = FakeRunner::new();
        assert_eq!(
            url_for(&r, Some("build")).unwrap().url,
            "https://chat.mattstack/r/build"
        );
    }
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cargo test --lib cmd::open_viewer`
Expected: FAIL on `assert_eq!(v.url, "https://chat.mattstack")`, left `""`.

- [ ] **Step 4: Implement, and route `run` through it**

```rust
/// The viewer URL, deep-linked to `room` when one is given. Resolving is all
/// this does: a caller with its own idea of how to open a URL asks for the URL.
pub fn url_for(runner: &dyn Runner, room: Option<&str>) -> Result<crate::json::Viewer, String> {
    let base = deck::viewer_url_real(runner)
        .map_err(|e| format!("could not resolve the viewer URL: {e}"))?;
    let url = match room {
        Some(r) => format!("{}/r/{}", base.trim_end_matches('/'), r),
        None => base,
    };
    Ok(crate::json::Viewer { url })
}

pub fn run(runner: &dyn Runner, room: Option<&str>) -> Result<(), String> {
    let url = url_for(runner, room)?.url;
    match runner.run(&["open", url.as_str()], &[]) {
        Ok(o) if o.status == 0 => Ok(()),
        Ok(o) => Err(format!("open exited {}", o.status)),
        Err(e) => Err(e.to_string()),
    }
}
```

`run` calls `url_for` so the two paths cannot build different URLs.

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::open_viewer`
Expected: PASS, including the two existing tests that assert `open` is called.

- [ ] **Step 6: Wire the flag**

```rust
        Cmd::OpenViewer { room, json } => {
            if json {
                return match cmd::open_viewer::url_for(&runner, room.as_deref())
                    .and_then(|v| json::emit(&v))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
            match cmd::open_viewer::run(&runner, room.as_deref()) {
                Ok(_) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("open-viewer: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
```

with `#[arg(long)] json: bool` added to the `OpenViewer` variant.

- [ ] **Step 7: Run everything and commit**

Run: `cargo test`
Expected: PASS, whole suite.

```bash
git add src/json.rs src/main.rs src/cmd/open_viewer.rs
git commit -m "open-viewer: hand back the url, let the caller open it"
```

---

### Task 9: Document the surface

The contract now has a second consumer that cannot read this crate's source.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a section under `## Features`**

````markdown
## Headless use

Every action also runs without a terminal. Pass `--json` and the command
prints one JSON object on stdout and draws nothing:

```bash
herdr-chat status --json --pane w1:p1
herdr-chat peek --json
herdr-chat targets --json
herdr-chat quick-send --json --to '#rt' --body 'schema v5 is mine'
herdr-chat broadcast --json --panes w1:p1,w2:p7 --body 'pausing releases'
herdr-chat sign-in --json --pane w1:p1
herdr-chat jump --json --handle scout
herdr-chat open-viewer --json
```

`status`, `targets` and `jump` have no other mode, so `--json` is optional
there and changes nothing.

Three rules hold across every verb. `--json` never prompts and never falls
back to the TUI, so a missing required flag is an error. A failure prints
`{"error":"..."}` and exits non-zero. And two verbs deliberately stop short
of acting: `jump` answers where a handle is and moves no focus, and
`open-viewer --json` returns the URL rather than opening it, so the caller
decides both.

The sign verbs answer with the same object as `status`, because rt's own sign
replies carry no state and the next question after signing is always what the
header now reads.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "readme: the headless surface, verb by verb"
```

---

## What this plan does not do

- No flock code. That is the second plan, and it consumes this contract.
- No change to how the herdr TUI looks or behaves.
- No new dependency. `serde_json` is already in `Cargo.toml`.
- No `launcher --json`. The launcher is a menu over the other verbs, and a menu
  is the caller's to draw.
