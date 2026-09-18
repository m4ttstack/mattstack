# herdr-chat Headless Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every herdr-chat feature is reachable as a non-interactive command that
prints one JSON object, so a second front end can drive it without a terminal.

**Architecture:** the decisions already live in pub functions (`peek::rows`,
`quick_send::send`, `broadcast::fan_out`, `sign::run_with`, `jump::jump_to`,
`launcher::origin_status`); only the TUI calls them today. This adds a `json`
module holding the wire shapes and one emit helper, then a `--json` path per
subcommand that calls the same functions and prints instead of drawing. No TUI
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
- Field names are the contract with another repo. They are `camelCase` and are
  asserted verbatim in tests.
- Every subprocess goes through the `Runner` seam. No test spawns a process, and
  none contacts `rt`, `herdr`, or `deck`.
- No em dashes or en dashes anywhere, including comments and commit messages.
- Comments state constraints the code cannot show. No narration, and never a
  reference to a task number, review, or plan.
- Commit messages: short, lowercase, imperative. Run `git log --oneline -15`
  for the house voice first.

---

## File Structure

- **Create `src/json.rs`**: every wire shape (`Serialize` only) plus `emit`.
  The shapes are declared here rather than derived on `rt.rs` types on purpose:
  `rt.rs` mirrors what rt happens to print today, and this file is a promise to
  another repo. One file so the whole contract is readable at once.
- **Modify `src/main.rs`**: a `--json` flag on each existing subcommand, three
  new json-only subcommands (`status`, `targets`, `jump`), and dispatch.
- **Modify `src/cmd/peek.rs`, `quick_send.rs`, `broadcast.rs`, `jump.rs`,
  `sign.rs`, `open_viewer.rs`**: one headless entry point each, beside the
  existing `run`/`open`. No existing function changes signature.
- **Modify `src/main.rs`'s `mod` list**: add `mod json;`.

Each task's tests live in that task's own file, in the `#[cfg(test)] mod tests`
block already there, using that module's existing `FakeRunner` pattern.

Run one module's tests with `cargo test --lib cmd::peek` (and so on); run
everything with `cargo test`.

---

### Task 1: The JSON module, proven on sign-in and sign-out

Sign is the smallest verb and is already headless: `sign::run_with(runner,
which, pane)` returns `Result<String, String>`. It is the right place to
establish the envelope, the emit helper, and the `--json` flag shape that the
seven tasks after this copy.

**Files:**
- Create: `src/json.rs`
- Modify: `src/main.rs` (add `mod json;`, `--json` on `SignIn`/`SignOut`, dispatch)
- Modify: `src/cmd/sign.rs` (add `run_json`)

**Interfaces:**
- Consumes: `sign::run_with(&dyn Runner, Sign, Option<&str>) -> Result<String, String>`
- Produces:
  - `json::emit<T: serde::Serialize>(value: &T) -> Result<(), String>` prints one line
  - `json::fail(message: &str)` prints `{"error":"..."}`
  - `json::SignStatus { handle: Option<String>, state: String }`
  - `cmd::sign::run_json(&dyn Runner, Sign, Option<&str>) -> Result<json::SignStatus, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/sign.rs`'s `mod tests`:

```rust
    #[test]
    fn sign_in_json_reports_the_handle_and_state_it_signed_in_as() {
        let r = FakeRunner::capture(r#"{"handle":"kay","status":"live"}"#);
        let out = run_json(&r, Sign::In, Some("w1:p1")).unwrap();
        assert_eq!(out.handle.as_deref(), Some("kay"));
        assert_eq!(out.state, "live");
    }

    #[test]
    fn sign_json_without_a_pane_is_an_error_not_a_prompt() {
        let r = FakeRunner::capture("{}");
        assert!(run_json(&r, Sign::In, None).is_err());
    }
```

That `FakeRunner::capture` ignores its argument and always answers with a fixed
body, so first change its `run` to serve the body it was given:

```rust
    struct FakeRunner {
        calls: Mutex<Vec<Call>>,
        body: String,
    }

    impl FakeRunner {
        fn capture(body: &str) -> Self {
            FakeRunner {
                calls: Mutex::new(Vec::new()),
                body: body.to_string(),
            }
        }
```

and in its `Runner::run`, replace the hardcoded `stdout` with `self.body.clone()`.
The four existing sign tests pass the body they already expect, so they keep
passing unchanged.

- [ ] **Step 2: Run the test and watch it fail**

Run: `cargo test --lib cmd::sign`
Expected: FAIL with `cannot find function 'run_json' in this scope`. That is a
compile failure, so make it a real one by adding the stub first:

```rust
pub fn run_json(
    _runner: &dyn Runner,
    _which: Sign,
    _pane: Option<&str>,
) -> Result<crate::json::SignStatus, String> {
    Ok(crate::json::SignStatus { handle: None, state: String::new() })
}
```

Run it again. Expected: FAIL on `assert_eq!(out.handle.as_deref(), Some("kay"))`,
left `None`, right `Some("kay")`.

- [ ] **Step 3: Write `src/json.rs`**

```rust
//! The wire shapes every `--json` verb prints, and the two ways to print.
//!
//! These are declared here rather than derived on `rt.rs`'s types because
//! `rt.rs` mirrors whatever rt prints today, while this file is a promise to
//! another repo: a field renamed here breaks a consumer that cannot be
//! recompiled with this crate.

use serde::Serialize;

/// The chat identity a pane is signed in as, and what rt calls its state.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SignStatus {
    pub handle: Option<String>,
    pub state: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_status_carries_camel_case_field_names() {
        let out = serde_json::to_string(&SignStatus {
            handle: Some("kay".to_string()),
            state: "live".to_string(),
        })
        .unwrap();
        assert_eq!(out, r#"{"handle":"kay","state":"live"}"#);
    }

    #[test]
    fn a_missing_handle_is_null_rather_than_absent() {
        let out = serde_json::to_string(&SignStatus {
            handle: None,
            state: "signed out".to_string(),
        })
        .unwrap();
        assert_eq!(out, r#"{"handle":null,"state":"signed out"}"#);
    }
}
```

- [ ] **Step 4: Implement `run_json`**

Replace the stub in `src/cmd/sign.rs`:

```rust
/// The headless form of [`run_with`]. rt answers a sign call with the row it
/// wrote, so the handle and state come back from the same call that made them
/// rather than from a second lookup that could disagree.
pub fn run_json(
    runner: &dyn Runner,
    which: Sign,
    pane: Option<&str>,
) -> Result<crate::json::SignStatus, String> {
    let body = run_with(runner, which, pane)?;
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("rt answered with non-JSON: {e}"))?;
    Ok(crate::json::SignStatus {
        handle: parsed
            .get("handle")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        state: parsed
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}
```

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib cmd::sign json`
Expected: PASS, including the four sign tests that existed before.

- [ ] **Step 6: Wire the flag and dispatch**

In `src/main.rs`, add `mod json;` beside the other `mod` lines, then change the
two sign variants:

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

and their dispatch arms:

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

- [ ] **Step 7: Confirm the whole suite still passes**

Run: `cargo test`
Expected: PASS, with no existing test modified except `FakeRunner::capture`.

- [ ] **Step 8: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/sign.rs
git commit -m "json: a verb prints one object, and sign is the first"
```

---

### Task 2: `status --json`

The popover's header: who this pane is on chat, what state it is in, and which
rooms it carries. `launcher::origin_status` already computes it from the buddy
roster, and `launcher::room_tokens` already renders the room list.

**Files:**
- Modify: `src/json.rs` (add `Status`)
- Modify: `src/cmd/launcher.rs` (add `status_json`)
- Modify: `src/main.rs` (add the `Status` subcommand)

**Interfaces:**
- Consumes: `launcher::origin_status(Option<&str>, &[rt::Buddy]) -> OriginStatus`,
  `launcher::room_tokens(&[rt::Room]) -> Vec<String>`, `rt::buddies`,
  `rt::rooms_for_session`
- Produces:
  - `json::Status { handle: Option<String>, state: String, pane: Option<String>, signedIn: bool, rooms: Vec<String> }`
  - `cmd::launcher::status_json(&dyn Runner, Option<&str>) -> Result<json::Status, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/launcher.rs`'s `mod tests`. It needs a runner that answers
each rt call in order; the module's tests already build buddies with a `buddy`
helper, so reuse it for the expected identity:

```rust
    #[test]
    fn status_json_names_the_pane_identity_and_marks_it_signed_in() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"panes":[{"handle":"kay","status":"live","pane":"w1:p1","sessionId":"s-kay"}]}"#,
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
        let r = FakeRunner::sequence(&[r#"{"ok":true,"panes":[]}"#]);
        let s = status_json(&r, Some("w9:p9")).unwrap();
        assert_eq!(s.handle, None);
        assert_eq!(s.state, "not signed in");
        assert!(!s.signed_in);
        assert!(s.rooms.is_empty());
    }
```

If `FakeRunner::sequence` is not already in this module's tests, copy the one in
`src/cmd/jump.rs`'s test module verbatim, which serves canned stdout per call in
order.

- [ ] **Step 2: Run the test and watch it fail**

Add the stub so the failure is an assertion rather than a compile error:

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

Run: `cargo test --lib cmd::launcher`
Expected: FAIL on `assert_eq!(s.handle.as_deref(), Some("kay"))`, left `None`.

- [ ] **Step 3: Add the shape**

In `src/json.rs`:

```rust
/// What a pane is on chat right now: the identity, rt's own word for its
/// state, and the rooms that identity carries.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub handle: Option<String>,
    pub state: String,
    pub pane: Option<String>,
    pub signed_in: bool,
    pub rooms: Vec<String>,
}
```

- [ ] **Step 4: Implement**

Replace the stub in `src/cmd/launcher.rs`:

```rust
/// The popover header's whole content. `state` keeps rt's own vocabulary
/// rather than a rendered phrase, so the caller decides how to say it; the one
/// word this adds is "not signed in", which rt has no row for.
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

Run: `cargo test --lib cmd::launcher`
Expected: PASS.

- [ ] **Step 6: Wire the subcommand**

In `src/main.rs`'s `Cmd`:

```rust
    /// Print the chat status of a pane. JSON only.
    Status {
        #[arg(long)]
        pane: Option<String>,
    },
```

and its arm:

```rust
        Cmd::Status { pane } => {
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

- [ ] **Step 7: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/launcher.rs
git commit -m "status: a pane's chat identity, without drawing it"
```

---

### Task 3: `peek --json`

**Files:**
- Modify: `src/json.rs` (add `Peek`, `PeekBuddy`, `PeekRoom`)
- Modify: `src/cmd/peek.rs` (add `rows_json`)
- Modify: `src/main.rs` (`--json` on `Peek`)

**Interfaces:**
- Consumes: `peek::rows(...) -> Vec<Row>` with `Row { kind, handle, status, repo, branch, title, room, unread, mentions }`
- Produces:
  - `json::Peek { buddies: Vec<PeekBuddy>, rooms: Vec<PeekRoom> }`
  - `json::PeekBuddy { handle: String, status: String, repo: Option<String>, branch: Option<String>, title: Option<String>, unread: u32, mentions: u32 }`
  - `json::PeekRoom { room: String, unread: u32, mentions: u32 }`
  - `cmd::peek::rows_json(&dyn Runner) -> Result<json::Peek, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/peek.rs`'s `mod tests`:

```rust
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
            Row {
                kind: RowKind::Buddy,
                handle: Some("kay".to_string()),
                status: Some("live".to_string()),
                repo: Some("flock".to_string()),
                branch: Some("phase-0".to_string()),
                title: None,
                room: None,
                unread: 0,
                mentions: 0,
            },
        ];
        let out = crate::json::peek_from_rows(&rows);
        assert_eq!(out.rooms.len(), 1);
        assert_eq!(out.rooms[0].room, "rt");
        assert_eq!(out.rooms[0].unread, 3);
        assert_eq!(out.buddies.len(), 1);
        assert_eq!(out.buddies[0].handle, "kay");
        assert_eq!(out.buddies[0].branch.as_deref(), Some("phase-0"));
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
        let out = crate::json::peek_from_rows(&rows);
        assert!(out.buddies.is_empty());
        assert!(out.rooms.is_empty());
    }
```

- [ ] **Step 2: Run the test and watch it fail**

Add stubs in `src/json.rs` so the failure is an assertion:

```rust
pub fn peek_from_rows(_rows: &[crate::cmd::peek::Row]) -> Peek {
    Peek { buddies: Vec::new(), rooms: Vec::new() }
}
```

Run: `cargo test --lib cmd::peek`
Expected: FAIL on `assert_eq!(out.rooms.len(), 1)`, left `0`.

- [ ] **Step 3: Add the shapes and the mapping**

In `src/json.rs`:

```rust
/// A buddy row as a consumer reads it: the identity is required, because a row
/// that cannot name who it is about is not a row anyone can act on.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PeekBuddy {
    pub handle: String,
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

pub fn peek_from_rows(rows: &[crate::cmd::peek::Row]) -> Peek {
    let mut buddies = Vec::new();
    let mut rooms = Vec::new();
    for row in rows {
        match row.kind {
            crate::cmd::peek::RowKind::Buddy => {
                if let Some(handle) = row.handle.clone() {
                    buddies.push(PeekBuddy {
                        handle,
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

`RowKind` needs `Clone, Copy` if it does not already derive them; add them to
its existing derive list rather than matching on a reference.

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::peek json`
Expected: PASS.

- [ ] **Step 5: Add the runner-level entry point**

In `src/cmd/peek.rs`, beside `run`:

```rust
/// The same rows the TUI draws, as data. Gathers exactly what `run` gathers,
/// so the two front ends cannot disagree about what is unread.
pub fn rows_json(r: &dyn Runner) -> Result<crate::json::Peek, String> {
    let buddies = rt::buddies(r).unwrap_or_default();
    let rooms = rt::rooms(r).unwrap_or_default();
    let panes = rt::pane_list(r).unwrap_or_default();
    let details = rt::agent_details(&panes);
    Ok(crate::json::peek_from_rows(&rows(buddies, rooms, &details)))
}
```

`rows` takes `(Vec<rt::Buddy>, Vec<rt::Room>, &HashMap<String, rt::AgentDetail>)`
and no runner, which is why the gathering is repeated here rather than shared:
`run` does the same four calls at `src/cmd/peek.rs:149`. The
`unwrap_or_default` calls match `run`'s, so an rt that answers nothing gives an
empty peek rather than an error, exactly as the TUI already behaves.

- [ ] **Step 6: Wire the flag**

In `src/main.rs`, add `#[arg(long)] json: bool` to the `Peek` variant, and in
its arm, before the existing `pane` branch:

```rust
        Cmd::Peek { pane, json } => {
            if json {
                return match cmd::peek::rows_json(&runner).and_then(|p| crate::json::emit(&p)) {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        crate::json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 7: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/peek.rs
git commit -m "peek: the rows as data, buddies and rooms apart"
```

---

### Task 4: `targets --json`

The pickable list quick-send offers: rooms first, then buddies as DMs.

**Files:**
- Modify: `src/json.rs` (add `Targets`)
- Modify: `src/cmd/quick_send.rs` (add `targets_json`)
- Modify: `src/main.rs` (add the `Targets` subcommand)

**Interfaces:**
- Consumes: `quick_send::targets(...) -> Vec<TargetRow>` (private today; make it
  `pub(crate)` rather than changing its shape)
- Produces:
  - `json::Targets { rooms: Vec<String>, people: Vec<String> }`
  - `cmd::quick_send::targets_json(&dyn Runner) -> Result<json::Targets, String>`

- [ ] **Step 1: Write the failing test**

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
        assert_eq!(crate::json::parse_target("rt"), None);
    }
```

`Target` needs `Debug, Clone, PartialEq, Eq` for these assertions; add them to
its derive list.

- [ ] **Step 2: Run the test and watch it fail**

Stub both functions in `src/json.rs` returning empty/`None`, then run
`cargo test --lib cmd::quick_send`.
Expected: FAIL on `assert_eq!(t.rooms, vec!["#rt".to_string()])`, left `[]`.

- [ ] **Step 3: Implement**

In `src/json.rs`:

```rust
/// What a caller may send to. The prefixes are the wire form: `#room` and
/// `@handle` are one namespace a caller can pass straight back as `--to`,
/// where a bare name would be ambiguous between a room and a person.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Targets {
    pub rooms: Vec<String>,
    pub people: Vec<String>,
}

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

/// The inverse of [`targets_from`]'s prefixes. An unprefixed string is not
/// guessed at: the caller was handed prefixed names and is expected to return
/// one of them.
pub fn parse_target(s: &str) -> Option<crate::cmd::quick_send::Target> {
    match s.split_at_checked(1) {
        Some(("#", rest)) if !rest.is_empty() => {
            Some(crate::cmd::quick_send::Target::Room(rest.to_string()))
        }
        Some(("@", rest)) if !rest.is_empty() => {
            Some(crate::cmd::quick_send::Target::Dm(rest.to_string()))
        }
        _ => None,
    }
}
```

In `src/cmd/quick_send.rs` add:

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

`targets` is `fn targets(Vec<rt::Room>, Vec<rt::Buddy>, &HashMap<String, rt::AgentDetail>) -> Vec<TargetRow>`
and `TargetRow`'s target field is named `target`. Both `targets` and `TargetRow`
are private to the module, and this new function is in that module, so neither
visibility changes. `Target` must become `pub` if it is not already, since
`json::targets_from` names it.

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::quick_send json`
Expected: PASS.

- [ ] **Step 5: Wire the subcommand**

In `src/main.rs`'s `Cmd`:

```rust
    /// Print what quick-send can send to. JSON only.
    Targets,
```

and its arm:

```rust
        Cmd::Targets => {
            match cmd::quick_send::targets_json(&runner).and_then(|t| json::emit(&t)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
```

- [ ] **Step 6: Commit**

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
- Consumes: `quick_send::send(&dyn Runner, Target, &str) -> Result<(), String>`,
  `json::parse_target`
- Produces:
  - `json::Sent { ok: bool, to: String }`
  - `cmd::quick_send::send_json(&dyn Runner, &str, &str) -> Result<json::Sent, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/quick_send.rs`'s `mod tests`:

```rust
    #[test]
    fn send_json_posts_to_the_room_it_was_given_and_echoes_the_target() {
        let r = FakeRunner::capture("{}");
        let out = send_json(&r, "#rt", "schema v5 is mine").unwrap();
        assert!(out.ok);
        assert_eq!(out.to, "#rt");
    }

    #[test]
    fn an_unprefixed_target_is_refused_rather_than_guessed() {
        let r = FakeRunner::capture("{}");
        assert!(send_json(&r, "rt", "hello").is_err());
    }

    #[test]
    fn an_empty_body_is_refused_before_anything_is_sent() {
        let r = FakeRunner::capture("{}");
        assert!(send_json(&r, "#rt", "").is_err());
    }
```

If this module's tests have no `FakeRunner::capture`, copy the one from
`src/cmd/sign.rs`'s test module as amended in Task 1.

- [ ] **Step 2: Run the test and watch it fail**

Stub `send_json` returning `Ok(Sent { ok: false, to: String::new() })`, then run
`cargo test --lib cmd::quick_send`.
Expected: FAIL on `assert!(out.ok)`.

- [ ] **Step 3: Implement**

In `src/json.rs`:

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Sent {
    pub ok: bool,
    pub to: String,
}
```

In `src/cmd/quick_send.rs`:

```rust
/// Sends `body` to the prefixed `to`. An empty body is refused here rather
/// than sent: rt would accept it, and an empty line in a room is noise nobody
/// meant to make.
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

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::quick_send`
Expected: PASS.

- [ ] **Step 5: Wire the flags**

In `src/main.rs`, the `QuickSend` variant becomes:

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

and its arm gains, first:

```rust
            if json {
                let missing = "--to and --body are required with --json";
                return match to
                    .zip(body)
                    .ok_or_else(|| missing.to_string())
                    .and_then(|(to, body)| cmd::quick_send::send_json(&runner, &to, &body))
                    .and_then(|s| crate::json::emit(&s))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        crate::json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 6: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/quick_send.rs
git commit -m "quick-send: one line to a named target, no picker"
```

---

### Task 6: `broadcast --json`

**Files:**
- Modify: `src/json.rs` (add `Broadcast`, `BroadcastResult`)
- Modify: `src/cmd/broadcast.rs` (add `fan_out_json`)
- Modify: `src/main.rs` (`--json`, `--panes`, `--body` on `Broadcast`)

**Interfaces:**
- Consumes: `broadcast::fan_out(&dyn Runner, &[String], &str) -> Vec<rt::SendResult>`
  where `SendResult { pane_id: String, delivered: String, reason: Option<String> }`
- Produces:
  - `json::BroadcastResult { paneId: String, ok: bool, error: Option<String> }`
  - `json::Broadcast { ok: bool, results: Vec<BroadcastResult> }`
  - `cmd::broadcast::fan_out_json(&dyn Runner, &[String], &str) -> Result<json::Broadcast, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/broadcast.rs`'s `mod tests`:

```rust
    #[test]
    fn a_partial_broadcast_is_not_ok_and_names_the_pane_that_refused_it() {
        let results = vec![
            rt::SendResult {
                pane_id: "w1:p1".to_string(),
                delivered: "accepted".to_string(),
                reason: None,
            },
            rt::SendResult {
                pane_id: "w2:p7".to_string(),
                delivered: "refused".to_string(),
                reason: Some("not signed in".to_string()),
            },
        ];
        let out = crate::json::broadcast_from(&results);
        assert!(!out.ok, "two panes, one refused, is not a success");
        assert_eq!(out.results.len(), 2);
        assert!(out.results[0].ok);
        assert!(!out.results[1].ok);
        assert_eq!(out.results[1].error.as_deref(), Some("not signed in"));
    }

    /// `queued` is a send rt has taken responsibility for, not a failure. A
    /// broadcast to a pane whose agent is busy queues, and reporting that as
    /// refused would send the user chasing a message that did arrive.
    #[test]
    fn a_queued_send_counts_as_delivered() {
        let results = vec![rt::SendResult {
            pane_id: "w1:p1".to_string(),
            delivered: "queued".to_string(),
            reason: None,
        }];
        let out = crate::json::broadcast_from(&results);
        assert!(out.ok);
        assert!(out.results[0].ok);
        assert_eq!(out.results[0].delivered, "queued");
    }

    #[test]
    fn every_pane_accepting_is_ok() {
        let results = vec![rt::SendResult {
            pane_id: "w1:p1".to_string(),
            delivered: "accepted".to_string(),
            reason: None,
        }];
        assert!(crate::json::broadcast_from(&results).ok);
    }

    #[test]
    fn a_broadcast_to_no_panes_is_not_a_silent_success() {
        assert!(!crate::json::broadcast_from(&[]).ok);
    }
```

- [ ] **Step 2: Run the test and watch it fail**

Stub `broadcast_from` returning `Broadcast { ok: true, results: Vec::new() }`,
then run `cargo test --lib cmd::broadcast`.
Expected: FAIL on `assert!(!out.ok, ...)`.

- [ ] **Step 3: Implement**

In `src/json.rs`:

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

/// `ok` is every pane accepting, and an empty fan-out is not ok: a broadcast
/// that reached nobody is a failure the caller has to be able to see.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Broadcast {
    pub ok: bool,
    pub results: Vec<BroadcastResult>,
}

pub fn broadcast_from(results: &[crate::rt::SendResult]) -> Broadcast {
    let mapped: Vec<BroadcastResult> = results
        .iter()
        .map(|r| {
            let ok = r.delivered != "refused";
            BroadcastResult {
                pane_id: r.pane_id.clone(),
                ok,
                delivered: r.delivered.clone(),
                error: if ok { None } else { r.reason.clone().or_else(|| Some(r.delivered.clone())) },
            }
        })
        .collect();
    Broadcast { ok: !mapped.is_empty() && mapped.iter().all(|r| r.ok), results: mapped }
}
```

rt answers a send with one of three words, which `broadcast::summary` at
`src/cmd/broadcast.rs:85` already counts: `accepted`, `queued`, `refused`. Only
`refused` is a failure, so the test is `!= "refused"` rather than
`== "accepted"`: a queued send is one rt has taken responsibility for, and
calling it a failure would send the user chasing a message that did arrive.

In `src/cmd/broadcast.rs`:

```rust
/// The same fan-out the TUI runs, reported per pane. An empty pane list is
/// refused before anything is sent.
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

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::broadcast json`
Expected: PASS.

- [ ] **Step 5: Wire the flags**

In `src/main.rs`, the `Broadcast` variant becomes:

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

and its arm gains, first:

```rust
            if json {
                return match body
                    .ok_or_else(|| "--body is required with --json".to_string())
                    .and_then(|body| cmd::broadcast::fan_out_json(&runner, &panes, &body))
                    .and_then(|b| crate::json::emit(&b))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        crate::json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
```

- [ ] **Step 6: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/broadcast.rs
git commit -m "broadcast: a result per pane, and partial is not ok"
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
- Consumes: `rt::pane_list(&dyn Runner) -> Result<Vec<rt::ChatPane>, String>`,
  `rt::ChatPane { pane_id, workspace, title, cwd, repo, branch, agent_status, session_id, presence }`
- Produces:
  - `json::Jump { paneId: String, workspace: String, handle: String }`
  - `cmd::jump::locate(&dyn Runner, &str) -> Result<json::Jump, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/jump.rs`'s `mod tests`:

```rust
    #[test]
    fn locate_answers_with_the_pane_that_handle_is_signed_in_on() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","agentStatus":"idle","presence":{"handle":"kay","status":"live"}}]}"#,
        ]);
        let j = locate(&r, "kay").unwrap();
        assert_eq!(j.pane_id, "w1:p1");
        assert_eq!(j.workspace, "flock");
        assert_eq!(j.handle, "kay");
    }

    #[test]
    fn locate_is_an_error_for_a_handle_on_no_pane() {
        let r = FakeRunner::sequence(&[r#"{"ok":true,"panes":[]}"#]);
        assert!(locate(&r, "ghost").is_err());
    }

    #[test]
    fn locate_never_moves_focus() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","agentStatus":"idle","presence":{"handle":"kay","status":"live"}}]}"#,
        ]);
        locate(&r, "kay").unwrap();
        assert_eq!(r.call_count(), 1, "a second call here is a focus this verb must not perform");
    }
```

- [ ] **Step 2: Run the test and watch it fail**

Stub `locate` returning `Ok(Jump { pane_id: String::new(), workspace: String::new(), handle: String::new() })`,
then run `cargo test --lib cmd::jump`.
Expected: FAIL on `assert_eq!(j.pane_id, "w1:p1")`, left `""`.

- [ ] **Step 3: Implement**

In `src/json.rs`:

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

In `src/cmd/jump.rs`:

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

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::jump`
Expected: PASS, including the existing `jump_to` tests, which are untouched.

- [ ] **Step 5: Wire the subcommand**

In `src/main.rs`'s `Cmd`:

```rust
    /// Print where a handle's pane is. JSON only, and moves no focus.
    Jump {
        #[arg(long)]
        handle: String,
    },
```

and its arm:

```rust
        Cmd::Jump { handle } => match cmd::jump::locate(&runner, &handle).and_then(|j| json::emit(&j)) {
            Ok(()) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                json::fail(&e);
                std::process::ExitCode::FAILURE
            }
        },
```

- [ ] **Step 6: Commit**

```bash
git add src/json.rs src/main.rs src/cmd/jump.rs
git commit -m "jump: answer where a handle is, and move nothing"
```

---

### Task 8: `open-viewer --json`

**Files:**
- Modify: `src/json.rs` (add `Viewer`)
- Modify: `src/cmd/open_viewer.rs` (add `url_for`)
- Modify: `src/main.rs` (`--json` on `OpenViewer`)

**Interfaces:**
- Consumes: `deck::viewer_url_real(&dyn Runner) -> Result<String, String>`
- Produces:
  - `json::Viewer { url: String }`
  - `cmd::open_viewer::url_for(&dyn Runner, Option<&str>) -> Result<json::Viewer, String>`

- [ ] **Step 1: Write the failing test**

Append to `src/cmd/open_viewer.rs`'s `mod tests`:

```rust
    #[test]
    fn url_for_resolves_without_opening_anything() {
        let r = FakeRunner::new();
        let v = url_for(&r, None).unwrap();
        assert_eq!(v.url, "https://chat.mattstack");
        assert!(
            r.calls.lock().unwrap().iter().all(|c| c.first().map(String::as_str) != Some("open")),
            "resolving a URL must not open it"
        );
    }

    #[test]
    fn url_for_appends_the_room_suffix() {
        let r = FakeRunner::new();
        assert_eq!(url_for(&r, Some("build")).unwrap().url, "https://chat.mattstack/r/build");
    }
```

- [ ] **Step 2: Run the test and watch it fail**

Stub `url_for` returning `Ok(Viewer { url: String::new() })`, then run
`cargo test --lib cmd::open_viewer`.
Expected: FAIL on `assert_eq!(v.url, "https://chat.mattstack")`, left `""`.

- [ ] **Step 3: Implement**

In `src/json.rs`:

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Viewer {
    pub url: String,
}
```

In `src/cmd/open_viewer.rs`, extract the URL building that `run` does inline so
both paths share it:

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
```

and change `run` to call it, so the two cannot drift:

```rust
pub fn run(runner: &dyn Runner, room: Option<&str>) -> Result<(), String> {
    let url = url_for(runner, room)?.url;
    match runner.run(&["open", url.as_str()], &[]) {
        Ok(o) if o.status == 0 => Ok(()),
        Ok(o) => Err(format!("open exited {}", o.status)),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib cmd::open_viewer`
Expected: PASS, including the two existing tests that assert `open` is called.

- [ ] **Step 5: Wire the flag**

In `src/main.rs`, the `OpenViewer` variant gains `#[arg(long)] json: bool`, and
its arm becomes:

```rust
        Cmd::OpenViewer { room, json } => {
            if json {
                return match cmd::open_viewer::url_for(&runner, room.as_deref())
                    .and_then(|v| crate::json::emit(&v))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        crate::json::fail(&e);
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

- [ ] **Step 6: Run everything and commit**

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

- [ ] **Step 1: Add a section**

Under `## Features`, add:

```markdown
## Headless use

Every action also runs without a terminal. Pass `--json` (or use the
JSON-only verbs `status`, `targets`, `jump`) and the command prints one JSON
object on stdout and draws nothing:

```bash
herdr-chat status --json --pane w1:p1
herdr-chat peek --json
herdr-chat targets
herdr-chat quick-send --json --to '#rt' --body 'schema v5 is mine'
herdr-chat broadcast --json --panes w1:p1,w2:p7 --body 'pausing releases'
herdr-chat sign-in --json --pane w1:p1
herdr-chat jump --handle scout
herdr-chat open-viewer --json
```

`--json` never prompts and never falls back to the TUI: a missing required
flag is an error. A failure prints `{"error":"..."}` and exits non-zero.
`jump` answers where a handle is and moves no focus, and `open-viewer --json`
returns the URL rather than opening it, so the caller decides both.
```

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
