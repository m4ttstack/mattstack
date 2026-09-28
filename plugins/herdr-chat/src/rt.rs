//! Typed wrappers over `rt ... --json`. Every later subcommand parses rt's
//! wire shapes here, once, so a field rename lands in one place. The shapes
//! mirror rt-client's `commands.ts` (rt-client cannot be imported); the CLI
//! prints `{ ok: true, <field>: ... }`, and serde ignores the `ok` envelope.

// Every wrapper and shape here is consumed by the subcommand tasks (sign,
// picker, broadcast, peek, quick-send), none wired into dispatch yet; until
// they land the whole module reads as dead to the bin target.
#![allow(dead_code)]

use crate::run::{rt_bin, Output, Runner};

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

#[derive(serde::Deserialize, Clone)]
pub struct ChatPane {
    #[serde(rename = "paneId")]
    pub pane_id: String,
    pub workspace: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    #[serde(rename = "agentStatus")]
    pub agent_status: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub presence: Option<Presence>,
}

/// Human context for one agent handle, distilled from the pane roster: the repo
/// and branch its pane sits in, and the pane title (the agent's task line). Lets
/// a buddy or DM row say what that agent is working on, not just who they are.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentDetail {
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
}

/// Index the pane roster by signed-in handle. Panes with nobody signed in carry
/// no presence and are skipped; a handle in two panes keeps its first pane.
pub fn agent_details(panes: &[ChatPane]) -> std::collections::HashMap<String, AgentDetail> {
    let mut out = std::collections::HashMap::new();
    for p in panes {
        if let Some(pr) = &p.presence {
            out.entry(pr.handle.clone()).or_insert_with(|| AgentDetail {
                repo: p.repo.clone(),
                branch: p.branch.clone(),
                title: p.title.clone(),
            });
        }
    }
    out
}

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
    #[serde(default, rename = "signedInAt")]
    pub signed_in_at: Option<i64>,
}

impl Buddy {
    pub fn display_name(&self) -> &str {
        name_or(&self.name, &self.handle)
    }
}

/// The buddy a pane belongs to. Every chat session is its own identity, so an
/// earlier session's signed-out row can still name the pane beside the live
/// one: a signed-in row wins, then the most recent sign-in.
pub fn buddy_in_pane<'a>(buddies: &'a [Buddy], pane: &str) -> Option<&'a Buddy> {
    buddies
        .iter()
        .filter(|b| b.pane.as_deref() == Some(pane))
        .max_by_key(|b| (b.status != "offline", b.signed_in_at.unwrap_or(i64::MIN)))
}

#[derive(serde::Deserialize)]
pub struct SendResult {
    #[serde(rename = "paneId")]
    pub pane_id: String,
    pub delivered: String,
    #[serde(default)]
    pub reason: Option<String>,
}

/// A failed subprocess's message: its stderr, or a status stand-in when stderr
/// is empty.
fn err_text(out: &Output) -> String {
    let stderr = out.stderr.trim();
    if stderr.is_empty() {
        format!("rt exited with status {}", out.status)
    } else {
        stderr.to_string()
    }
}

/// Run `argv` (optionally with an env overlay), then parse its stdout as `T`.
/// A non-zero status becomes the stderr message; a parse failure becomes the
/// serde error.
fn run_json<T: serde::de::DeserializeOwned>(
    r: &dyn Runner,
    argv: &[&str],
    env: &[(&str, Option<&str>)],
) -> Result<T, String> {
    let out = r.run(argv, env).map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    serde_json::from_str(&out.stdout).map_err(|e| e.to_string())
}

/// Like [`run_json`] but feeds `stdin` to the child. Used to deliver a body rt's
/// `--text` parser would misread from argv (see [`pane_send`]).
fn run_json_stdin<T: serde::de::DeserializeOwned>(
    r: &dyn Runner,
    argv: &[&str],
    env: &[(&str, Option<&str>)],
    stdin: &str,
) -> Result<T, String> {
    let out = r
        .run_with_stdin(argv, env, stdin)
        .map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    serde_json::from_str(&out.stdout).map_err(|e| e.to_string())
}

/// Run `argv` for its exit status alone, discarding stdout.
fn run_ok(r: &dyn Runner, argv: &[&str]) -> Result<(), String> {
    let out = r.run(argv, &[]).map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    Ok(())
}

/// Like [`run_ok`] but feeds `stdin` to the child. Used to deliver a body a
/// leading-dash positional would misparse (see [`post`], [`dm`]).
fn run_ok_stdin(r: &dyn Runner, argv: &[&str], stdin: &str) -> Result<(), String> {
    let out = r
        .run_with_stdin(argv, &[], stdin)
        .map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct Panes {
    panes: Vec<ChatPane>,
}

#[derive(serde::Deserialize)]
struct Rooms {
    rooms: Vec<Room>,
}

#[derive(serde::Deserialize)]
struct Buddies {
    buddies: Vec<Buddy>,
}

pub fn pane_list(r: &dyn Runner) -> Result<Vec<ChatPane>, String> {
    let rt = rt_bin();
    let out: Panes = run_json(r, &[rt.as_str(), "pane", "list", "--json"], &[])?;
    Ok(out.panes)
}

pub fn rooms(r: &dyn Runner) -> Result<Vec<Room>, String> {
    let rt = rt_bin();
    let out: Rooms = run_json(r, &[rt.as_str(), "chat", "rooms", "--json"], &[])?;
    Ok(out.rooms)
}

/// A specific session's rooms (`--session`), for callers that are not that
/// session themselves -- the launcher popup asking about its origin pane.
pub fn rooms_for_session(r: &dyn Runner, session_id: &str) -> Result<Vec<Room>, String> {
    let rt = rt_bin();
    let out: Rooms = run_json(
        r,
        &[
            rt.as_str(),
            "chat",
            "rooms",
            "--session",
            session_id,
            "--json",
        ],
        &[],
    )?;
    Ok(out.rooms)
}

pub fn buddies(r: &dyn Runner) -> Result<Vec<Buddy>, String> {
    let rt = rt_bin();
    let out: Buddies = run_json(r, &[rt.as_str(), "chat", "buddies", "--json"], &[])?;
    Ok(out.buddies)
}

/// Send `text` to a pane. `scrub=true` unsets `HERDR_PANE_ID` in the child so
/// rt does not refuse a deliberate self-target as the caller's own pane.
pub fn pane_send(
    r: &dyn Runner,
    pane: &str,
    text: &str,
    scrub: bool,
) -> Result<SendResult, String> {
    let rt = rt_bin();
    let env: &[(&str, Option<&str>)] = if scrub {
        &[("HERDR_PANE_ID", None)]
    } else {
        &[]
    };
    // rt's `--text` reads the next token verbatim, but the exact value `-` means
    // "read the body from stdin". So a leading-dash body (a bare `-`, `-n`,
    // `--foo`) rides stdin under the `--text -` sentinel and is delivered
    // literally; every other body (newlines included) goes as a single argv arg.
    if text.starts_with('-') {
        run_json_stdin(
            r,
            &[rt.as_str(), "pane", "send", pane, "--text", "-", "--json"],
            env,
            text,
        )
    } else {
        run_json(
            r,
            &[rt.as_str(), "pane", "send", pane, "--text", text, "--json"],
            env,
        )
    }
}

// rt's `resolveBody` treats a lone `-` positional as "read the body from
// stdin" (commands/chat.ts, `positionals`/`resolveBody`); a body
// that IS exactly `-` would otherwise be swallowed as that sentinel rather
// than posted literally. So any body starting with `-` rides stdin under a
// literal `-` positional instead, mirroring pane_send's `--text -` sentinel;
// every other body stays a single positional argv element.
pub fn post(r: &dyn Runner, room: &str, body: &str) -> Result<(), String> {
    let rt = rt_bin();
    if body.starts_with('-') {
        run_ok_stdin(r, &[rt.as_str(), "chat", "post", room, "-"], body)
    } else {
        run_ok(r, &[rt.as_str(), "chat", "post", room, body])
    }
}

/// Run `argv` with `env`, returning stdout on success. Unlike [`run_json`]
/// this does not parse a typed shape: the daemon-side sign-in/out verbs reply
/// with a diagnostic blob the caller only surfaces on error.
fn run_text(r: &dyn Runner, argv: &[&str], env: &[(&str, Option<&str>)]) -> Result<String, String> {
    let out = r.run(argv, env).map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    Ok(out.stdout)
}

/// Run rt's zero-turn daemon-side `chat <verb> --pane <pane>`, scrubbing
/// `HERDR_PANE_ID` like [`pane_send`] so a deliberate self-target is not
/// refused as the caller's own pane.
fn chat_sign_pane(r: &dyn Runner, verb: &str, pane: &str) -> Result<String, String> {
    let rt = rt_bin();
    run_text(
        r,
        &[rt.as_str(), "chat", verb, "--pane", pane, "--json"],
        &[("HERDR_PANE_ID", None)],
    )
}

/// Sign `pane` in to chat daemon-side, with no pane injection.
pub fn chat_sign_in_pane(r: &dyn Runner, pane: &str) -> Result<String, String> {
    chat_sign_pane(r, "sign-in", pane)
}

/// Sign `pane` out of chat daemon-side, with no pane injection.
pub fn chat_sign_out_pane(r: &dyn Runner, pane: &str) -> Result<String, String> {
    chat_sign_pane(r, "sign-out", pane)
}

pub fn dm(r: &dyn Runner, to: &str, body: &str) -> Result<(), String> {
    let rt = rt_bin();
    if body.starts_with('-') {
        run_ok_stdin(r, &[rt.as_str(), "chat", "dm", to, "-"], body)
    } else {
        run_ok(r, &[rt.as_str(), "chat", "dm", to, body])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
        env: Vec<(String, Option<String>)>,
        stdin: Option<String>,
    }

    /// Fake [`Runner`] that maps an argv-prefix to canned stdout and records
    /// every call for later inspection. `Mutex` because `Runner: Send + Sync`
    /// forces `run(&self, ...)` to use interior mutability.
    struct FakeRunner {
        rules: Vec<(String, String)>,
        fallback: Option<String>,
        calls: Mutex<Vec<Call>>,
    }

    impl FakeRunner {
        fn json(prefix: &str, body: &str) -> Self {
            FakeRunner {
                rules: vec![(prefix.to_string(), body.to_string())],
                fallback: None,
                calls: Mutex::new(Vec::new()),
            }
        }

        fn capture(body: &str) -> Self {
            FakeRunner {
                rules: Vec::new(),
                fallback: Some(body.to_string()),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn last(&self) -> Call {
            self.calls
                .lock()
                .unwrap()
                .last()
                .cloned()
                .expect("no call recorded")
        }

        fn record(&self, argv: &[&str], env: &[(&str, Option<&str>)], stdin: Option<String>) {
            self.calls.lock().unwrap().push(Call {
                argv: argv.iter().map(|s| s.to_string()).collect(),
                env: env
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.map(|s| s.to_string())))
                    .collect(),
                stdin,
            });
        }

        fn body_for(&self, argv: &[&str]) -> Output {
            let joined = argv[1..].join(" ");
            let body = self
                .rules
                .iter()
                .find(|(prefix, _)| joined.starts_with(prefix.as_str()))
                .map(|(_, b)| b.clone())
                .or_else(|| self.fallback.clone());
            match body {
                Some(stdout) => Output {
                    status: 0,
                    stdout,
                    stderr: String::new(),
                },
                None => Output {
                    status: 1,
                    stdout: String::new(),
                    stderr: "no matching fake rule".to_string(),
                },
            }
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.record(argv, env, None);
            Ok(self.body_for(argv))
        }

        fn run_with_stdin(
            &self,
            argv: &[&str],
            env: &[(&str, Option<&str>)],
            stdin: &str,
        ) -> std::io::Result<Output> {
            self.record(argv, env, Some(stdin.to_string()));
            Ok(self.body_for(argv))
        }
    }

    #[test]
    fn pane_list_parses_the_json_rows() {
        let r = FakeRunner::json(
            "pane list",
            r#"{"panes":[{"paneId":"w1:p1","workspace":"acme","agentStatus":"idle","presence":{"handle":"meg","status":"live","rooms":["build"]}}]}"#,
        );
        let panes = pane_list(&r).unwrap();
        assert_eq!(panes[0].pane_id, "w1:p1");
        assert_eq!(panes[0].presence.as_ref().unwrap().handle, "meg");
    }

    #[test]
    fn pane_send_scrub_unsets_herdr_pane_id() {
        let r = FakeRunner::capture(r#"{"ok":true,"paneId":"w1:p2","delivered":"accepted"}"#);
        pane_send(&r, "w1:p2", "hi", true).unwrap();
        let call = r.last();
        assert!(call
            .env
            .iter()
            .any(|(k, v)| *k == "HERDR_PANE_ID" && v.is_none()));
        assert_eq!(
            call.argv,
            vec!["rt", "pane", "send", "w1:p2", "--text", "hi", "--json"]
        );
    }

    #[test]
    fn rooms_for_session_passes_the_session_flag() {
        let r = FakeRunner::capture(
            r#"{"ok":true,"rooms":[{"room":"build","unread":1,"mentions":0},{"room":"dm-abc","kind":"dm"}]}"#,
        );
        let rooms = rooms_for_session(&r, "sess-1").unwrap();
        assert_eq!(
            r.last().argv,
            vec!["rt", "chat", "rooms", "--session", "sess-1", "--json"]
        );
        assert_eq!(rooms.len(), 2);
        assert_eq!(rooms[1].kind.as_deref(), Some("dm"));
    }

    #[test]
    fn pane_send_delivers_multiline_text_via_stdin_or_arg() {
        // Chosen contract: text rides as a single `--text` argv element, so a
        // newline survives without a stdin dance.
        let r = FakeRunner::capture(r#"{"ok":true,"paneId":"w1:p2","delivered":"queued"}"#);
        let out = pane_send(&r, "w1:p2", "line one\nline two", false).unwrap();
        assert_eq!(out.delivered, "queued");
        assert_eq!(r.last().argv[5], "line one\nline two");
    }

    #[test]
    fn pane_send_routes_a_leading_dash_message_through_stdin() {
        // A body starting with `-` must not be handed to `--text` as an argv
        // token: it rides stdin under the `--text -` sentinel and is delivered
        // verbatim.
        let r = FakeRunner::capture(r#"{"ok":true,"paneId":"w1:p2","delivered":"accepted"}"#);
        let out = pane_send(&r, "w1:p2", "-rf everything", false).unwrap();
        assert_eq!(out.delivered, "accepted");
        let call = r.last();
        assert_eq!(
            call.argv,
            vec!["rt", "pane", "send", "w1:p2", "--text", "-", "--json"]
        );
        assert_eq!(call.stdin.as_deref(), Some("-rf everything"));
    }

    #[test]
    fn pane_send_routes_a_bare_dash_message_through_stdin() {
        let r = FakeRunner::capture(r#"{"ok":true,"paneId":"w1:p2","delivered":"queued"}"#);
        pane_send(&r, "w1:p2", "-", false).unwrap();
        let call = r.last();
        // The sentinel sits in argv; the literal `-` body rides stdin.
        assert_eq!(call.argv[5], "-");
        assert_eq!(call.stdin.as_deref(), Some("-"));
    }

    #[test]
    fn pane_send_no_scrub_leaves_env_untouched() {
        let r = FakeRunner::capture(r#"{"ok":true,"paneId":"w1:p2","delivered":"queued"}"#);
        pane_send(&r, "w1:p2", "hi", false).unwrap();
        assert!(r.last().env.is_empty());
    }

    #[test]
    fn rooms_parses_summaries() {
        let r = FakeRunner::json(
            "chat rooms",
            r#"{"ok":true,"rooms":[{"room":"build","unread":3,"mentions":1},{"room":"ops"}]}"#,
        );
        let rooms = rooms(&r).unwrap();
        assert_eq!(rooms[0].room, "build");
        assert_eq!(rooms[0].unread, 3);
        assert_eq!(rooms[0].mentions, 1);
        // Absent counts default to zero (RoomSummary always sends them, but a
        // DM-only or minimal row must not fail the parse).
        assert_eq!(rooms[1].unread, 0);
    }

    #[test]
    fn buddies_parses_rows_without_a_rooms_field() {
        let r = FakeRunner::json(
            "chat buddies",
            r#"{"ok":true,"buddies":[{"handle":"meg","status":"live","pane":"w1:p1"}]}"#,
        );
        let buddies = buddies(&r).unwrap();
        assert_eq!(buddies[0].handle, "meg");
        assert_eq!(buddies[0].status, "live");
        assert_eq!(buddies[0].pane.as_deref(), Some("w1:p1"));
        assert!(buddies[0].rooms.is_empty());
    }

    #[test]
    fn post_uses_positional_body() {
        let r = FakeRunner::capture("");
        post(&r, "build", "ship it").unwrap();
        assert_eq!(
            r.last().argv,
            vec!["rt", "chat", "post", "build", "ship it"]
        );
    }

    #[test]
    fn dm_uses_positional_body() {
        let r = FakeRunner::capture("");
        dm(&r, "meg", "hey there").unwrap();
        assert_eq!(r.last().argv, vec!["rt", "chat", "dm", "meg", "hey there"]);
    }

    #[test]
    fn post_routes_a_leading_dash_body_through_stdin() {
        let r = FakeRunner::capture("");
        post(&r, "build", "-rf everything").unwrap();
        let call = r.last();
        assert_eq!(call.argv, vec!["rt", "chat", "post", "build", "-"]);
        assert_eq!(call.stdin.as_deref(), Some("-rf everything"));
    }

    #[test]
    fn post_routes_a_bare_dash_body_through_stdin() {
        let r = FakeRunner::capture("");
        post(&r, "build", "-").unwrap();
        let call = r.last();
        assert_eq!(call.argv, vec!["rt", "chat", "post", "build", "-"]);
        assert_eq!(call.stdin.as_deref(), Some("-"));
    }

    #[test]
    fn dm_routes_a_leading_dash_body_through_stdin() {
        let r = FakeRunner::capture("");
        dm(&r, "meg", "-rf everything").unwrap();
        let call = r.last();
        assert_eq!(call.argv, vec!["rt", "chat", "dm", "meg", "-"]);
        assert_eq!(call.stdin.as_deref(), Some("-rf everything"));
    }

    #[test]
    fn dm_routes_a_bare_dash_body_through_stdin() {
        let r = FakeRunner::capture("");
        dm(&r, "meg", "-").unwrap();
        let call = r.last();
        assert_eq!(call.argv, vec!["rt", "chat", "dm", "meg", "-"]);
        assert_eq!(call.stdin.as_deref(), Some("-"));
    }

    #[test]
    fn chat_sign_in_pane_runs_the_daemon_side_verb_scrubbed() {
        let r = FakeRunner::capture(r#"{"ok":true}"#);
        chat_sign_in_pane(&r, "w1:p1").unwrap();
        let call = r.last();
        assert_eq!(
            call.argv,
            vec!["rt", "chat", "sign-in", "--pane", "w1:p1", "--json"]
        );
        assert!(call
            .env
            .iter()
            .any(|(k, v)| *k == "HERDR_PANE_ID" && v.is_none()));
    }

    #[test]
    fn chat_sign_out_pane_runs_the_daemon_side_verb_scrubbed() {
        let r = FakeRunner::capture(r#"{"ok":true}"#);
        chat_sign_out_pane(&r, "w1:p1").unwrap();
        let call = r.last();
        assert_eq!(
            call.argv,
            vec!["rt", "chat", "sign-out", "--pane", "w1:p1", "--json"]
        );
        assert!(call
            .env
            .iter()
            .any(|(k, v)| *k == "HERDR_PANE_ID" && v.is_none()));
    }

    #[test]
    fn non_zero_status_maps_stderr_to_err() {
        struct Boom;
        impl Runner for Boom {
            fn run(
                &self,
                _argv: &[&str],
                _env: &[(&str, Option<&str>)],
            ) -> std::io::Result<Output> {
                Ok(Output {
                    status: 2,
                    stdout: String::new(),
                    stderr: "rt: not a member".to_string(),
                })
            }
        }
        let err = match rooms(&Boom) {
            Ok(_) => panic!("expected an error"),
            Err(e) => e,
        };
        assert_eq!(err, "rt: not a member");
    }

    #[test]
    fn parse_error_maps_to_err() {
        let r = FakeRunner::json("pane list", "not json");
        assert!(pane_list(&r).is_err());
    }

    #[test]
    fn a_pane_with_two_identities_belongs_to_the_later_one_rt_sends() {
        let r = FakeRunner::json(
            "chat buddies",
            r#"{"ok":true,"buddies":[
                {"handle":"ida","status":"offline","pane":"w1:p2","signedInAt":1790534416270},
                {"handle":"tony.ncu0","name":"tony","status":"offline","pane":"w1:p2","signedInAt":1790542738580}
            ]}"#,
        );
        let all = buddies(&r).unwrap();
        assert_eq!(
            buddy_in_pane(&all, "w1:p2").map(|b| b.handle.as_str()),
            Some("tony.ncu0")
        );
        assert!(buddy_in_pane(&all, "w9:p9").is_none());
    }

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
}
