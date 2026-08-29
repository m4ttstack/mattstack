//! The `on-agent-detected` event hook. herdr fires `pane.agent_detected` when a
//! pane gains (or loses) an agent; this routes it per the repo's sign-in
//! preference. The pure [`decide`] carries the routing so it is unit-tested
//! without a running herdr or a terminal.

use std::path::Path;

use crate::herdr;
use crate::rt;
use crate::run::Runner;
use crate::state::{self, SigninPref};

/// The pane a `pane.agent_detected` envelope names, once parsed. `released`
/// true means the agent was let go (process exit or detach), not a fresh
/// detection, so the caller must not prompt for it.
#[derive(Debug, PartialEq)]
pub struct Detected {
    pub pane_id: String,
    pub released: bool,
}

/// What [`decide`] did, so callers (and tests) can see the route taken.
#[derive(Debug, PartialEq)]
pub enum Decision {
    /// pref = Never: no injection, nothing queued.
    Skipped,
    /// pref = Always: daemon-side sign-in called for the pane (scrubbed).
    Injected,
    /// pref = Ask: pane queued and the popup opened.
    Prompted,
    /// pref = Ask: pane queued, but a popup was already open (`ui_busy`); that
    /// open popup drains the pane on its final pass.
    PromptedPending,
}

/// Parse a `HERDR_PLUGIN_EVENT_JSON` envelope for a `pane.agent_detected`
/// event. Returns `None` when the JSON is not that event or carries no pane id.
///
/// herdr serializes the whole `EventEnvelope`; the pane id lives at
/// `data.pane_id`, and `data.released` is omitted when false.
pub fn parse_detected(json: &str) -> Option<Detected> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let data = value.get("data")?;
    if data.get("type").and_then(|t| t.as_str()) != Some("pane_agent_detected") {
        return None;
    }
    let pane_id = data.get("pane_id")?.as_str()?.to_string();
    let released = data
        .get("released")
        .and_then(|r| r.as_bool())
        .unwrap_or(false);
    Some(Detected { pane_id, released })
}

/// The repo key for a pane: rt's own `repo` field when present, else the final
/// path component of the pane's cwd. `None` when the pane is absent from the
/// list or yields neither.
pub fn repo_from_panes(panes: &[rt::ChatPane], pane_id: &str) -> Option<String> {
    let pane = panes.iter().find(|p| p.pane_id == pane_id)?;
    if let Some(repo) = pane.repo.as_deref() {
        if !repo.is_empty() {
            return Some(repo.to_string());
        }
    }
    let name = Path::new(pane.cwd.as_deref()?).file_name()?.to_str()?;
    (!name.is_empty()).then(|| name.to_string())
}

/// Route a detected pane per its repo's sign-in preference.
pub fn decide(runner: &dyn Runner, dir: &Path, repo: &str, pane: &str) -> Result<Decision, String> {
    match state::get_pref(dir, repo) {
        SigninPref::Never => Ok(Decision::Skipped),
        SigninPref::Always => {
            rt::chat_sign_in_pane(runner, pane)?;
            Ok(Decision::Injected)
        }
        SigninPref::Ask => {
            // Queue first, so the pane is safe whether the open succeeds, hits
            // ui_busy, or fails outright.
            state::push_pending(dir, pane).map_err(|e| e.to_string())?;
            match herdr::open_popup(runner, "signin-ask") {
                Ok(()) => Ok(Decision::Prompted),
                Err(e) if is_ui_busy(&e) => Ok(Decision::PromptedPending),
                Err(e) => Err(e),
            }
        }
    }
}

/// Parse the CLI's `herdr plugin pane open` failure text (a JSON-RPC error) and
/// report whether its code is `ui_busy` (a popup is already open).
fn is_ui_busy(err: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(err) else {
        return false;
    };
    value
        .get("error")
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_str())
        == Some("ui_busy")
}

/// Entry point for the `on-agent-detected` subcommand: parse the event JSON,
/// derive the repo from the detected pane, and [`decide`]. A released agent or
/// an unparseable event is a no-op.
pub fn run(runner: &dyn Runner) -> Result<(), String> {
    let json = std::env::var("HERDR_PLUGIN_EVENT_JSON")
        .map_err(|_| "HERDR_PLUGIN_EVENT_JSON is not set".to_string())?;
    let Some(detected) = parse_detected(&json) else {
        return Ok(());
    };
    if detected.released {
        return Ok(());
    }
    let dir = state::state_dir();
    let panes = rt::pane_list(runner).unwrap_or_default();
    let repo =
        repo_from_panes(&panes, &detected.pane_id).unwrap_or_else(|| detected.pane_id.clone());
    decide(runner, &dir, &repo, &detected.pane_id).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
        env: Vec<(String, Option<String>)>,
    }

    struct Reply {
        status: i32,
        stdout: String,
        stderr: String,
    }

    /// Fake [`Runner`] that records calls and serves a per-prefix reply (with a
    /// configurable status and stderr, so the `ui_busy` open failure can be
    /// simulated), falling back to a shared success body.
    struct FakeRunner {
        rules: Vec<(String, Reply)>,
        fallback: String,
        calls: Mutex<Vec<Call>>,
    }

    impl FakeRunner {
        /// All calls succeed with `body` on stdout.
        fn ok(body: &str) -> Self {
            FakeRunner {
                rules: Vec::new(),
                fallback: body.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn with_rule(mut self, prefix: &str, status: i32, stdout: &str, stderr: &str) -> Self {
            self.rules.push((
                prefix.to_string(),
                Reply {
                    status,
                    stdout: stdout.to_string(),
                    stderr: stderr.to_string(),
                },
            ));
            self
        }

        fn last(&self) -> Call {
            self.calls
                .lock()
                .unwrap()
                .last()
                .cloned()
                .expect("no call recorded")
        }

        fn argvs(&self) -> Vec<Vec<String>> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .map(|c| c.argv.clone())
                .collect()
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls.lock().unwrap().push(Call {
                argv: argv.iter().map(|s| s.to_string()).collect(),
                env: env
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.map(|s| s.to_string())))
                    .collect(),
            });
            let joined = argv[1..].join(" ");
            if let Some((_, reply)) = self
                .rules
                .iter()
                .find(|(prefix, _)| joined.contains(prefix.as_str()))
            {
                return Ok(Output {
                    status: reply.status,
                    stdout: reply.stdout.clone(),
                    stderr: reply.stderr.clone(),
                });
            }
            Ok(Output {
                status: 0,
                stdout: self.fallback.clone(),
                stderr: String::new(),
            })
        }
    }

    const SEND_OK: &str = r#"{"paneId":"w1:p1","delivered":"accepted"}"#;
    const UI_BUSY: &str = r#"{"id":"cli:plugin","error":{"code":"ui_busy","message":"popup panes can only open from the normal workspace view"}}"#;

    // Real envelope from herdr: EventEnvelope { event, data } with data internally
    // tagged by `type`; the pane id is `data.pane_id`, `released` omitted when false.
    const DETECTED: &str = r#"{"event":"pane_agent_detected","data":{"type":"pane_agent_detected","pane_id":"w1:p1","workspace_id":"w1","agent":"claude"}}"#;
    const RELEASED: &str = r#"{"event":"pane_agent_detected","data":{"type":"pane_agent_detected","pane_id":"w1:p1","workspace_id":"w1","released":true,"final_status":"idle"}}"#;

    #[test]
    fn ask_default_queues_the_pane_and_opens_the_popup() {
        let r = FakeRunner::ok(SEND_OK);
        let d = tempfile::tempdir().unwrap();
        // pref defaults to Ask: pane is queued, popup opened.
        assert_eq!(
            decide(&r, d.path(), "chat", "w1:p1").unwrap(),
            Decision::Prompted
        );
        assert_eq!(state::drain_pending(d.path()).unwrap(), vec!["w1:p1"]);
        // The open call went to the signin-ask entrypoint.
        assert!(r
            .argvs()
            .iter()
            .any(|a| a.contains(&"open".to_string()) && a.contains(&"signin-ask".to_string())));
    }

    #[test]
    fn always_calls_the_daemon_side_scrubbed_sign_in() {
        let r = FakeRunner::ok(SEND_OK);
        let d = tempfile::tempdir().unwrap();
        state::set_pref(d.path(), "chat", SigninPref::Always).unwrap();
        assert_eq!(
            decide(&r, d.path(), "chat", "w1:p2").unwrap(),
            Decision::Injected
        );
        let call = r.last();
        assert_eq!(
            call.argv,
            vec!["rt", "chat", "sign-in", "--pane", "w1:p2", "--json"]
        );
        assert!(call
            .env
            .iter()
            .any(|(k, v)| *k == "HERDR_PANE_ID" && v.is_none()));
        // Always never queues a pending pane.
        assert!(state::drain_pending(d.path()).unwrap().is_empty());
    }

    #[test]
    fn never_does_nothing() {
        let r = FakeRunner::ok(SEND_OK);
        let d = tempfile::tempdir().unwrap();
        state::set_pref(d.path(), "chat", SigninPref::Never).unwrap();
        assert_eq!(
            decide(&r, d.path(), "chat", "w1:p3").unwrap(),
            Decision::Skipped
        );
        assert!(r.calls.lock().unwrap().is_empty());
        assert!(state::drain_pending(d.path()).unwrap().is_empty());
    }

    #[test]
    fn ask_leaves_pane_pending_when_popup_is_ui_busy() {
        // The open fails with ui_busy (a popup is already up); the pane stays
        // queued for that popup to drain, and decide does not error.
        let r = FakeRunner::ok(SEND_OK).with_rule("plugin pane open", 1, "", UI_BUSY);
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            decide(&r, d.path(), "chat", "w1:p9").unwrap(),
            Decision::PromptedPending
        );
        assert_eq!(state::drain_pending(d.path()).unwrap(), vec!["w1:p9"]);
    }

    #[test]
    fn ask_propagates_a_non_ui_busy_open_error_but_still_queues() {
        let r = FakeRunner::ok(SEND_OK).with_rule("plugin pane open", 1, "", "herdr: no server");
        let d = tempfile::tempdir().unwrap();
        assert!(decide(&r, d.path(), "chat", "w1:p9").is_err());
        // Queued before the open was attempted, so the pane is not lost.
        assert_eq!(state::drain_pending(d.path()).unwrap(), vec!["w1:p9"]);
    }

    #[test]
    fn parse_detected_reads_pane_id_and_released_flag() {
        let d = parse_detected(DETECTED).expect("parsed");
        assert_eq!(d.pane_id, "w1:p1");
        assert!(!d.released);

        let rel = parse_detected(RELEASED).expect("parsed");
        assert_eq!(rel.pane_id, "w1:p1");
        assert!(rel.released);
    }

    #[test]
    fn parse_detected_rejects_other_events_and_garbage() {
        let other = r#"{"event":"pane_focused","data":{"type":"pane_focused","pane_id":"w1:p1","workspace_id":"w1"}}"#;
        assert!(parse_detected(other).is_none());
        assert!(parse_detected("not json").is_none());
        assert!(parse_detected("{}").is_none());
    }

    #[test]
    fn repo_from_panes_prefers_repo_then_cwd_basename() {
        let panes = vec![
            chat_pane(
                "w1:p1",
                Some("chat"),
                Some("/Users/matt/Documents/GitHub/chat"),
            ),
            chat_pane(
                "w1:p2",
                None,
                Some("/Users/matt/Documents/GitHub/repo-tools"),
            ),
            chat_pane("w1:p3", None, None),
        ];
        assert_eq!(repo_from_panes(&panes, "w1:p1").as_deref(), Some("chat"));
        assert_eq!(
            repo_from_panes(&panes, "w1:p2").as_deref(),
            Some("repo-tools")
        );
        assert_eq!(repo_from_panes(&panes, "w1:p3"), None);
        assert_eq!(repo_from_panes(&panes, "absent"), None);
    }

    fn chat_pane(id: &str, repo: Option<&str>, cwd: Option<&str>) -> rt::ChatPane {
        rt::ChatPane {
            pane_id: id.to_string(),
            workspace: "w1".to_string(),
            title: None,
            cwd: cwd.map(|s| s.to_string()),
            repo: repo.map(|s| s.to_string()),
            branch: None,
            agent_status: "idle".to_string(),
            session_id: None,
            presence: None,
        }
    }

    #[test]
    fn is_ui_busy_matches_only_the_ui_busy_code() {
        assert!(is_ui_busy(UI_BUSY));
        assert!(!is_ui_busy(
            r#"{"error":{"code":"plugin_disabled","message":"x"}}"#
        ));
        assert!(!is_ui_busy("herdr: no server"));
    }
}
