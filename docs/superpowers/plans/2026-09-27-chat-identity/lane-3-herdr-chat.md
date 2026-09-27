# Lane 3: herdr-chat (chat identity)

> **Shepherd ruling (supersedes the CONTRACT ISSUE notes below):** (1) lane 1b adds `name` to `rt chat sign-in --json` (`{ ok, handle, name, room, continued }`); keep the handle fallback. (2) Add `"label"` to every `peek.rooms[]` entry (the room, or `kai ↔ remy` from participant names for a DM room) and a `"labels"` object on `targets` mapping each target string to its display text. Fold both into Tasks 4 and 6 with tests, and into the README contract table. Participant names come from rt's `chat:rooms` `participants.aName`/`bName` (master plan wire contract).

Part of `docs/superpowers/plans/2026-09-27-chat-identity.md` (master plan: constraints, frozen contract, integration). Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

**Repo:** `/Users/matt/Documents/GitHub/herdr-chat` (Rust herdr plugin `m4ttstack.chat`). **Tree:** `/Users/matt/Documents/GitHub/herdr-chat/.worktrees/chat-identity` on branch `chat-identity`. Every command below runs from that tree's root unless it names another path. If this session's worktree guard refuses commands outside its own tree, `/cd` into the herdr-chat worktree first (rt:herdr-inject).

**Goal:** herdr-chat parses rt's new `name` field, keys every action on `handle` (the id), shows `name` everywhere, extends its own `--json` output with `name`, and labels DM rooms by participant names.

## CONTRACT ISSUE notes

1. **`rt chat sign-in --pane <id> --json` stdout.** herdr-chat's launcher reads the CLI's print, which today is `{ ok, handle, room }` (`commands/chat.ts`, `runSignInViaPane`). The frozen contract adds `name` to the daemon's `chat:sign-in` data but never says this CLI print carries it. Lane 1b should print `{ ok, handle, name, room }`. This lane plans against that shape and falls back to `handle` when `name` is absent, so nothing breaks if 1b does not add it; the result line would just show the id for new identities.
2. **DM rooms in herdr-chat's JSON have no display label.** `peek.rooms[].room` and `targets.rooms[]` stay the raw room (`dm-<hash>`) because the caller passes them back (`open-viewer --room`, `quick-send --to '#...'`). The contract adds no label field, so flock will keep showing `dm-<hash>` for DM rooms. herdr-chat's own TUI labels them from rt's `participants`. This lane adds no JSON field; if flock needs one, the shepherd adds it to the contract first.

## Lane constraints

- Everything in the master plan's Global Constraints applies. Those most relevant here:
  - no em or en dashes anywhere;
  - no mattstack ticket ids in herdr-chat code, docs or commits;
  - comments only for constraints the code cannot show;
  - consumers fall back to `handle` when `name` is missing.
- Never rename a key in herdr-chat's JSON output. Only add `name`. Key order is part of the README table: `name` goes right after `handle`.
- Show `name` and act on `handle`. Lookups, map keys, jump, send, sort-stable identity and the broadcast record all use `handle`. Rows, headers and result lines show `name`. A check that the "title equals the identity" compares the title against `name`.
- **The test command.** Inside a herdr pane, herdr exports `HERDR_BIN_PATH`, and five baseline tests then fail on argv assertions. Always run tests like this: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release <filter>`. Baseline on `main` with that unset is 134 passed.
- `cargo fmt --check` and `cargo clippy --release` are clean on `main` and stay clean.

## Review Focus

1. **Old rt.** rt ships without `name` anywhere (or this plugin is installed before lane 1 merges). Every verb must still parse, and every screen and JSON `name` must show the handle. Owners: Task 2 (parse fixtures), Tasks 3 to 7 (a "no name" fixture per surface).
2. **Two identities, one name.** A signed-out `remy.0001` and a live `remy.k3f9` share the name `remy`. `targets.people` must list `@remy` once, and `jump --handle remy` must find the live one. The exception is a legacy id that is exactly `remy`: it wins as an id (item 3), the same as in rt. Owners: Task 5 (`a_name_match_skips_an_identity_that_has_signed_out`), Task 6 (`people_are_listed_once_per_name`).
3. **A typed value that is both an id and a name.** The value is a legacy id and also another identity's display name. `jump` must match the id first, the same order rt's resolver uses. Owner: Task 5 (`an_exact_id_wins_over_another_identitys_display_name`).
4. **An old `broadcasts.json`** written before `Recipient.name` existed. It must still load; if it fails to parse, `push_broadcast` silently replaces the history with an empty list. Owner: Task 7 (`a_history_file_written_before_display_names_still_loads`).
5. **An id leaking onto a screen.** The peek rows, quick-send rows and picker rows must never contain the `.k3f9` suffix, and a title equal to the name must not be repeated. Owners: Tasks 4, 6, 7 (rendered-line tests).

## File map

| File | Change |
|---|---|
| `.gitignore` | ignore `/.worktrees/` |
| `src/rt.rs` | `Presence.name`, `Buddy.name` (`Option`, serde default), `display_name()`, `Participants`, `Room.participants`, `Room::is_dm`, `Room::label` |
| `src/json.rs` | `Status.name`, `PeekBuddy.name`, `Jump.name`; `targets_from` takes `TargetRow`s and prints `@<name>` once per name |
| `src/cmd/launcher.rs` | `OriginStatus.name`, header shows name, sign result reads `{handle, name}`, `status_json` fills `name`, `room_tokens` uses `Room::is_dm` |
| `src/cmd/sign.rs` | test asserts `name` |
| `src/cmd/peek.rs` | `Row.name`, `Row.room_label`; rows show names and DM participant labels; sort on name |
| `src/cmd/jump.rs` | `pane_for` matches id then live name; `Jump` carries id and name |
| `src/main.rs` | `jump --handle` doc text |
| `src/cmd/quick_send.rs` | `TargetRow` public with `label` and `sigil`; rows show names and DM labels; send passes `@x` through |
| `src/cmd/picker.rs` | rows and filter use the name |
| `src/cmd/broadcast.rs` | recipients record `name`; result screen shows it |
| `src/state.rs` | `Recipient.name` with serde default |
| `README.md`, `AGENTS.md` | contract table, "Handles and names" section, module map, gotchas |

---

### Task 1: Worktree and baseline

**Files:**
- Modify: `/Users/matt/Documents/GitHub/herdr-chat/.git/info/exclude` (local, untracked)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the `chat-identity` branch and tree every later task works in.

- [ ] **Step 1: Confirm rt does not manage herdr-chat**

Run: `rt worktree list --json | rg -c herdr-chat`
Expected: `0` or no output. If rt does list herdr-chat, stop, and use EnterWorktree (name-mode, name `chat-identity`) instead of Step 2.

- [ ] **Step 2: Keep the tree out of the main checkout's status, then create it**

```bash
printf '/.worktrees/\n' >> /Users/matt/Documents/GitHub/herdr-chat/.git/info/exclude
git -C /Users/matt/Documents/GitHub/herdr-chat worktree add .worktrees/chat-identity -b chat-identity
```

Expected: `Preparing worktree (new branch 'chat-identity')`. Then `git -C /Users/matt/Documents/GitHub/herdr-chat status --short` prints nothing.

- [ ] **Step 3: Ignore `.worktrees` in the tracked `.gitignore`**

In `.gitignore`, after the line `.DS_Store`, add:

```
/.worktrees/
```

- [ ] **Step 4: Baseline test run**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 134 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "gitignore: keep local worktrees out of the tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parse `name` and DM participants from rt

**Files:**
- Modify: `src/rt.rs` (`Presence` :13-21, `Room` :65-75, `Buddy` :77-89, tests)
- Modify (struct literals only): `src/cmd/jump.rs:101-105`, `src/cmd/peek.rs:394-411` and `:578-582`, `src/cmd/picker.rs:424-430`, `src/cmd/broadcast.rs:573-577`, `src/cmd/launcher.rs:503-511` and `:542-547`, `src/cmd/quick_send.rs:435-454`
- Modify: `src/cmd/launcher.rs:139-154` (`room_tokens`)

**Interfaces:**
- Consumes: rt's `--json` rows. `presence.name`, `buddies[].name`, `rooms[].participants.{a,b,aName,bName}` may be absent.
- Produces:
  - `rt::Presence { handle: String, name: Option<String>, status: String, rooms: Vec<String> }`
  - `rt::Buddy { handle: String, name: Option<String>, status, session_id, pane, rooms }`
  - `rt::Presence::display_name(&self) -> &str` and `rt::Buddy::display_name(&self) -> &str`: the name, else the handle
  - `rt::Participants { a: String, b: String, a_name: Option<String>, b_name: Option<String> }`
  - `rt::Room { room, unread, mentions, kind, participants: Option<Participants> }`
  - `rt::Room::is_dm(&self) -> bool`
  - `rt::Room::label(&self) -> String`: `"<aName> \u{2194} <bName>"` for a DM with participants, else the room

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `src/rt.rs`, before its closing `}`:

```rust
    #[test]
    fn buddies_carry_the_display_name_rt_sends() {
        let r = FakeRunner::json(
            "chat buddies",
            r#"{"ok":true,"buddies":[{"handle":"remy.k3f9","name":"remy","status":"live","pane":"w1:p1"}]}"#,
        );
        let b = &buddies(&r).unwrap()[0];
        assert_eq!(b.handle, "remy.k3f9");
        assert_eq!(b.display_name(), "remy");
    }

    #[test]
    fn a_buddy_from_an_rt_with_no_names_shows_its_handle() {
        let r = FakeRunner::json(
            "chat buddies",
            r#"{"ok":true,"buddies":[{"handle":"meg","status":"live"}]}"#,
        );
        let b = &buddies(&r).unwrap()[0];
        assert_eq!(b.name, None);
        assert_eq!(b.display_name(), "meg");
    }

    #[test]
    fn pane_presence_carries_the_display_name_and_falls_back_without_one() {
        let r = FakeRunner::json(
            "pane list",
            r#"{"panes":[{"paneId":"w1:p1","workspace":"acme","agentStatus":"idle","presence":{"handle":"remy.k3f9","name":"remy","status":"live"}},{"paneId":"w1:p2","workspace":"acme","agentStatus":"idle","presence":{"handle":"meg","status":"idle"}}]}"#,
        );
        let panes = pane_list(&r).unwrap();
        assert_eq!(panes[0].presence.as_ref().unwrap().display_name(), "remy");
        assert_eq!(panes[1].presence.as_ref().unwrap().display_name(), "meg");
    }

    #[test]
    fn an_empty_name_is_treated_as_absent() {
        let r = FakeRunner::json(
            "chat buddies",
            r#"{"ok":true,"buddies":[{"handle":"meg","name":"","status":"live"}]}"#,
        );
        assert_eq!(buddies(&r).unwrap()[0].display_name(), "meg");
    }

    #[test]
    fn a_dm_room_is_labelled_by_its_participants_names() {
        let r = FakeRunner::json(
            "chat rooms",
            r#"{"ok":true,"rooms":[{"room":"dm-3f9a","kind":"dm","participants":{"a":"kai","b":"remy.k3f9","aName":"kai","bName":"remy"}},{"room":"dm-77","kind":"dm","participants":{"a":"kai","b":"meg"}},{"room":"dm-old","kind":"dm"},{"room":"rt"}]}"#,
        );
        let rooms = rooms(&r).unwrap();
        assert_eq!(rooms[0].label(), "kai \u{2194} remy");
        assert_eq!(rooms[1].label(), "kai \u{2194} meg");
        assert_eq!(rooms[2].label(), "dm-old");
        assert!(rooms[2].is_dm());
        assert_eq!(rooms[3].label(), "rt");
        assert!(!rooms[3].is_dm());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release rt::tests`
Expected: compile errors: `no method named display_name`, `no field name`, `no method named label`, `no method named is_dm`.

- [ ] **Step 3: Implement in `src/rt.rs`**

Replace the `Presence` struct (lines 13-21) with:

```rust
#[derive(serde::Deserialize, Clone)]
pub struct Presence {
    pub handle: String,
    #[serde(default)]
    pub name: Option<String>,
    pub status: String,
    // A presence row that ever omits `rooms` must not fail the whole `pane_list`
    // deserialize, which would break picker, broadcast, and detect at once.
    #[serde(default)]
    pub rooms: Vec<String>,
}

impl Presence {
    pub fn display_name(&self) -> &str {
        name_or(&self.name, &self.handle)
    }
}

/// An rt from before display names sends none, and there the handle is the
/// name; an empty string is read the same way.
fn name_or<'a>(name: &'a Option<String>, handle: &'a str) -> &'a str {
    name.as_deref().filter(|n| !n.is_empty()).unwrap_or(handle)
}
```

Replace the `Room` struct (lines 65-75) with:

```rust
/// The two sides of a DM room: ids rt keys on, names a row shows.
#[derive(serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Participants {
    pub a: String,
    pub b: String,
    #[serde(default, rename = "aName")]
    pub a_name: Option<String>,
    #[serde(default, rename = "bName")]
    pub b_name: Option<String>,
}

#[derive(serde::Deserialize, Clone)]
pub struct Room {
    pub room: String,
    #[serde(default)]
    pub unread: u32,
    #[serde(default)]
    pub mentions: u32,
    /// `"dm"` for a direct-message room; older daemons omit the field.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub participants: Option<Participants>,
}

impl Room {
    pub fn is_dm(&self) -> bool {
        self.kind.as_deref() == Some("dm") || self.room.starts_with("dm-")
    }

    /// A DM room's own name is a hash, so a row names it by who is in it
    /// whenever rt sent the participants.
    pub fn label(&self) -> String {
        match &self.participants {
            Some(p) if self.is_dm() => format!(
                "{} \u{2194} {}",
                name_or(&p.a_name, &p.a),
                name_or(&p.b_name, &p.b)
            ),
            _ => self.room.clone(),
        }
    }
}
```

Replace the `Buddy` struct (lines 77-89) with:

```rust
// `rt chat buddies --json` rows are rt-client's `PresenceRow & { status }`,
// which carries no `rooms` field; `default` keeps that absence an empty vec.
#[derive(serde::Deserialize, Clone)]
pub struct Buddy {
    pub handle: String,
    #[serde(default)]
    pub name: Option<String>,
    pub status: String,
    #[serde(default, rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(default)]
    pub pane: Option<String>,
    #[serde(default)]
    pub rooms: Vec<String>,
}

impl Buddy {
    pub fn display_name(&self) -> &str {
        name_or(&self.name, &self.handle)
    }
}
```

- [ ] **Step 4: Fix every struct literal the new fields break**

In each literal below, add the line shown right after the field named.

- `src/cmd/jump.rs` `with_presence`, after `handle: handle.to_string(),` add `name: None,`
- `src/cmd/peek.rs` test `a_buddy_carries_the_pane_it_is_signed_in_on`, after `handle: "kay".to_string(),` add `name: None,`
- `src/cmd/picker.rs` test helper `presence`, after `handle: handle.to_string(),` add `name: None,`
- `src/cmd/broadcast.rs` test helper `chat_pane`, after `handle: h.to_string(),` add `name: None,`
- `src/cmd/launcher.rs` test helper `buddy`, after `handle: handle.to_string(),` add `name: None,`
- `src/cmd/peek.rs` test helper `buddy`, after `handle: handle.to_string(),` add `name: None,`
- `src/cmd/quick_send.rs` test `targets_puts_rooms_before_buddies`, the `rt::Buddy` literal: after `handle: "fred".to_string(),` add `name: None,`
- `src/cmd/launcher.rs` test closure `room` in `room_tokens_hash_channels_and_collapse_dms`, after `kind: kind.map(str::to_string),` add `participants: None,`
- `src/cmd/peek.rs` test helper `room`, after `kind: None,` add `participants: None,`
- `src/cmd/quick_send.rs` test `targets_puts_rooms_before_buddies`, both `rt::Room` literals: after `kind: None,` add `participants: None,`

- [ ] **Step 5: Use `Room::is_dm` in `room_tokens`**

In `src/cmd/launcher.rs` `room_tokens`, replace:

```rust
        let dm = room.kind.as_deref() == Some("dm") || room.room.starts_with("dm-");
        if dm {
```

with:

```rust
        if room.is_dm() {
```

- [ ] **Step 6: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 139 passed; 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add src/rt.rs src/cmd/jump.rs src/cmd/peek.rs src/cmd/picker.rs src/cmd/broadcast.rs src/cmd/launcher.rs src/cmd/quick_send.rs
git commit -m "rt: parse display names and DM participants, falling back to the handle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `status` JSON and the launcher show the name

**Files:**
- Modify: `src/json.rs` (`Status` :15-23, tests :219-251)
- Modify: `src/cmd/launcher.rs` (`OriginStatus` :88-96, `origin_status` :101-109, `status_json` :116-135, `sign_result_text` :225-245, `header` :364-370, tests)
- Modify: `src/cmd/sign.rs` (test `sign_in_json_answers_with_the_header_the_pane_now_has`)

**Interfaces:**
- Consumes: `rt::Buddy::display_name()` (Task 2).
- Produces:
  - `json::Status { handle: Option<String>, name: Option<String>, state, pane, signed_in, rooms }`, printed as `{"handle":..,"name":..,"state":..,"pane":..,"signedIn":..,"rooms":..}`. `name` is null exactly when `handle` is null.
  - `launcher::OriginStatus { pane, handle, name: Option<String>, status, rooms }`.

- [ ] **Step 1: Write the failing tests**

In `src/json.rs` tests, replace `status_serializes_signed_in_as_camel_case` and `a_missing_handle_is_null_rather_than_absent` with:

```rust
    /// `signedIn` is the one field here whose Rust name differs from its wire
    /// name, and the consumer reads the wire name.
    #[test]
    fn status_serializes_signed_in_as_camel_case() {
        let out = serde_json::to_string(&Status {
            handle: Some("kay".to_string()),
            name: Some("kay".to_string()),
            state: "live".to_string(),
            pane: Some("w1:p1".to_string()),
            signed_in: true,
            rooms: vec!["#rt".to_string()],
        })
        .unwrap();
        assert_eq!(
            out,
            r##"{"handle":"kay","name":"kay","state":"live","pane":"w1:p1","signedIn":true,"rooms":["#rt"]}"##
        );
    }

    #[test]
    fn a_missing_handle_is_null_rather_than_absent() {
        let out = serde_json::to_string(&Status {
            handle: None,
            name: None,
            state: "not signed in".to_string(),
            pane: None,
            signed_in: false,
            rooms: Vec::new(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"handle":null,"name":null,"state":"not signed in","pane":null,"signedIn":false,"rooms":[]}"#
        );
    }

    #[test]
    fn status_serializes_the_display_name_beside_the_id() {
        let out = serde_json::to_string(&Status {
            handle: Some("remy.k3f9".to_string()),
            name: Some("remy".to_string()),
            state: "live".to_string(),
            pane: Some("w1:p1".to_string()),
            signed_in: true,
            rooms: Vec::new(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"handle":"remy.k3f9","name":"remy","state":"live","pane":"w1:p1","signedIn":true,"rooms":[]}"#
        );
    }
```

In `src/cmd/launcher.rs` tests, add this helper right after the `buddy` helper:

```rust
    fn named(handle: &str, name: &str, status: &str, pane: Option<&str>) -> rt::Buddy {
        rt::Buddy {
            name: Some(name.to_string()),
            ..buddy(handle, status, pane, None)
        }
    }
```

Add `assert_eq!(s.name, None);` as the last line of `status_json_for_an_unmatched_pane_is_signed_out_with_no_rooms`.

Append these tests inside `mod tests` in `src/cmd/launcher.rs`:

```rust
    #[test]
    fn origin_status_shows_the_display_name_and_keeps_the_id() {
        let s = origin_status(
            Some("w1:p1"),
            &[named("remy.k3f9", "remy", "live", Some("w1:p1"))],
        );
        assert_eq!(s.handle.as_deref(), Some("remy.k3f9"));
        assert_eq!(s.name.as_deref(), Some("remy"));
    }

    #[test]
    fn status_json_reports_the_name_beside_the_id() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"buddies":[{"handle":"remy.k3f9","name":"remy","status":"live","sessionId":"s-remy","pane":"w1:p1"}]}"#,
            r#"{"ok":true,"rooms":[{"room":"rt","unread":0}]}"#,
        ]);
        let s = status_json(&r, Some("w1:p1")).unwrap();
        assert_eq!(s.handle.as_deref(), Some("remy.k3f9"));
        assert_eq!(s.name.as_deref(), Some("remy"));
    }

    #[test]
    fn status_json_names_a_pane_by_its_handle_when_rt_sends_no_name() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"live","sessionId":"s-kay","pane":"w1:p1"}]}"#,
            r#"{"ok":true,"rooms":[]}"#,
        ]);
        let s = status_json(&r, Some("w1:p1")).unwrap();
        assert_eq!(s.name.as_deref(), Some("kay"));
    }

    #[test]
    fn sign_results_name_the_display_name_not_the_id() {
        assert_eq!(
            sign_result_text(
                Item::SignIn,
                r#"{"ok":true,"handle":"remy.k3f9","name":"remy","room":"rt"}"#
            ),
            "signed in as remy \u{b7} joined #rt"
        );
        assert_eq!(
            sign_result_text(Item::SignOut, r#"{"ok":true,"handle":"remy.k3f9","name":"remy"}"#),
            "signed out remy"
        );
    }
```

In `src/cmd/sign.rs`, add `assert_eq!(s.name.as_deref(), Some("kay"));` right after `assert_eq!(s.handle.as_deref(), Some("kay"));` in `sign_in_json_answers_with_the_header_the_pane_now_has`.

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: compile errors: `struct Status has no field named name`, `no field name on type OriginStatus`.

- [ ] **Step 3: Implement**

In `src/json.rs`, replace the `Status` struct with:

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub handle: Option<String>,
    pub name: Option<String>,
    pub state: String,
    pub pane: Option<String>,
    pub signed_in: bool,
    pub rooms: Vec<String>,
}
```

In `src/cmd/launcher.rs`, replace the `OriginStatus` struct and `origin_status` with:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginStatus {
    pub pane: Option<String>,
    pub handle: Option<String>,
    pub name: Option<String>,
    /// The buddy's wire status (`live`/`idle`/`offline`), `None` when the
    /// pane has no chat session at all.
    pub status: Option<String>,
    pub rooms: Vec<String>,
}

/// Match the stashed origin pane to its buddy row. An offline row still
/// matches (the header then reads "signed out") -- the pane is identified
/// either way.
pub fn origin_status(pane: Option<&str>, buddies: &[rt::Buddy]) -> OriginStatus {
    let matched = pane.and_then(|p| buddies.iter().find(|b| b.pane.as_deref() == Some(p)));
    OriginStatus {
        pane: pane.map(str::to_string),
        handle: matched.map(|b| b.handle.clone()),
        name: matched.map(|b| b.display_name().to_string()),
        status: matched.map(|b| b.status.clone()),
        rooms: Vec::new(),
    }
}
```

In `status_json`, replace the `Ok(crate::json::Status { ... })` block with:

```rust
    Ok(crate::json::Status {
        handle: base.handle,
        name: base.name,
        state: base.status.unwrap_or_else(|| "not signed in".to_string()),
        pane: base.pane,
        signed_in,
        rooms,
    })
```

Replace `sign_result_text` with:

```rust
/// Render the sign verb's `--json` stdout (`{ok, handle, name, room}`) as the
/// result line; a payload with neither degrades to the generic verb.
fn sign_result_text(item: Item, body: &str) -> String {
    #[derive(serde::Deserialize, Default)]
    struct Reply {
        handle: Option<String>,
        name: Option<String>,
        room: Option<String>,
    }
    let reply: Reply = serde_json::from_str(body).unwrap_or_default();
    let who = reply.name.filter(|n| !n.is_empty()).or(reply.handle);
    match item {
        Item::SignOut => match who {
            Some(w) => format!("signed out {w}"),
            None => "signed out".to_string(),
        },
        _ => match who {
            Some(w) => match reply.room {
                Some(room) => format!("signed in as {w} \u{b7} joined #{room}"),
                None => format!("signed in as {w}"),
            },
            None => "signed in".to_string(),
        },
    }
}
```

In `header`, replace:

```rust
    if let Some(handle) = &status.handle {
        line1.push(Span::styled(handle.clone(), theme.base));
```

with:

```rust
    if let Some(name) = &status.name {
        line1.push(Span::styled(name.clone(), theme.base));
```

- [ ] **Step 4: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 144 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/json.rs src/cmd/launcher.rs src/cmd/sign.rs
git commit -m "status, launcher: carry the display name beside the handle and show it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Peek shows names and labels DM rooms

**Files:**
- Modify: `src/cmd/peek.rs` (`Row` :29-47, `rows` :59-111, `label` :126-129, `row_line` :294-339, tests)
- Modify: `src/json.rs` (`PeekBuddy` :28-39, `peek_from_rows` :59-97, test `peek_buddy_serializes_pane_id_as_camel_case`)

**Interfaces:**
- Consumes: `rt::Buddy::display_name()`, `rt::Room::is_dm()`, `rt::Room::label()`, `rt::Participants` (Task 2).
- Produces:
  - `peek::Row { kind, handle, name: Option<String>, status, repo, branch, title, room, room_label: Option<String>, unread, mentions }`. `name` is set on buddy rows; `room_label` is set on DM room rows only.
  - `json::PeekBuddy { handle, name: String, pane_id, status, repo, branch, title, unread, mentions }`, printed with `name` right after `handle`. `json::PeekRoom` is unchanged and keeps the raw room.

- [ ] **Step 1: Write the failing tests**

In `src/cmd/peek.rs` tests, replace the `buddy_row` helper with:

```rust
    fn buddy_row(handle: &str) -> Row {
        Row {
            kind: RowKind::Buddy,
            handle: Some(handle.to_string()),
            name: None,
            status: Some("live".to_string()),
            repo: Some("flock".to_string()),
            branch: Some("phase-0".to_string()),
            title: None,
            room: None,
            room_label: None,
            unread: 0,
            mentions: 0,
        }
    }
```

In `rows_json_splits_the_flat_row_list_into_buddies_and_rooms` and in `a_row_missing_its_identity_field_is_dropped_rather_than_named_empty`, add `name: None,` after `handle: None,` and add `room_label: None,` after the `room:` line of each `Row` literal.

Add these helpers after the `room` helper:

```rust
    fn named_buddy(handle: &str, name: &str, status: &str) -> rt::Buddy {
        rt::Buddy {
            name: Some(name.to_string()),
            ..buddy(handle, status)
        }
    }

    fn dm_room(name: &str, unread: u32) -> rt::Room {
        rt::Room {
            room: name.to_string(),
            unread,
            mentions: 0,
            kind: Some("dm".to_string()),
            participants: Some(rt::Participants {
                a: "kai".to_string(),
                b: "remy.k3f9".to_string(),
                a_name: Some("kai".to_string()),
                b_name: Some("remy".to_string()),
            }),
        }
    }

    fn line_text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }
```

Append these tests inside `mod tests`:

```rust
    #[test]
    fn a_buddy_row_keys_on_the_id_and_shows_the_name() {
        let out = rows(vec![named_buddy("remy.k3f9", "remy", "live")], vec![], &no_details());
        assert_eq!(out[0].handle.as_deref(), Some("remy.k3f9"));
        assert_eq!(out[0].name.as_deref(), Some("remy"));
    }

    #[test]
    fn a_buddy_from_an_rt_with_no_names_is_named_by_its_handle() {
        let out = rows(vec![buddy("fred", "live")], vec![], &no_details());
        assert_eq!(out[0].name.as_deref(), Some("fred"));
    }

    #[test]
    fn buddies_sort_by_name_not_by_id() {
        let out = rows(
            vec![
                named_buddy("zed.0001", "amy", "live"),
                named_buddy("amy.0002", "zed", "live"),
            ],
            vec![],
            &no_details(),
        );
        let names: Vec<&str> = out.iter().map(|r| r.name.as_deref().unwrap()).collect();
        assert_eq!(names, vec!["amy", "zed"]);
        assert_eq!(out[0].handle.as_deref(), Some("zed.0001"));
    }

    #[test]
    fn buddy_details_join_on_the_id_not_the_name() {
        let mut details = std::collections::HashMap::new();
        details.insert(
            "remy.k3f9".to_string(),
            rt::AgentDetail {
                repo: Some("rt".into()),
                branch: None,
                title: None,
            },
        );
        let out = rows(vec![named_buddy("remy.k3f9", "remy", "live")], vec![], &details);
        assert_eq!(out[0].repo.as_deref(), Some("rt"));
    }

    #[test]
    fn a_dm_room_row_keeps_its_room_and_carries_the_participant_label() {
        let out = rows(vec![], vec![dm_room("dm-3f9a", 2)], &no_details());
        assert_eq!(out[0].room.as_deref(), Some("dm-3f9a"));
        assert_eq!(out[0].room_label.as_deref(), Some("kai \u{2194} remy"));
    }

    #[test]
    fn a_channel_row_has_no_dm_label() {
        let out = rows(vec![], vec![room("build", 1, 0)], &no_details());
        assert_eq!(out[0].room_label, None);
    }

    #[test]
    fn a_buddy_line_shows_the_name_and_never_the_id() {
        let mut row = buddy_row("remy.k3f9");
        row.name = Some("remy".to_string());
        row.title = Some("remy".to_string());
        let text = line_text(&row_line(&theme::fallback(), &row, false));
        assert!(text.contains("remy"), "got {text:?}");
        assert!(!text.contains("k3f9"), "the id leaked onto the screen: {text:?}");
        assert_eq!(
            text.matches("remy").count(),
            1,
            "a title equal to the name is not repeated: {text:?}"
        );
    }

    #[test]
    fn a_dm_room_line_reads_as_its_participants() {
        let out = rows(vec![], vec![dm_room("dm-3f9a", 2)], &no_details());
        let text = line_text(&row_line(&theme::fallback(), &out[0], false));
        assert!(text.contains("@ kai \u{2194} remy"), "got {text:?}");
        assert!(!text.contains("dm-3f9a"), "got {text:?}");
    }

    #[test]
    fn a_peek_buddy_carries_its_id_and_its_name() {
        let mut row = buddy_row("remy.k3f9");
        row.name = Some("remy".to_string());
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
                handle: "remy.k3f9".to_string(),
                name: Some("remy".to_string()),
                status: "live".to_string(),
                rooms: Vec::new(),
            }),
        }];
        let out = crate::json::peek_from_rows(&[row], &panes);
        assert_eq!(out.buddies[0].handle, "remy.k3f9");
        assert_eq!(out.buddies[0].name, "remy");
        assert_eq!(out.buddies[0].pane_id.as_deref(), Some("w1:p1"));
    }

    #[test]
    fn a_peek_json_buddy_with_no_name_is_named_by_its_handle() {
        let out = crate::json::peek_from_rows(&[buddy_row("kay")], &[]);
        assert_eq!(out.buddies[0].name, "kay");
    }

    #[test]
    fn a_peek_dm_room_keeps_its_raw_room_for_the_viewer_link() {
        let rows = rows(vec![], vec![dm_room("dm-3f9a", 2)], &no_details());
        let out = crate::json::peek_from_rows(&rows, &[]);
        assert_eq!(out.rooms[0].room, "dm-3f9a");
    }
```

In `src/json.rs` test `peek_buddy_serializes_pane_id_as_camel_case`, add `name: "kay".to_string(),` after `handle: "kay".to_string(),`.

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release peek`
Expected: compile errors: `struct Row has no field named name`, `has no field named room_label`, `struct PeekBuddy has no field named name`.

- [ ] **Step 3: Implement `Row`, `rows`, `label` and `row_line` in `src/cmd/peek.rs`**

Replace the `Row` struct with:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub kind: RowKind,
    /// The buddy's identity id (buddy rows), else `None`. Actions key on this.
    pub handle: Option<String>,
    /// The buddy's display name (buddy rows), else `None`. The row shows this.
    pub name: Option<String>,
    /// The buddy's presence status (buddy rows), else `None`.
    pub status: Option<String>,
    /// The buddy's repo / branch / task title, from the pane roster (buddy rows).
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
    /// The room name (room rows), else `None`. The viewer link keys on this.
    pub room: Option<String>,
    /// What a DM room row shows in place of its hashed name.
    pub room_label: Option<String>,
    pub unread: u32,
    pub mentions: u32,
}
```

In `rows`, replace the room loop body's `out.push(Row { ... })` with:

```rust
        let room_label = r.is_dm().then(|| r.label());
        out.push(Row {
            kind: RowKind::Room,
            handle: None,
            name: None,
            status: None,
            repo: None,
            branch: None,
            title: None,
            room: Some(r.room),
            room_label,
            unread: r.unread,
            mentions: r.mentions,
        });
```

and the buddy loop's `let detail = ...; out.push(Row { ... })` with:

```rust
        let detail = details.get(&b.handle).cloned().unwrap_or_default();
        let name = b.display_name().to_string();
        out.push(Row {
            kind: RowKind::Buddy,
            handle: Some(b.handle),
            name: Some(name),
            status: Some(b.status),
            repo: detail.repo,
            branch: detail.branch,
            title: detail.title,
            room: None,
            room_label: None,
            unread: 0,
            mentions: 0,
        });
```

Update the `rows` doc comment's last sentence to read: `... then online buddies live-first and alphabetical by display name.`, and change "then the identity label (handle or room) ascending" to "then the shown label (name or room) ascending".

Replace `label` with:

```rust
/// The row's shown text for the final tie-break: a buddy's name or a room's label.
fn label(row: &Row) -> &str {
    row.name
        .as_deref()
        .or(row.room_label.as_deref())
        .or(row.handle.as_deref())
        .or(row.room.as_deref())
        .unwrap_or("")
}
```

In `row_line`, replace the `RowKind::Buddy` arm's first lines and title check:

```rust
        RowKind::Buddy => {
            let (dot, dot_style) = buddy_dot(theme, row.status.as_deref());
            let name = row
                .name
                .as_deref()
                .or(row.handle.as_deref())
                .unwrap_or("?");
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("{dot} "), dot_style),
                Span::styled(format!("{name:<8}"), row_style),
            ];
            // repo · branch, from the pane roster, so the row says where the
            // agent is, not just who; the dot already carries presence.
            if let Some(repo) = row.repo.as_deref() {
                let branch = row.branch.as_deref().unwrap_or("-");
                spans.push(Span::styled(format!("  {repo} \u{b7} {branch}"), theme.dim));
            }
            // The pane title is the agent's task line; skip it when it just
            // echoes the name (nothing new to say).
            if let Some(title) = row.title.as_deref() {
                if title != name && !title.is_empty() {
                    spans.push(Span::styled(format!("   {title}"), row_style));
                }
            }
            Line::from(spans)
        }
```

and the start of the `RowKind::Room` arm:

```rust
        RowKind::Room => {
            let (sigil, text) = match row.room_label.as_deref() {
                Some(label) => ("@", label),
                None => ("#", row.room.as_deref().unwrap_or("?")),
            };
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("{sigil} {text}"), row_style),
            ];
```

(the unread and mention badge pushes below it stay as they are).

- [ ] **Step 4: Implement `PeekBuddy.name` in `src/json.rs`**

Replace the `PeekBuddy` struct with:

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeekBuddy {
    pub handle: String,
    pub name: String,
    pub pane_id: Option<String>,
    pub status: String,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
    pub unread: u32,
    pub mentions: u32,
}
```

In `peek_from_rows`, replace the buddy arm's body with:

```rust
                if let Some(handle) = row.handle.clone() {
                    let pane_id = pane_for(&handle);
                    let name = row.name.clone().unwrap_or_else(|| handle.clone());
                    buddies.push(PeekBuddy {
                        handle,
                        name,
                        pane_id,
                        status: row.status.clone().unwrap_or_else(|| "unknown".to_string()),
                        repo: row.repo.clone(),
                        branch: row.branch.clone(),
                        title: row.title.clone(),
                        unread: row.unread,
                        mentions: row.mentions,
                    });
                }
```

- [ ] **Step 5: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 155 passed; 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/cmd/peek.rs src/json.rs
git commit -m "peek: show display names, key on the handle, label DM rooms by who is in them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `jump` finds a pane by id or by name

**Files:**
- Modify: `src/cmd/jump.rs` (whole non-test body :12-39, tests)
- Modify: `src/json.rs` (`Jump` :185-193, test `jump_serializes_pane_id_as_camel_case`)
- Modify: `src/main.rs:111-112` (doc text on `Jump.handle`)

**Interfaces:**
- Consumes: `rt::Presence::display_name()` (Task 2).
- Produces:
  - `jump::pane_for(panes: &[rt::ChatPane], who: &str) -> Option<(&rt::ChatPane, &rt::Presence)>`: an exact id match first, then a live (not `offline`) presence whose display name is `who`.
  - `jump::jump_to(r, who, panes) -> Result<bool, String>`: unchanged signature, now accepts a name.
  - `jump::locate(r, who) -> Result<json::Jump, String>`: `json::Jump { pane_id, workspace, handle, name }`, where `handle` is always the matched id, never the input.

- [ ] **Step 1: Write the failing tests**

In `src/json.rs`, replace `jump_serializes_pane_id_as_camel_case` with:

```rust
    #[test]
    fn jump_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&Jump {
            pane_id: "w1:p1".to_string(),
            workspace: "flock".to_string(),
            handle: "kay".to_string(),
            name: "kay".to_string(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"paneId":"w1:p1","workspace":"flock","handle":"kay","name":"kay"}"#
        );
    }
```

In `src/cmd/jump.rs` tests, add `assert_eq!(j.name, "kay");` as the last line of `locate_answers_with_the_pane_that_handle_is_signed_in_on`. Then add this helper and constant after `with_presence`:

```rust
    fn with_named(pane_id: &str, handle: &str, name: &str, status: &str) -> rt::ChatPane {
        let mut p = with_presence(pane_id, handle);
        if let Some(pr) = p.presence.as_mut() {
            pr.name = Some(name.to_string());
            pr.status = status.to_string();
        }
        p
    }

    const RT_NAMED_PANE: &str = r#"{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","agentStatus":"idle","presence":{"handle":"remy.k3f9","name":"remy","status":"live"}}]}"#;
```

Append these tests:

```rust
    #[test]
    fn locate_by_display_name_answers_with_the_id_and_the_name() {
        let r = FakeRunner::sequence(&[RT_NAMED_PANE]);
        let j = locate(&r, "remy").unwrap();
        assert_eq!(j.pane_id, "w1:p1");
        assert_eq!(j.handle, "remy.k3f9");
        assert_eq!(j.name, "remy");
    }

    #[test]
    fn locate_by_id_answers_with_the_name() {
        let r = FakeRunner::sequence(&[RT_NAMED_PANE]);
        let j = locate(&r, "remy.k3f9").unwrap();
        assert_eq!(j.handle, "remy.k3f9");
        assert_eq!(j.name, "remy");
    }

    /// rt resolves a typed value as an id before a name; a jump that did
    /// otherwise would land on a different agent than a DM to the same text.
    #[test]
    fn an_exact_id_wins_over_another_identitys_display_name() {
        let panes = vec![
            with_named("w1:p1", "kai.a1b2", "remy", "live"),
            with_named("w1:p2", "remy", "remy-2", "live"),
        ];
        let (pane, presence) = pane_for(&panes, "remy").unwrap();
        assert_eq!(pane.pane_id, "w1:p2");
        assert_eq!(presence.handle, "remy");
    }

    #[test]
    fn a_name_match_skips_an_identity_that_has_signed_out() {
        let panes = vec![
            with_named("w1:p1", "remy.0001", "remy", "offline"),
            with_named("w1:p2", "remy.k3f9", "remy", "live"),
        ];
        let (pane, _) = pane_for(&panes, "remy").unwrap();
        assert_eq!(pane.pane_id, "w1:p2");
    }

    #[test]
    fn jump_to_accepts_a_display_name() {
        let panes = vec![with_named("w1:p2", "fred.9zz1", "fred", "live")];
        let r = FakeRunner::sequence(&[ONE_PANE, "{}", "{}", "{}"]);
        assert!(jump_to(&r, "fred", &panes).unwrap());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release jump`
Expected: compile errors: `struct Jump has no field named name`, `cannot find function pane_for`.

- [ ] **Step 3: Implement**

In `src/json.rs`, replace the `Jump` struct with:

```rust
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Jump {
    pub pane_id: String,
    pub workspace: String,
    pub handle: String,
    pub name: String,
}
```

In `src/cmd/jump.rs`, update the module doc's first sentence to "`jump`: the pane a buddy is signed in on, found by the pane list's `presence` id or display name." Replace everything from `/// Focus the pane a buddy is signed in on.` down to the end of `locate` with:

```rust
/// The pane `who` is signed in on: an exact id first, the order rt resolves a
/// typed name in, then a live agent's display name. Live names are unique, so
/// the name pass finds at most one; a signed-out identity keeps its old name
/// and is skipped there.
pub fn pane_for<'a>(
    panes: &'a [rt::ChatPane],
    who: &str,
) -> Option<(&'a rt::ChatPane, &'a rt::Presence)> {
    let signed_in = || {
        panes
            .iter()
            .filter_map(|p| p.presence.as_ref().map(|pr| (p, pr)))
    };
    signed_in()
        .find(|(_, pr)| pr.handle == who)
        .or_else(|| signed_in().find(|(_, pr)| pr.status != "offline" && pr.display_name() == who))
}

/// Focus the pane a buddy is signed in on. Returns `false` when no pane
/// carries `who` (the buddy has no local pane) or when the pane is absent
/// from herdr's snapshot.
pub fn jump_to(r: &dyn Runner, who: &str, panes: &[rt::ChatPane]) -> Result<bool, String> {
    let Some((pane, _)) = pane_for(panes, who) else {
        return Ok(false);
    };
    herdr::focus_pane(r, &pane.pane_id)
}

/// The pane `who` is signed in on, answered with the matched id, whichever
/// of id or name the caller typed. Errs rather than answering an empty object,
/// so a caller cannot mistake "nobody by that name" for "found it".
pub fn locate(r: &dyn Runner, who: &str) -> Result<crate::json::Jump, String> {
    let panes = rt::pane_list(r)?;
    let (pane, presence) =
        pane_for(&panes, who).ok_or_else(|| format!("no pane is signed in as {who:?}"))?;
    Ok(crate::json::Jump {
        pane_id: pane.pane_id.clone(),
        workspace: pane.workspace.clone(),
        handle: presence.handle.clone(),
        name: presence.display_name().to_string(),
    })
}
```

In `src/main.rs`, replace the two doc lines above `Jump`'s `handle` arg:

```rust
        /// The chat handle to locate. Required, and refused in the same error
        /// envelope as every other missing flag.
```

with:

```rust
        /// The handle or display name to locate. Required, and refused in the
        /// same error envelope as every other missing flag.
```

and the verb's doc line `/// Print where a handle's pane is. JSON only, and moves no focus.` with `/// Print where an agent's pane is. JSON only, and moves no focus.`

- [ ] **Step 4: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 160 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/cmd/jump.rs src/json.rs src/main.rs
git commit -m "jump: find a pane by id or live display name, answer with both

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Quick-send and `targets` show names; `--to @x` passes through

**Files:**
- Modify: `src/cmd/quick_send.rs` (`TargetRow` :56-62, `targets` :64-86, `targets_json` :93-103, `target_line` :246-275, tests)
- Modify: `src/json.rs` (`Targets` doc :99-106, `targets_from` :108-118)

**Interfaces:**
- Consumes: `rt::Buddy::display_name()`, `rt::Room::is_dm()`, `rt::Room::label()` (Task 2).
- Produces:
  - `quick_send::TargetRow { pub target: Target, pub label: String, pub sigil: char, pub detail: Option<rt::AgentDetail> }`, where `Target::Dm` holds the id and `Target::Room` the raw room.
  - `json::targets_from(rows: &[quick_send::TargetRow]) -> json::Targets`. `rooms` holds `#<raw room>`; `people` holds `@<display name>`, once per name.
  - `quick_send::send_json`: unchanged; `@x` reaches `rt chat dm x` verbatim, and rt resolves a name or an id.

- [ ] **Step 1: Write the failing tests**

In `src/cmd/quick_send.rs` tests, replace `targets_json_lists_rooms_with_their_hash_and_people_with_their_at` with:

```rust
    #[test]
    fn targets_json_lists_rooms_with_their_hash_and_people_with_their_at() {
        let t = crate::json::targets_from(&[
            TargetRow {
                target: Target::Room("rt".to_string()),
                label: "rt".to_string(),
                sigil: '#',
                detail: None,
            },
            TargetRow {
                target: Target::Dm("scout".to_string()),
                label: "scout".to_string(),
                sigil: '@',
                detail: None,
            },
        ]);
        assert_eq!(t.rooms, vec!["#rt".to_string()]);
        assert_eq!(t.people, vec!["@scout".to_string()]);
    }
```

Add this helper at the top of `mod tests`, after the `use` lines:

```rust
    fn line_text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }
```

Append these tests:

```rust
    #[test]
    fn targets_json_names_people_by_display_name() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"rooms":[{"room":"rt"},{"room":"dm-3f9a","kind":"dm","participants":{"a":"kai","b":"remy.k3f9","aName":"kai","bName":"remy"}}]}"#,
            r#"{"ok":true,"buddies":[{"handle":"remy.k3f9","name":"remy","status":"live"},{"handle":"meg","status":"idle"}]}"#,
            r#"{"ok":true,"panes":[]}"#,
        ]);
        let t = targets_json(&r).unwrap();
        assert_eq!(t.rooms, vec!["#rt", "#dm-3f9a"]);
        assert_eq!(t.people, vec!["@remy", "@meg"]);
    }

    /// A signed-out identity keeps its name while a live one holds it too, and
    /// `@remy` reaches only the live one.
    #[test]
    fn people_are_listed_once_per_name() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"rooms":[]}"#,
            r#"{"ok":true,"buddies":[{"handle":"remy","status":"offline"},{"handle":"remy.k3f9","name":"remy","status":"live"}]}"#,
            r#"{"ok":true,"panes":[]}"#,
        ]);
        assert_eq!(targets_json(&r).unwrap().people, vec!["@remy"]);
    }

    #[test]
    fn a_dm_target_passes_a_name_or_an_id_through_for_rt_to_resolve() {
        let r = FakeRunner::capture("{}");
        send_json(&r, "@remy", "hi").unwrap();
        send_json(&r, "@remy.k3f9", "hi").unwrap();
        let calls = r.calls();
        assert_eq!(calls[0].argv, vec!["rt", "chat", "dm", "remy", "hi"]);
        assert_eq!(calls[1].argv, vec!["rt", "chat", "dm", "remy.k3f9", "hi"]);
    }

    #[test]
    fn a_buddy_target_sends_to_the_id_and_shows_the_name() {
        let buddies = vec![rt::Buddy {
            handle: "remy.k3f9".to_string(),
            name: Some("remy".to_string()),
            status: "live".to_string(),
            session_id: None,
            pane: None,
            rooms: Vec::new(),
        }];
        let mut details = std::collections::HashMap::new();
        details.insert(
            "remy.k3f9".to_string(),
            rt::AgentDetail {
                repo: Some("rt".to_string()),
                branch: Some("main".to_string()),
                title: Some("remy".to_string()),
            },
        );
        let rows = targets(vec![], buddies, &details);
        assert_eq!(rows[0].target, Target::Dm("remy.k3f9".to_string()));
        let text = line_text(&target_line(&theme::fallback(), &rows[0], false));
        assert!(text.starts_with("  @ remy"), "got {text:?}");
        assert!(!text.contains("k3f9"), "the id leaked onto the screen: {text:?}");
        assert_eq!(
            text.matches("remy").count(),
            1,
            "a title equal to the name is not repeated: {text:?}"
        );
    }

    #[test]
    fn a_dm_room_target_shows_its_participants_and_posts_to_the_room() {
        let rooms = vec![rt::Room {
            room: "dm-3f9a".to_string(),
            unread: 0,
            mentions: 0,
            kind: Some("dm".to_string()),
            participants: Some(rt::Participants {
                a: "kai".to_string(),
                b: "remy.k3f9".to_string(),
                a_name: Some("kai".to_string()),
                b_name: Some("remy".to_string()),
            }),
        }];
        let rows = targets(rooms, vec![], &std::collections::HashMap::new());
        assert_eq!(rows[0].target, Target::Room("dm-3f9a".to_string()));
        let text = line_text(&target_line(&theme::fallback(), &rows[0], false));
        assert_eq!(text, "  @ kai \u{2194} remy");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release quick_send`
Expected: compile errors: `struct TargetRow has no field named label`, `has no field named sigil`, and `targets_from` expects `&[Target]`.

- [ ] **Step 3: Implement in `src/cmd/quick_send.rs`**

Replace the `TargetRow` struct and `targets` with:

```rust
/// A pickable target plus, for a DM, the buddy's repo/branch/task detail so the
/// row can show what that agent is doing. Rooms carry no such detail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetRow {
    pub target: Target,
    /// What the row shows. Never what the send keys on: that is `target`.
    pub label: String,
    /// `'@'` for a buddy or a DM room, `'#'` for a channel.
    pub sigil: char,
    pub detail: Option<rt::AgentDetail>,
}

/// Recent rooms first, then buddies, each turned into a [`TargetRow`]; a buddy
/// picks up its agent detail from the pane roster index, keyed by its id.
fn targets(
    rooms: Vec<rt::Room>,
    buddies: Vec<rt::Buddy>,
    details: &std::collections::HashMap<String, rt::AgentDetail>,
) -> Vec<TargetRow> {
    let mut out: Vec<TargetRow> = rooms
        .into_iter()
        .map(|r| TargetRow {
            label: r.label(),
            sigil: if r.is_dm() { '@' } else { '#' },
            target: Target::Room(r.room),
            detail: None,
        })
        .collect();
    out.extend(buddies.into_iter().map(|b| {
        let detail = details.get(&b.handle).cloned();
        TargetRow {
            label: b.display_name().to_string(),
            sigil: '@',
            target: Target::Dm(b.handle),
            detail,
        }
    }));
    out
}
```

In `targets_json`, replace the tail:

```rust
    let targets: Vec<Target> = targets(rooms, buddies, &details)
        .into_iter()
        .map(|row| row.target)
        .collect();
    Ok(crate::json::targets_from(&targets))
```

with:

```rust
    Ok(crate::json::targets_from(&targets(rooms, buddies, &details)))
```

Replace `target_line` with:

```rust
fn target_line<'a>(theme: &AppTheme, row: &'a TargetRow, cursor: bool) -> Line<'a> {
    let marker = if cursor { "\u{203a} " } else { "  " };
    let row_style = if cursor { theme.selected } else { theme.base };
    match &row.target {
        Target::Room(_) => Line::from(vec![
            Span::styled(marker, row_style),
            Span::styled(format!("{} {}", row.sigil, row.label), row_style),
        ]),
        Target::Dm(_) => {
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("{} {:<8}", row.sigil, row.label), row_style),
            ];
            // For a DM, show where the buddy is and what they're working on,
            // from the pane roster; a room row has no such detail.
            if let Some(d) = &row.detail {
                if let Some(repo) = d.repo.as_deref() {
                    let branch = d.branch.as_deref().unwrap_or("-");
                    spans.push(Span::styled(format!("  {repo} \u{b7} {branch}"), theme.dim));
                }
                if let Some(title) = d.title.as_deref() {
                    if title != row.label && !title.is_empty() {
                        spans.push(Span::styled(format!("   {title}"), row_style));
                    }
                }
            }
            Line::from(spans)
        }
    }
}
```

- [ ] **Step 4: Implement `targets_from` in `src/json.rs`**

Replace the `Targets` doc comment and `targets_from` with:

```rust
/// What a caller may send to. The prefixes are the wire form: `#room` and
/// `@name` are one namespace a caller passes straight back as `--to`, where
/// a bare name would be ambiguous between a room and a person. `#room` is the
/// room rt keys on; `@name` is a display name rt resolves to its live holder.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Targets {
    pub rooms: Vec<String>,
    pub people: Vec<String>,
}

pub fn targets_from(rows: &[crate::cmd::quick_send::TargetRow]) -> Targets {
    let mut rooms = Vec::new();
    let mut people: Vec<String> = Vec::new();
    for row in rows {
        match &row.target {
            crate::cmd::quick_send::Target::Room(r) => rooms.push(format!("#{r}")),
            crate::cmd::quick_send::Target::Dm(_) => {
                // A signed-out identity can share a live one's name, and
                // `@name` reaches only the live one.
                let person = format!("@{}", row.label);
                if !people.contains(&person) {
                    people.push(person);
                }
            }
        }
    }
    Targets { rooms, people }
}
```

- [ ] **Step 5: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 165 passed; 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/cmd/quick_send.rs src/json.rs
git commit -m "quick-send, targets: show display names and DM participants, send by id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Picker and broadcast show names; the broadcast record keeps both

**Files:**
- Modify: `src/state.rs` (`Recipient` :27-32, tests)
- Modify: `src/cmd/broadcast.rs` (`recipients` :112-126, `draw_result` :353-359, new `recipient_label`, tests)
- Modify: `src/cmd/picker.rs` (`matches` :131-149, `pane_lines` :366-383, tests)

**Interfaces:**
- Consumes: `rt::Presence::display_name()` (Task 2).
- Produces:
  - `state::Recipient { pane_id: String, handle: Option<String>, name: Option<String>, delivered: String }`. `name` has a serde default, so a history file without it still loads.
  - `broadcast::recipient_label(r: &Recipient) -> String`: the name, else the handle, else the pane id.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `src/state.rs`:

```rust
    #[test]
    fn a_history_file_written_before_display_names_still_loads() {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("broadcasts.json"),
            r#"[{"at":1,"message":"hi","recipients":[{"pane_id":"w1:p1","handle":"meg","delivered":"accepted"}]}]"#,
        )
        .unwrap();
        let r = recent_broadcasts(d.path());
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].recipients[0].handle.as_deref(), Some("meg"));
        assert_eq!(r[0].recipients[0].name, None);
    }

    #[test]
    fn a_recipient_name_round_trips() {
        let d = tempfile::tempdir().unwrap();
        push_broadcast(
            d.path(),
            &Broadcast {
                at: 1,
                message: "hi".to_string(),
                recipients: vec![Recipient {
                    pane_id: "w1:p1".to_string(),
                    handle: Some("remy.k3f9".to_string()),
                    name: Some("remy".to_string()),
                    delivered: "accepted".to_string(),
                }],
            },
        )
        .unwrap();
        let r = recent_broadcasts(d.path());
        assert_eq!(r[0].recipients[0].handle.as_deref(), Some("remy.k3f9"));
        assert_eq!(r[0].recipients[0].name.as_deref(), Some("remy"));
    }
```

In `src/cmd/broadcast.rs` tests, add `assert_eq!(recs[0].name.as_deref(), Some("meg"));` and `assert_eq!(recs[1].name, None);` to the end of `recipients_join_handle_from_pane_list_and_tolerate_absent_panes`. Append:

```rust
    #[test]
    fn recipients_record_the_id_and_the_name() {
        let mut pane = chat_pane("w1:p1", Some("remy.k3f9"));
        if let Some(pr) = pane.presence.as_mut() {
            pr.name = Some("remy".to_string());
        }
        let recs = recipients(&[sr("w1:p1", "accepted")], &[pane]);
        assert_eq!(recs[0].handle.as_deref(), Some("remy.k3f9"));
        assert_eq!(recs[0].name.as_deref(), Some("remy"));
    }

    #[test]
    fn a_recipient_is_shown_by_name_then_handle_then_pane() {
        let rec = |handle: Option<&str>, name: Option<&str>| Recipient {
            pane_id: "w1:p1".to_string(),
            handle: handle.map(str::to_string),
            name: name.map(str::to_string),
            delivered: "accepted".to_string(),
        };
        assert_eq!(recipient_label(&rec(Some("remy.k3f9"), Some("remy"))), "remy");
        assert_eq!(recipient_label(&rec(Some("meg"), None)), "meg");
        assert_eq!(recipient_label(&rec(None, None)), "w1:p1");
    }
```

In `src/cmd/picker.rs` tests, add after the `unsigned` helper:

```rust
    fn named(id: &str, handle: &str, name: &str) -> ChatPane {
        ChatPane {
            presence: Some(Presence {
                name: Some(name.to_string()),
                ..presence(handle, "live")
            }),
            ..base(id)
        }
    }

    fn line_text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }
```

and append:

```rust
    #[test]
    fn a_pane_row_shows_the_name_and_never_the_id() {
        let mut p = named("w1:p1", "remy.k3f9", "remy");
        p.title = Some("remy".to_string());
        let (l1, _) = pane_lines(&crate::theme::fallback(), &p, false, false);
        let text = line_text(&l1);
        assert!(text.contains("remy"), "got {text:?}");
        assert!(!text.contains("k3f9"), "the id leaked onto the screen: {text:?}");
        assert_eq!(
            text.matches("remy").count(),
            1,
            "a title equal to the name is not repeated: {text:?}"
        );
    }

    /// The row never shows the id, so a filter that matched it would surface
    /// a row for text the user cannot see.
    #[test]
    fn the_filter_matches_the_name_not_the_hidden_id() {
        let mut m = PickerModel::new(vec![named("w1:p1", "remy.k3f9", "remy")]);
        m.set_filter("remy");
        assert_eq!(m.grouped().iter().map(|(_, v)| v.len()).sum::<usize>(), 1);
        m.set_filter("k3f9");
        assert!(m.grouped().is_empty());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: compile errors: `struct Recipient has no field named name`, `cannot find function recipient_label`.

- [ ] **Step 3: Implement `Recipient.name` in `src/state.rs`**

Replace the `Recipient` struct with:

```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Recipient {
    pub pane_id: String,
    pub handle: Option<String>,
    // Without `default` a history file written before names existed fails to
    // parse, and `push_broadcast` would then replace it with an empty list.
    #[serde(default)]
    pub name: Option<String>,
    pub delivered: String,
}
```

- [ ] **Step 4: Implement the broadcast side in `src/cmd/broadcast.rs`**

Replace `recipients` with:

```rust
/// The recorded snapshot: each result joined to its pane's identity (when the
/// pane is still in the list and signed in).
fn recipients(results: &[rt::SendResult], panes: &[rt::ChatPane]) -> Vec<Recipient> {
    results
        .iter()
        .map(|res| {
            let presence = panes
                .iter()
                .find(|p| p.pane_id == res.pane_id)
                .and_then(|p| p.presence.as_ref());
            Recipient {
                pane_id: res.pane_id.clone(),
                handle: presence.map(|pr| pr.handle.clone()),
                name: presence.map(|pr| pr.display_name().to_string()),
                delivered: res.delivered.clone(),
            }
        })
        .collect()
}

/// A history entry recorded before display names existed carries only the handle.
fn recipient_label(r: &Recipient) -> String {
    r.name
        .clone()
        .or_else(|| r.handle.clone())
        .unwrap_or_else(|| r.pane_id.clone())
}
```

In `draw_result`, replace `let who = r.handle.clone().unwrap_or_else(|| r.pane_id.clone());` with `let who = recipient_label(r);`.

- [ ] **Step 5: Implement the picker side in `src/cmd/picker.rs`**

In `matches`, replace the doc line `/// Case-insensitive substring match across handle, workspace, title, repo,` with `/// Case-insensitive substring match across display name, workspace, title, repo,` and replace `p.presence.as_ref().map(|pr| pr.handle.as_str()),` with `p.presence.as_ref().map(|pr| pr.display_name()),`.

In `pane_lines`, replace:

```rust
    let handle = p
        .presence
        .as_ref()
        .map(|pr| pr.handle.clone())
        .unwrap_or_else(|| "not signed in".to_string());
```

with:

```rust
    let name = p
        .presence
        .as_ref()
        .map(|pr| pr.display_name().to_string())
        .unwrap_or_else(|| "not signed in".to_string());
```

then `Span::styled(handle.clone(), row_style),` with `Span::styled(name.clone(), row_style),`, and `if title != handle {` with `if title != name {`.

- [ ] **Step 6: Run the tests**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 171 passed; 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add src/state.rs src/cmd/broadcast.rs src/cmd/picker.rs
git commit -m "picker, broadcast: show display names, record id and name per recipient

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: README and AGENTS.md carry the new contract

**Files:**
- Modify: `README.md` ("The wire shapes" table and the paragraphs after it)
- Modify: `AGENTS.md` ("Read first", "Architecture", "Dev loop", "Gotchas")

**Interfaces:**
- Consumes: the JSON shapes from Tasks 3 to 6.
- Produces: the written contract lane 4 (flock) reads.

- [ ] **Step 1: README table rows**

Replace these rows in the table under "### The wire shapes":

```
| `status` | `--pane <id>`, else `HERDR_PANE_ID`; required | `handle`, `state`, `pane`, `signedIn`, `rooms` |
| `sign-in` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same five, read back after the sign |
| `sign-out` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same five |
```

with:

```
| `status` | `--pane <id>`, else `HERDR_PANE_ID`; required | `handle`, `name`, `state`, `pane`, `signedIn`, `rooms` |
| `sign-in` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same six, read back after the sign |
| `sign-out` | `--pane <id>`, else `HERDR_PANE_ID`; required | the same six |
```

Replace these two rows:

```
| `quick-send` | `--to '#room'` or `--to '@handle'`, `--body <text>` | `ok`, `to` |
| `jump` | `--handle <handle>` | `paneId`, `workspace`, `handle` |
```

with:

```
| `quick-send` | `--to '#room'` or `--to '@name'`, `--body <text>` | `ok`, `to` |
| `jump` | `--handle <name or handle>` | `paneId`, `workspace`, `handle`, `name` |
```

- [ ] **Step 2: README paragraphs below the table**

Replace:

```
The nested rows: a `peek` buddy is `handle`, `paneId`, `status`, `repo`,
```

with:

```
The nested rows: a `peek` buddy is `handle`, `name`, `paneId`, `status`, `repo`,
```

Re-wrap that paragraph to the README's 80-column width afterwards.

Replace:

```
`targets` prints prefixed strings (`#room` under `rooms`, `@handle` under
`people`) and `quick-send --to` takes one back. A bare name is refused rather
than guessed at between a room and a person.
```

with:

```
`targets` prints prefixed strings (`#room` under `rooms`, `@name` under
`people`) and `quick-send --to` takes one back. A bare name is refused rather
than guessed at between a room and a person.
```

Replace:

```
Absent values are `null`, never a missing key: `handle` and `pane` on a
```

with (re-wrap the paragraph afterwards):

```
Absent values are `null`, never a missing key: `handle`, `name` and `pane` on a
```

Insert this section immediately before the heading line that reads `### What ` followed by `` `ok` does and does not tell you``:

```markdown
### Handles and names

rt gives every chat identity two strings. `handle` is the id rt keys
everything on (`remy.k3f9`); `name` is what people see and type (`remy`).
Show `name`, act on `handle`: a jump, a DM, or a check for "is this the
same agent" goes by `handle`, because a name is reused after its holder
signs out and a handle never is.

Input goes the other way. `jump --handle` and `quick-send --to '@...'` take
either one. `jump` matches a handle exactly first, then a live agent's name.
`quick-send` passes the value to rt, which resolves a name to the live
identity holding it. `targets` lists each name once: a signed-out identity
can still share a name with a live one, and only the live one answers to it.

An rt from before names existed sends no `name`, and every verb then prints
the handle in its place, so `name` is present wherever `handle` is.

```

- [ ] **Step 3: AGENTS.md read-first and module map**

In "Read first", replace:

```
(the wire shapes `src/rt.rs` mirrors).
```

with:

```
(the wire shapes `src/rt.rs` mirrors), and
  `docs/superpowers/specs/2026-09-27-chat-identity-design.md` (every
  identity is a hidden `handle` id plus a display `name`).
```

In "Architecture (module map)", replace the `src/rt.rs` bullet's closing `(index the pane roster by handle for the row context).` with:

```
(index the pane roster by handle for the row context). Every identity
  shape carries `handle` (the id) and an optional `name`; `display_name()` is
  the one place the fallback to the handle lives, and `Room::label()` names a
  DM room by its participants.
```

In the `src/state.rs` bullet, replace:

```
broadcast history (`push_broadcast`/`recent_broadcasts`),
```

with:

```
broadcast history (`push_broadcast`/`recent_broadcasts`; each recipient
  keeps `handle` and `name`),
```

- [ ] **Step 4: AGENTS.md dev loop and gotchas**

In "Dev loop", replace:

```
- Build `cargo build --release`; test `cargo test --release`.
```

with:

```
- Build `cargo build --release`; test
  `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`.
```

Append to "Gotchas (each cost a debugging round)":

```markdown
- **Inside a herdr pane, `cargo test` fails five tests unless
  `HERDR_BIN_PATH` is unset.** herdr exports it into every pane, and
  `run::herdr_bin` honors it, so the argv assertions see an absolute path.
- **Show `name`, act on `handle`.** Every row, header and result line renders
  `display_name()`. Every lookup, map key, jump, send and broadcast record
  uses `handle`. A check that a pane title "just echoes the identity"
  compares against the name, since the name is what the title would repeat.
  A test that renders a row asserts the id's suffix is absent.
```

- [ ] **Step 5: Check the docs for banned characters and ids**

Run: `rg -n '\x{2013}|\x{2014}' README.md AGENTS.md src`
Expected: no output.
Run: `rg -n '\b(RT|SKILLS|BOARD)-[0-9]+' README.md AGENTS.md src`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: handles and names in the wire contract, module map and gotchas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full gates, smoke run, push and PR

**Files:**
- None expected. Only if `cargo fmt` or clippy asks for a change.

**Interfaces:**
- Consumes: Tasks 2 to 8.
- Produces: branch `chat-identity` on origin and an open PR against `main`; the local binary lane 4 can use before merge.

- [ ] **Step 1: Test, format, lint, purity**

Run: `unset HERDR_BIN_PATH RT_BIN_PATH DECK_BIN_PATH; cargo test --release`
Expected: `test result: ok. 171 passed; 0 failed`.
Run: `cargo fmt --check`
Expected: no output. If it prints a diff, run `cargo fmt` and continue.
Run: `cargo clippy --release -- -D warnings`
Expected: `Finished`, no warnings.
Run: `scripts/repo-purity.sh`
Expected: exit 0.

- [ ] **Step 2: Smoke the read-only verbs against the live rt**

Run: `cargo build --release`, then:

```bash
./target/release/herdr-chat peek --json
./target/release/herdr-chat targets --json
./target/release/herdr-chat status --json --pane "$HERDR_PANE_ID"
```

Expected: each prints one JSON object. Every `peek.buddies[]` row and the `status` object carry a `"name"` key. Until lane 1 is deployed, rt sends no names, so each `name` equals its `handle`; after lane 1, new identities show `name` without the `.xxxx` suffix. Do not run `sign-in`, `sign-out`, `broadcast` or `quick-send` here: they act on live panes.

- [ ] **Step 3: Commit any format or lint fix**

```bash
git status --short
git add -u
git commit -m "fmt: tidy after the display name change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Skip the commit when `git status --short` prints nothing.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin chat-identity
gh pr create -R m4ttstack/herdr-chat --base main --head chat-identity \
  --title "Display names beside handles" \
  --body "$(cat <<'EOF'
rt now gives every chat identity a hidden id (`handle`, e.g. `remy.k3f9`) and a display `name` (`remy`). This parses the name, shows it everywhere and keeps acting on the handle.

**Wire in**

- Parses `name` on presence and buddy rows and `participants.aName/bName` on DM rooms; falls back to the handle when rt sends none

**Wire out**

- `status`, `peek.buddies[]` and `jump` gain `name` right after `handle`
- `targets.people` lists `@<name>` once per name
- `jump --handle` and `quick-send --to '@...'` take a name or a handle

**Screens**

- Peek, quick-send, picker, launcher and the broadcast result show names; DM rooms read as `kai ↔ remy`
- `broadcasts.json` recipients keep `handle` and `name`; older files still load

**Tests**

- 37 new; full suite 171/171 green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL. Then wait for CodeRabbit and fix every actionable finding (each fix is its own commit with the Co-Authored-By line), and wait for the purity check to go green. Do not merge. The shepherd merges in master plan Task I5, after the rt PR, with Matt's confirmation.

- [ ] **Step 5: Hand lane 4 the pre-merge binary**

Post in the lane's chat room (or the shepherd's): flock can test against this build before merge with `FLOCK_HERDR_CHAT_BIN=/Users/matt/Documents/GitHub/herdr-chat/.worktrees/chat-identity/target/release/herdr-chat`. `ChatToolLocator` takes a valid override before any installed build.

---

### Task 10: Install the merged plugin (master plan Task I5, step 2)

Run this only after the herdr-chat PR has merged to `main`.

**Files:**
- None.

**Interfaces:**
- Consumes: merged `main` on `m4ttstack/herdr-chat`.
- Produces: the installed build at `~/.config/herdr/plugins/github/m4ttstack.chat-<hash>/target/release/herdr-chat`, the path flock's locator finds.

- [ ] **Step 1: Confirm the install is github-managed, not linked**

Run: `herdr plugin list`
Expected: a line `m4ttstack.chat (Chat) enabled [github:m4ttstack/herdr-chat@<sha>]`. If it says linked instead, run `herdr plugin unlink m4ttstack.chat` first (a local link blocks the install).

- [ ] **Step 2: Install as the README says**

Run: `herdr plugin install m4ttstack/herdr-chat --yes`
(`--yes` is required when nobody is at the prompt; see AGENTS.md "Dev loop".)
Expected: the build runs `cargo build --release` and finishes. Then `herdr plugin list` shows `@<sha>` equal to `git ls-remote https://github.com/m4ttstack/herdr-chat.git refs/heads/main | cut -c1-40`.

- [ ] **Step 3: Verify the binary flock will find**

Run: `ls -lt ~/.config/herdr/plugins/*/m4ttstack.chat*/target/release/herdr-chat`
Expected: the newest entry has a timestamp from Step 2. flock's `ChatToolLocator` globs exactly `~/.config/herdr/plugins/*/m4ttstack.chat*/target/release/herdr-chat` and takes the newest modification time, so an older hash directory left behind is harmless.
Run the newest path with `peek --json` and confirm every buddy row has `"name"`.

- [ ] **Step 4: Tell flock to re-resolve**

`ChatToolLocator.binaryPath` is resolved once per flock process. If the install produced a new hash directory, flock keeps calling the old binary until it relaunches. Ask the lane 4 owner (or the shepherd at I5 step 3) to relaunch flock through `Scripts/dev-build.sh`.

- [ ] **Step 5: Clean up the tree**

```bash
git -C /Users/matt/Documents/GitHub/herdr-chat worktree remove .worktrees/chat-identity
git -C /Users/matt/Documents/GitHub/herdr-chat branch -d chat-identity
git -C /Users/matt/Documents/GitHub/herdr-chat pull --ff-only
```

Expected: the tree is gone, the branch is deleted as merged, and `main` is at the merged commit. Nothing to commit: run `git -C /Users/matt/Documents/GitHub/herdr-chat status --short` and expect no output.
