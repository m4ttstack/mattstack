# herdr-chat, part 2: the plugin (herdr-chat repo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `m4ttstack.chat` herdr plugin: a Rust binary with subcommands for broadcast, jump-to-pane, sign-in/out, prompt-on-start, peek, quick-send, and open-viewer, plus the `herdr-plugin.toml` manifest that wires them to herdr actions, an event hook, and popup panes.

**Architecture:** One Rust binary, `herdr-chat`, dispatched by subcommand (clap). It reimplements no chat logic: it shells `rt` (chat and pane data, and `rt pane send` for injection), shells `herdr` through `HERDR_BIN_PATH` (pane focus, snapshot, popup open), and reads deck's loopback HTTP API for the viewer URL. Interactive subcommands draw ratatui popups themed to match herdr; the rest are argv glue. Durable state (per-repo sign-in preference, recent broadcasts, the pending-panes handoff) lives under `HERDR_PLUGIN_STATE_DIR`.

**Tech Stack:** Rust (edition 2021), ratatui 0.30 + crossterm 0.29 (herdr's exact versions, so the popups can borrow its look), clap 4 (derive), serde/serde_json, ureq (a tiny blocking HTTP client for deck's loopback call), `std::process::Command` for `rt`/`herdr`. Test with `cargo test` and injected command runners (no real daemon).

**Spec:** `docs/superpowers/specs/2026-08-27-herdr-chat-design.md` (this repo).

**Depends on:** part 1 (`2026-08-27-herdr-chat-1-rt.md`) having landed `rt pane send` on rt's `main`, and the invite feature's `rt pane list` / `rt chat rooms|buddies`. The plugin consumes these as CLI contracts (JSON on stdout), not as imported code.

## Global Constraints

- Work in a worktree of this repo (branch `spec/herdr-chat-plugin` off `main`), never the main checkout.
- **macOS only** for v1: `open` for the viewer, deck's loopback API, herdr's default socket. `platforms = ["macos"]`. No Linux/Windows branches.
- Pin ratatui `0.30` and crossterm `0.29` to match herdr, so theme values and widget behavior line up.
- Call herdr only through `HERDR_BIN_PATH` (fall back to `herdr` on `PATH` when unset); never hardcode the socket. Call `rt` through `RT_BIN_PATH` if set, else `rt` on `PATH`.
- **The scrub rule:** every subcommand that deliberately targets the focused pane (`sign-in`, `sign-out`, and `on-agent-detected`'s `always` inject) removes `HERDR_PANE_ID` from the `rt` child's environment, so rt's caller-own-pane refusal does not fire. The popups (`broadcast`, `peek`, `quick-send`, `signin-ask`) receive no `HERDR_PANE_ID` and need no scrub.
- Never write user state under `HERDR_PLUGIN_ROOT` (a managed checkout); durable state is `HERDR_PLUGIN_STATE_DIR`, config is `HERDR_PLUGIN_CONFIG_DIR`.
- Every subprocess call goes through one injectable runner (`Runner` trait) so tests never spawn `rt`/`herdr`/`open`.
- No em dashes or en dashes in code, comments, docs, or commit messages. Comments only for constraints the code cannot show.
- `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` clean before every commit. Commit after every task with a short imperative message.

---

### Task 1: cargo scaffold, the `Runner` seam, and `open-viewer`

The smallest end-to-end slice: a binary that dispatches subcommands, a testable subprocess seam, and the one subcommand with no UI and no state, proving the plugin builds, links, and runs an action.

**Files:**
- Create: `Cargo.toml`, `src/main.rs`, `src/run.rs` (the `Runner` seam), `src/deck.rs`, `src/cmd/open_viewer.rs`
- Create: `herdr-plugin.toml` (manifest, with only the `open-viewer` action for now)
- Test: unit tests inline in `src/deck.rs` and `src/cmd/open_viewer.rs`

**Interfaces:**
- Produces:

```rust
// src/run.rs
pub struct Output { pub status: i32, pub stdout: String, pub stderr: String }
pub trait Runner: Send + Sync {
    /// Run argv with an optional env overlay; None values in `env` UNSET that var (the scrub).
    fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output>;
}
pub struct RealRunner;               // std::process::Command
pub fn rt_bin() -> String;           // RT_BIN_PATH else "rt"
pub fn herdr_bin() -> String;        // HERDR_BIN_PATH else "herdr"

// src/deck.rs
pub fn viewer_url(deck: &dyn Fn() -> Result<String, String>, setting: &dyn Fn() -> Option<String>) -> Result<String, String>; // deck returns a resolved URL string; viewer_url does no parsing
pub fn row_url_from_json(body: &str) -> Option<String>; // pure: pull row.url from an /api/v1/apps/<svc> response body
```

- [ ] **Step 1: Scaffold the crate**

Create `Cargo.toml`:

```toml
[package]
name = "herdr-chat"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "herdr-chat"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ratatui = "0.30"
crossterm = "0.29"
ureq = { version = "2", default-features = false }
```

Create `src/main.rs` with a clap dispatcher naming every subcommand this plan adds (later tasks fill in the bodies):

```rust
use clap::{Parser, Subcommand};

mod run;
mod deck;
mod cmd { pub mod open_viewer; }

#[derive(Parser)]
#[command(name = "herdr-chat")]
struct Cli { #[command(subcommand)] cmd: Cmd }

#[derive(Subcommand)]
enum Cmd {
    /// Open the chat web viewer (deck-sourced URL).
    OpenViewer { #[arg(long)] room: Option<String> },
}

fn main() -> std::process::ExitCode {
    let runner = run::RealRunner;
    match Cli::parse().cmd {
        Cmd::OpenViewer { room } => cmd::open_viewer::run(&runner, room.as_deref()),
    }
}
```

- [ ] **Step 2: Write the `Runner` seam**

Create `src/run.rs` with `RealRunner` using `std::process::Command`, applying the env overlay (a `Some` sets, a `None` calls `.env_remove`). Add `rt_bin()`/`herdr_bin()`.

- [ ] **Step 3: Write the failing deck test**

In `src/deck.rs`, write the pure `viewer_url` (returns `deck()` if it is `Ok`, else `setting()`, else an error... no IO and no JSON parsing) and the pure `row_url_from_json` parser, plus tests. All IO (running `deck url chat`, reading `api.json`, the HTTP GET) lives in the non-test `viewer_url_real` in Step 4, so the closures keep the tests IO-free:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefers_deck_url() {
        let got = viewer_url(&|| Ok("https://chat.mattstack".into()), &|| None);
        assert_eq!(got.unwrap(), "https://chat.mattstack");
    }
    #[test]
    fn falls_back_to_setting_when_deck_fails() {
        let got = viewer_url(&|| Err("no deck".into()), &|| Some("https://chat.mattstack".into()));
        assert_eq!(got.unwrap(), "https://chat.mattstack");
    }
    #[test]
    fn errors_when_both_fail() {
        assert!(viewer_url(&|| Err("x".into()), &|| None).is_err());
    }
    #[test]
    fn row_url_from_json_pulls_the_field() {
        assert_eq!(row_url_from_json(r#"{"row":{"url":"https://chat.mattstack","published":false}}"#), Some("https://chat.mattstack".into()));
        assert_eq!(row_url_from_json(r#"{"error":"unknown app"}"#), None);
    }
}
```

- [ ] **Step 4: Implement `viewer_url` and the real IO wrapper**

`viewer_url` just picks `deck()` else `setting()`; the parsing lives in `row_url_from_json`. Add a non-test `viewer_url_real()` whose `deck` closure runs `deck url chat` (part 3) and returns its trimmed stdout URL, and, if that verb is absent or fails, reads `api.json`'s port, `ureq::get(...).call()`s `/api/v1/apps/chat`, and passes the body through `row_url_from_json`. The `setting` closure runs `rt settings get chat.viewerUrl` (confirm the exact settings command). `published`/`publicUrl` parsing stays available for a later shareable-URL path; open-viewer uses `row.url`.

- [ ] **Step 5: Implement `open-viewer`**

In `src/cmd/open_viewer.rs`, resolve the URL (append `/r/<room>` when `room` is given), then `runner.run(&["open", &url], &[])`. Return `ExitCode::SUCCESS` on a 0 status. Test with a fake `Runner` that records the argv and asserts `open https://chat.mattstack` (and the `/r/build` suffix when a room is passed).

- [ ] **Step 6: Write the manifest (open-viewer only)**

Create `herdr-plugin.toml`:

```toml
id = "m4ttstack.chat"
name = "Chat"
version = "0.1.0"
min_herdr_version = "0.8.2"
description = "rt chat where the agents live: broadcast, presence, jump-to-pane"
platforms = ["macos"]

[[build]]
command = ["cargo", "build", "--release"]

[[actions]]
id = "open-viewer"
title = "Open chat viewer"
contexts = ["workspace"]
command = ["target/release/herdr-chat", "open-viewer"]
```

- [ ] **Step 7: Build, test, and prove it links**

Run: `cargo build --release && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Then, against a real herdr: `herdr plugin link "$PWD"` and `herdr plugin action list --plugin m4ttstack.chat` shows `open-viewer`. (If herdr is not running, note it; the link step is verified during the real-run task.)

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock src herdr-plugin.toml
git commit -m "scaffold herdr-chat: runner seam, deck viewer-url resolver, open-viewer"
```

---

### Task 2: the `rt` client (`src/rt.rs`)

Typed wrappers over `rt ... --json`, so every later subcommand parses rt once, in one place.

**Files:**
- Create: `src/rt.rs`
- Modify: `src/main.rs` (`mod rt;`)
- Test: inline in `src/rt.rs`

**Interfaces:**
- Produces:

```rust
#[derive(serde::Deserialize, Clone)]
pub struct Presence { pub handle: String, pub status: String, pub rooms: Vec<String> }
#[derive(serde::Deserialize, Clone)]
pub struct ChatPane {
    #[serde(rename = "paneId")] pub pane_id: String,
    pub workspace: String,
    pub title: Option<String>, pub cwd: Option<String>, pub repo: Option<String>, pub branch: Option<String>,
    #[serde(rename = "agentStatus")] pub agent_status: String,
    #[serde(rename = "sessionId")] pub session_id: Option<String>,
    pub presence: Option<Presence>,
}
#[derive(serde::Deserialize, Clone)]
pub struct Room { pub room: String, #[serde(default)] pub unread: u32, #[serde(default)] pub mentions: u32 }
#[derive(serde::Deserialize, Clone)]
pub struct Buddy { pub handle: String, pub status: String, #[serde(default)] pub pane: Option<String>, #[serde(default)] pub rooms: Vec<String> }
#[derive(serde::Deserialize)]
pub struct SendResult { #[serde(rename = "paneId")] pub pane_id: String, pub delivered: String, #[serde(default)] pub reason: Option<String> }

pub fn pane_list(r: &dyn Runner) -> Result<Vec<ChatPane>, String>;
pub fn rooms(r: &dyn Runner) -> Result<Vec<Room>, String>;
pub fn buddies(r: &dyn Runner) -> Result<Vec<Buddy>, String>;
/// scrub=true removes HERDR_PANE_ID from the child env (deliberate self-target).
pub fn pane_send(r: &dyn Runner, pane: &str, text: &str, scrub: bool) -> Result<SendResult, String>;
pub fn post(r: &dyn Runner, room: &str, body: &str) -> Result<(), String>;
pub fn dm(r: &dyn Runner, to: &str, body: &str) -> Result<(), String>;
```

- [ ] **Step 1: Write failing tests with a fake runner**

Inline in `src/rt.rs`, add a `FakeRunner` that maps argv prefixes to canned `Output`, then:

```rust
#[test]
fn pane_list_parses_the_json_rows() {
    let r = FakeRunner::json("pane list", r#"{"panes":[{"paneId":"w1:p1","workspace":"acme","agentStatus":"idle","presence":{"handle":"meg","status":"live","rooms":["build"]}}]}"#);
    let panes = pane_list(&r).unwrap();
    assert_eq!(panes[0].pane_id, "w1:p1");
    assert_eq!(panes[0].presence.as_ref().unwrap().handle, "meg");
}

#[test]
fn pane_send_scrub_unsets_herdr_pane_id() {
    let r = FakeRunner::capture(r#"{"paneId":"w1:p2","delivered":"accepted"}"#);
    pane_send(&r, "w1:p2", "hi", true).unwrap();
    let call = r.last();
    assert!(call.env.iter().any(|(k, v)| *k == "HERDR_PANE_ID" && v.is_none()));
    assert_eq!(call.argv, vec!["rt", "pane", "send", "w1:p2", "--text", "hi"]);
}

#[test]
fn pane_send_delivers_multiline_text_via_stdin_or_arg() {
    // the CLI accepts --text - to read stdin; assert the chosen contract here
    let r = FakeRunner::capture(r#"{"paneId":"w1:p2","delivered":"queued"}"#);
    let out = pane_send(&r, "w1:p2", "line one\nline two", false).unwrap();
    assert_eq!(out.delivered, "queued");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test rt::` (expected: does not compile, `pane_list` not found).

- [ ] **Step 3: Implement the wrappers**

Each wrapper builds argv (e.g. `["rt","pane","list","--json"]`), runs it, parses stdout with serde, maps a non-zero status or a parse error to `Err(stderr-or-message)`. `pane_send` passes the text via `--text` and, for multi-line, either a temp mechanism or the CLI's `--text -` stdin contract chosen in part 1 Task 3; the scrub adds `("HERDR_PANE_ID", None)` to the env overlay.

- [ ] **Step 4: Run tests; clippy; fmt**

Run: `cargo test rt:: && cargo clippy --all-targets -- -D warnings && cargo fmt --check`

- [ ] **Step 5: Commit**

```bash
git add src/rt.rs src/main.rs
git commit -m "rt client: typed pane_list/rooms/buddies/pane_send/post/dm with a scrub option"
```

---

### Task 3: the `herdr` client (`src/herdr.rs`)

What jump-to-pane and the popup-opening need from herdr, through `HERDR_BIN_PATH`.

**Files:**
- Create: `src/herdr.rs`
- Test: inline

**Interfaces:**
- Produces:

```rust
pub struct PaneLoc { pub workspace_id: String, pub tab_id: String }
/// Find a pane in the herdr snapshot: its workspace and tab.
pub fn locate_pane(r: &dyn Runner, pane_id: &str) -> Result<Option<PaneLoc>, String>;
/// Focus workspace + tab, then zoom the pane by id. herdr has no focus-by-id verb.
pub fn focus_pane(r: &dyn Runner, pane_id: &str) -> Result<bool, String>;
/// Open a plugin popup pane entrypoint.
pub fn open_popup(r: &dyn Runner, entrypoint: &str) -> Result<(), String>;
```

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn focus_pane_walks_snapshot_then_zooms() {
    let r = FakeRunner::script(&[
        ("snapshot", r#"{"snapshot":{"panes":[{"pane_id":"w1:p2","workspace_id":"w1","tab_id":"w1:t1"}]}}"#),
        ("workspace", "{}"), ("tab", "{}"), ("pane", "{}"),
    ]);
    assert!(focus_pane(&r, "w1:p2").unwrap());
    let methods = r.argvs();
    assert!(methods.iter().any(|a| a.contains(&"zoom".to_string())));
}

#[test]
fn focus_pane_is_false_when_pane_absent() {
    let r = FakeRunner::json("snapshot", r#"{"snapshot":{"panes":[]}}"#);
    assert_eq!(focus_pane(&r, "w9:p9").unwrap(), false);
}
```

- [ ] **Step 2 to 4: Implement and verify**

`locate_pane` runs `herdr session snapshot --json` (confirm the exact verb/flag against the installed herdr; the invite feature already speaks `session.snapshot`), finds the pane, returns its workspace/tab. `focus_pane` calls `herdr workspace focus <ws>`, `herdr tab focus <tab>`, `herdr pane zoom <pane>` (confirm verb spellings; adjust to the herdr CLI reference). `open_popup` runs `herdr plugin pane open --plugin m4ttstack.chat --entrypoint <entrypoint>`. Test, clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/herdr.rs src/main.rs
git commit -m "herdr client: locate_pane, focus_pane (snapshot -> focus -> zoom), open_popup"
```

---

### Task 4: plugin state (`src/state.rs`)

Per-repo sign-in preference, the pending-panes handoff, recent broadcasts. All JSON files under `HERDR_PLUGIN_STATE_DIR`.

**Files:**
- Create: `src/state.rs`
- Test: inline (each test points `state_dir` at a `tempfile::TempDir`)

**Interfaces:**
- Produces:

```rust
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Clone, Copy)]
pub enum SigninPref { Ask, Always, Never }
pub fn get_pref(dir: &Path, repo: &str) -> SigninPref;              // default Ask
pub fn set_pref(dir: &Path, repo: &str, pref: SigninPref) -> std::io::Result<()>;

pub fn push_pending(dir: &Path, pane_id: &str) -> std::io::Result<()>;
pub fn drain_pending(dir: &Path) -> std::io::Result<Vec<String>>;    // returns and clears

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Broadcast { pub at: i64, pub message: String, pub recipients: Vec<Recipient> }
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Recipient { pub pane_id: String, pub handle: Option<String>, pub delivered: String }
pub fn push_broadcast(dir: &Path, b: &Broadcast) -> std::io::Result<()>; // capped at 50, newest first
pub fn recent_broadcasts(dir: &Path) -> Vec<Broadcast>;
pub fn state_dir() -> PathBuf;                                       // HERDR_PLUGIN_STATE_DIR
```

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn pref_round_trips_per_repo_and_defaults_to_ask() {
    let d = tempfile::tempdir().unwrap();
    assert_eq!(get_pref(d.path(), "chat"), SigninPref::Ask);
    set_pref(d.path(), "chat", SigninPref::Always).unwrap();
    assert_eq!(get_pref(d.path(), "chat"), SigninPref::Always);
    assert_eq!(get_pref(d.path(), "other"), SigninPref::Ask);
}
#[test]
fn pending_drains_and_clears() {
    let d = tempfile::tempdir().unwrap();
    push_pending(d.path(), "w1:p1").unwrap();
    push_pending(d.path(), "w1:p2").unwrap();
    assert_eq!(drain_pending(d.path()).unwrap(), vec!["w1:p1", "w1:p2"]);
    assert!(drain_pending(d.path()).unwrap().is_empty());
}
#[test]
fn broadcasts_cap_at_fifty_newest_first() {
    let d = tempfile::tempdir().unwrap();
    for i in 0..60 { push_broadcast(d.path(), &Broadcast{ at: i, message: i.to_string(), recipients: vec![] }).unwrap(); }
    let r = recent_broadcasts(d.path());
    assert_eq!(r.len(), 50);
    assert_eq!(r[0].message, "59");
}
```

- [ ] **Step 2 to 4: Implement and verify.** Add `tempfile` as a dev-dependency. Reads tolerate a missing or malformed file by returning the default/empty value (never panic). Test, clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/state.rs src/main.rs Cargo.toml Cargo.lock
git commit -m "state: per-repo sign-in prefs, pending-panes handoff, recent broadcasts"
```

---

### Task 5: the theme reader (`src/theme.rs`) [investigation + implementation]

The spec's designated first unknown: how to read herdr's active theme so the popups match it, with a fallback palette when it cannot be read. This task both resolves the read path and implements it.

**Files:**
- Create: `src/theme.rs`
- Test: inline

**Interfaces:**
- Produces:

```rust
pub struct AppTheme {
    pub base: ratatui::style::Style,
    pub selected: ratatui::style::Style,
    pub border: ratatui::style::Style,
    pub dim: ratatui::style::Style,
    pub accent: ratatui::style::Style,
}
pub fn load() -> AppTheme;              // reads herdr's theme, else fallback()
pub fn fallback() -> AppTheme;          // legible in light and dark
pub fn from_herdr_config(toml: &str) -> Option<AppTheme>; // pure parse, unit-tested
```

- [ ] **Step 1: Resolve the read path (investigation, record the finding in the commit body)**

Inspect herdr's theme surface (`src/config/theme.rs`, `src/app/theme_sync.rs`, and the `herdr` CLI reference): determine whether the active theme is readable from a config file under `~/.config/herdr` or via a `herdr` CLI/socket query. Pick the read path; note in the commit body which it is and whether it tracks live theme changes or is read once at launch.

- [ ] **Step 2: Failing tests for the pure parse and the fallback**

```rust
#[test]
fn fallback_is_usable() {
    let t = fallback();
    assert!(t.selected != t.base); // selection is visibly distinct
}
#[test]
fn parses_a_herdr_theme_into_styles() {
    // sample string matches the format resolved in Step 1
    let t = from_herdr_config(SAMPLE_HERDR_THEME).expect("parse");
    assert!(t.accent != t.base);
}
```

- [ ] **Step 3 to 4: Implement `from_herdr_config` (pure), `load` (IO + fallback), `fallback`.** `load` reads the resolved source; any failure returns `fallback()`. Test, clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/theme.rs src/main.rs
git commit -m "theme: read herdr's active theme with a fallback palette

Read path: <config file at ... | herdr <verb>>; <tracks live | read at launch>."
```

---

### Task 6: `sign-in` / `sign-out`

**Files:**
- Create: `src/cmd/sign.rs`
- Modify: `src/main.rs` (subcommands `sign-in`, `sign-out`), `herdr-plugin.toml` (two `[[actions]]`, `contexts = ["pane"]`)
- Test: inline

**Interfaces:**
- Consumes: `rt::pane_send` with `scrub = true`; `HERDR_PANE_ID` from env as the target pane.

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn sign_in_injects_the_slash_command_into_the_focused_pane_scrubbed() {
    let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
    sign::run_with(&r, Sign::In, Some("w1:p1")).unwrap();
    let call = r.last();
    assert_eq!(call.argv, vec!["rt","pane","send","w1:p1","--text","/chat:sign-in"]);
    assert!(call.env.iter().any(|(k,v)| *k=="HERDR_PANE_ID" && v.is_none()));
}
#[test]
fn sign_in_without_a_pane_is_a_clear_error() {
    let r = FakeRunner::capture("{}");
    assert!(sign::run_with(&r, Sign::In, None).is_err());
}
```

- [ ] **Step 2 to 4: Implement.** `run_with(runner, which, pane)` errors when `pane` is `None`; otherwise `rt::pane_send(r, pane, cmd, /*scrub*/ true)` where `cmd` is `/chat:sign-in` or the sign-out command (confirm the exact sign-out slash command in the chat plugin; the away/sign-out skill name). `run(runner)` reads `HERDR_PANE_ID`. Add the two `[[actions]]` with `contexts = ["pane"]`. Test, clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/sign.rs src/main.rs herdr-plugin.toml
git commit -m "sign-in/sign-out: inject into the focused pane, HERDR_PANE_ID scrubbed"
```

---

### Task 7: `on-agent-detected` + the `signin-ask` popup

**Files:**
- Create: `src/cmd/detect.rs`, `src/cmd/signin_ask.rs`, `src/ui.rs` (shared popup event-loop scaffolding)
- Modify: `src/main.rs` (`on-agent-detected`, `signin-ask`), `herdr-plugin.toml` (`[[events]]` + `[[panes]] signin-ask`)
- Test: inline

**Interfaces:**
- Produces (ui): `pub fn popup<F>(theme: &AppTheme, draw_and_handle: F) -> io::Result<()>` (raw mode, alt screen, crossterm event loop, restores on exit) that later popups reuse.
- Consumes: `state` (pref, pending), `rt::pane_send` (scrub), the event JSON in `HERDR_PLUGIN_EVENT_JSON`.

- [ ] **Step 1: Failing tests for the routing logic (pure, no TUI)**

```rust
#[test]
fn always_injects_scrubbed_and_never_exits() {
    let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
    let d = tempfile::tempdir().unwrap();
    detect::decide(&r, d.path(), "chat", "w1:p1").unwrap(); // pref=Ask by default -> pending
    assert_eq!(state::drain_pending(d.path()).unwrap(), vec!["w1:p1"]);

    state::set_pref(d.path(), "chat", SigninPref::Always).unwrap();
    detect::decide(&r, d.path(), "chat", "w1:p2").unwrap();
    assert_eq!(r.last().argv, vec!["rt","pane","send","w1:p2","--text","/chat:sign-in"]);

    state::set_pref(d.path(), "chat", SigninPref::Never).unwrap();
    detect::decide(&FakeRunner::capture("{}"), d.path(), "chat", "w1:p3").unwrap(); // no call, no pending
}
```

- [ ] **Step 2 to 4: Implement.** `detect::run` parses `HERDR_PLUGIN_EVENT_JSON` for the pane id, derives the repo from the pane's cwd (via `rt::pane_list` matched on pane id, or `herdr` snapshot cwd), then `decide(runner, state_dir, repo, pane)`: `Never` returns; `Always` injects scrubbed; `Ask` calls `state::push_pending` then `herdr::open_popup("signin-ask")` and, on `ui_busy`, leaves the pane pending (the open popup drains it). `signin_ask::run` opens the popup: drains all pending panes, presents yes / always / never / skip, injects the yeses (scrubbed), persists `always`/`never` per repo, and drains once more just before exit so a pane appended after the last drain is not stranded. Add `[[events]] on = "pane.agent_detected"` and the `signin-ask` `[[panes]]` popup. Test the pure `decide`; the TUI is covered in the real-run task.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/detect.rs src/cmd/signin_ask.rs src/ui.rs src/main.rs herdr-plugin.toml
git commit -m "prompt-on-start: on-agent-detected + signin-ask popup, pending-file handoff and coalescing"
```

---

### Task 8: the shared pane picker (`src/cmd/picker.rs`)

A ratatui list over `rt::pane_list`: grouped by repo, text filter, select-all-online, multi-select. Broadcast and (its jump action) reuse it.

**Files:**
- Create: `src/cmd/picker.rs`
- Test: inline (the pure model: grouping, filter, select-all-online, toggle)

**Interfaces:**
- Produces:

```rust
pub struct PickerModel { /* panes, filter string, selected set, cursor */ }
impl PickerModel {
    pub fn new(panes: Vec<rt::ChatPane>) -> Self;
    pub fn grouped(&self) -> Vec<(String /*repo*/, Vec<&rt::ChatPane>)>; // filtered + grouped
    pub fn set_filter(&mut self, q: &str);
    pub fn select_all_online(&mut self);      // every pane whose presence.status == "live"
    pub fn toggle(&mut self, pane_id: &str);
    pub fn selected(&self) -> Vec<String>;
}
/// Runs the picker popup to completion; returns the chosen pane ids, or None on cancel.
pub fn pick(theme: &AppTheme, panes: Vec<rt::ChatPane>) -> io::Result<Option<Vec<String>>>;
```

- [ ] **Step 1: Failing tests on the model**

```rust
#[test]
fn groups_by_repo_and_filters_by_text() {
    let m = PickerModel::new(vec![pane("w1:p1","chat","meg"), pane("w1:p2","rt","fred")]);
    m_set(&m, "fred"); // helper mutates a clone
    let g = /* filtered */;
    assert_eq!(g.len(), 1);
}
#[test]
fn select_all_online_picks_only_live_presence() {
    let mut m = PickerModel::new(vec![live("w1:p1"), offline_pane("w1:p2"), unsigned("w1:p3")]);
    m.select_all_online();
    assert_eq!(m.selected(), vec!["w1:p1"]);
}
```

- [ ] **Step 2 to 4: Implement the model and the ratatui view.** The view renders repo group headers, a row per pane (status dot, handle or `not signed in`, workspace, title, `repo . branch`, path as `.../leaf`), a checkbox, the filter line, and a themed footer of keyhints (space toggles, `a` select-all-online, `/` filter, enter confirm, esc cancel). Style with `AppTheme`. Test the model; view is exercised in real runs. Clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/picker.rs src/main.rs
git commit -m "picker: grouped, filterable, multi-select pane list over rt pane list"
```

---

### Task 9: `broadcast`

**Files:**
- Create: `src/cmd/broadcast.rs`
- Modify: `src/main.rs` (`broadcast`), `herdr-plugin.toml` (`[[actions]] broadcast`, `[[panes]] broadcast-ui`)
- Test: inline (the fan-out + results aggregation, pure)

**Interfaces:**
- Consumes: `picker::pick`, `rt::pane_send` (no scrub; a popup carries no `HERDR_PANE_ID`), `state::push_broadcast`.
- Produces: `pub fn fan_out(r: &dyn Runner, panes: &[String], message: &str) -> Vec<rt::SendResult>` and a `summary(results) -> String` (`broadcast to 5 . 3 accepted . 2 queued . 0 refused`).

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn fan_out_sends_to_each_and_summarizes() {
    let r = FakeRunner::sequence(&[
        r#"{"paneId":"w1:p1","delivered":"accepted"}"#,
        r#"{"paneId":"w1:p2","delivered":"queued"}"#,
    ]);
    let res = broadcast::fan_out(&r, &["w1:p1".into(),"w1:p2".into()], "standup in 5");
    assert_eq!(broadcast::summary(&res), "broadcast to 2 . 1 accepted . 1 queued . 0 refused");
}
```

- [ ] **Step 2 to 4: Implement.** The popup: a message textarea, then the picker (or the picker then message), then `fan_out` sequentially, then the results line, then `state::push_broadcast` with a recipient snapshot. A "recent" view lists `state::recent_broadcasts` and can re-open one (repopulate the message, preselect panes still present). Add the `broadcast` action and `broadcast-ui` popup pane. Test the pure `fan_out`/`summary`. Clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/broadcast.rs src/main.rs herdr-plugin.toml
git commit -m "broadcast: pick panes, inject a message, summarize, record"
```

---

### Task 10: `peek` + `jump`

**Files:**
- Create: `src/cmd/peek.rs`, `src/cmd/jump.rs`
- Modify: `src/main.rs` (`peek`, `jump`), `herdr-plugin.toml` (`[[actions]] peek`, `[[panes]] peek-ui`)
- Test: inline

**Interfaces:**
- Produces (peek model): merges `rt::buddies` (who is online) with `rt::rooms` (unread/mentions for me) into rows sorted most-recent-first; each row exposes jump / broadcast / quick-send / open-in-viewer.
- Produces (jump): `pub fn jump_to(r: &dyn Runner, handle: &str, panes: &[rt::ChatPane]) -> Result<bool, String>` (handle -> paneId via presence -> `herdr::focus_pane`).

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn jump_maps_handle_to_pane_and_focuses() {
    let panes = vec![with_presence("w1:p2","fred")];
    let r = FakeRunner::script(&[("snapshot", r#"{"snapshot":{"panes":[{"pane_id":"w1:p2","workspace_id":"w1","tab_id":"w1:t1"}]}}"#),("workspace","{}"),("tab","{}"),("pane","{}")]);
    assert!(jump::jump_to(&r, "fred", &panes).unwrap());
}
#[test]
fn jump_is_false_for_a_buddy_with_no_local_pane() {
    let r = FakeRunner::capture("{}");
    assert_eq!(jump::jump_to(&r, "ghost", &[]).unwrap(), false);
}
#[test]
fn peek_rows_carry_unread_from_rooms() {
    let rows = peek::rows(vec![buddy("fred","live")], vec![room("build", 3, 1)]);
    assert_eq!(rows.iter().map(|r| r.unread).sum::<u32>(), 3);
}
```

- [ ] **Step 2 to 4: Implement.** `peek::rows` is the pure merge; the popup renders it as a launcher (no message bodies) and dispatches the row action: jump (`jump::jump_to`, closing the popup first via herdr if needed), broadcast (open the broadcast popup), quick-send (Task 11), open-in-viewer (`open-viewer --room`). Add the `peek` action and `peek-ui` popup. Test the pure merge and jump. Clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/peek.rs src/cmd/jump.rs src/main.rs herdr-plugin.toml
git commit -m "peek + jump: online/unread launcher, handle -> pane focus"
```

---

### Task 11: `quick-send`

**Files:**
- Create: `src/cmd/quick_send.rs`
- Modify: `src/main.rs` (`quick-send`), `herdr-plugin.toml` (`[[actions]] quick-send`, `[[panes]] quick-send-ui`)
- Test: inline

**Interfaces:**
- Consumes: `rt::rooms` + `rt::buddies` for the target list; `rt::post` for a room target, `rt::dm` for a buddy target.
- Produces: `pub fn send(r: &dyn Runner, target: Target, line: &str) -> Result<(), String>` where `Target::Room(String) | Target::Dm(String)`.

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn quick_send_routes_room_vs_dm() {
    let r = FakeRunner::capture("{}");
    quick_send::send(&r, Target::Room("build".into()), "on it").unwrap();
    assert_eq!(r.calls()[0].argv, vec!["rt","chat","post","build","on it"]);
    quick_send::send(&r, Target::Dm("fred".into()), "ping").unwrap();
    assert_eq!(r.calls()[1].argv, vec!["rt","chat","dm","fred","ping"]);
}
```

(Confirm the exact `rt chat post` / `rt chat dm` argv against rt; adjust if the body is a flag rather than positional.)

- [ ] **Step 2 to 4: Implement.** The popup shows a target list (recent rooms first, then buddies) and a one-line input; enter sends via `send`. Add the action and popup pane. Test the pure `send`. Clippy, fmt.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/quick_send.rs src/main.rs herdr-plugin.toml
git commit -m "quick-send: one line to a room or DM"
```

---

### Task 12: finalize the manifest, keybindings doc, and real-run verification

**Files:**
- Modify: `herdr-plugin.toml` (confirm every action/pane/event is present and valid), `README.md` (the keybinding install step and the install command)

- [ ] **Step 1: Validate the manifest**

Run: `herdr plugin link "$PWD"` then `herdr plugin action list --plugin m4ttstack.chat`.
Expected: `broadcast`, `peek`, `quick-send`, `sign-in`, `sign-out`, `open-viewer` all listed; no manifest validation warnings. (Recall keybindings are NOT in the manifest.)

- [ ] **Step 2: Document keybindings as a user-config step**

In `README.md`, add an "Install" section: `herdr plugin install m4ttstack/herdr-chat`, then the user adds to their herdr keys config:

```toml
[[keys.command]]
key = "prefix+b"
type = "plugin_action"
command = "m4ttstack.chat.broadcast"
description = "broadcast to panes"

[[keys.command]]
key = "prefix+c"
type = "plugin_action"
command = "m4ttstack.chat.peek"
description = "chat peek"
```

- [ ] **Step 3: Real-run the flows (each once, against real herdr + rt + deck)**

- `open-viewer` opens `https://chat.mattstack`.
- Detect: start a Claude pane in an `ask` repo, confirm the `signin-ask` popup, choose `always`, confirm a second new pane signs in with no prompt.
- Broadcast to two panes (one idle, one working): idle accepts, working queues; the results line and the recent list are correct.
- Jump from a peek row to a buddy's pane focuses it.
- Quick-send a line to a room; confirm it lands in the viewer.

Record the outcomes in the commit body.

- [ ] **Step 4: Commit**

```bash
git add herdr-plugin.toml README.md
git commit -m "finalize manifest + keybinding install doc; real-run verification"
```

---

## Self-review

- **Spec coverage:** open-viewer (T1) + deck resolver (T1); rt client (T2); herdr client / jump path (T3, T10); state incl. prefs/pending/recent (T4); theme read + fallback (T5); sign-in/out with scrub (T6); prompt-on-start with pending-file handoff and coalescing (T7); picker with repo-group/filter/select-all-online (T8); broadcast fan-out + record (T9); peek launcher + jump (T10); quick-send room/DM routing (T11); manifest + keybinding-as-user-config + real runs (T12). The scrub rule is exercised in T2, T6, T7.
- **Placeholders:** the two remaining "confirm against the installed herdr/rt" notes (herdr verb spellings in T3, the `rt chat post/dm` argv in T11, the sign-out slash command in T6) are interface confirmations against real CLIs, resolved at execution, not deferred design. T5 is a spike-then-build task with a guaranteed fallback output, not a placeholder.
- **Type consistency:** `rt::SendResult`/`rt::ChatPane` are the shapes every subcommand consumes; `delivered` is the `"accepted"|"queued"|"refused"` string from part 1. `AppTheme` is produced by T5 and consumed by every popup (T7-T11). `PickerModel.selected() -> Vec<String>` feeds `broadcast::fan_out(panes: &[String], ...)`.

## Execution handoff

This plan and part 1 both run only after the invite feature merges to `main` and part 1's `rt pane send` lands. Order: part 1 (rt) first, then part 2 (this plan). Execute with superpowers:subagent-driven-development, a fresh subagent per task with review between tasks, in a worktree of this repo.
