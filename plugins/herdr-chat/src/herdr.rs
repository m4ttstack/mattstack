//! Typed wrappers over the `herdr` CLI. Jump-to-pane and popup opening need a
//! pane's workspace/tab (herdr has no focus-pane-by-id verb) and the plugin
//! pane open verb. The snapshot verb is `herdr api snapshot`, which prints the
//! live session as `{ "result": { "snapshot": { "panes": [...] } } }`.

// Consumed by the jump-to-pane and popup subcommand tasks, none wired into
// dispatch yet; until they land the module reads as dead to the bin target.
#![allow(dead_code)]

use crate::run::{herdr_bin, Output, Runner};
use std::time::Duration;

pub struct PaneLoc {
    pub workspace_id: String,
    pub tab_id: String,
}

#[derive(serde::Deserialize)]
struct SnapshotEnvelope {
    result: SnapshotResult,
}

#[derive(serde::Deserialize)]
struct SnapshotResult {
    snapshot: Snapshot,
}

#[derive(serde::Deserialize)]
struct Snapshot {
    #[serde(default)]
    panes: Vec<SnapshotPane>,
}

#[derive(serde::Deserialize)]
struct SnapshotPane {
    pane_id: String,
    workspace_id: String,
    tab_id: String,
}

/// A failed subprocess's message: its stderr, or a status stand-in when stderr
/// is empty.
fn err_text(out: &Output) -> String {
    let stderr = out.stderr.trim();
    if stderr.is_empty() {
        format!("herdr exited with status {}", out.status)
    } else {
        stderr.to_string()
    }
}

/// Run `argv` for its exit status alone, discarding stdout.
fn run_ok(r: &dyn Runner, argv: &[&str]) -> Result<(), String> {
    let out = r.run(argv, &[]).map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    Ok(())
}

/// Find a pane in the herdr snapshot: its workspace and tab.
pub fn locate_pane(r: &dyn Runner, pane_id: &str) -> Result<Option<PaneLoc>, String> {
    let herdr = herdr_bin();
    let out = r
        .run(&[herdr.as_str(), "api", "snapshot"], &[])
        .map_err(|e| e.to_string())?;
    if out.status != 0 {
        return Err(err_text(&out));
    }
    let env: SnapshotEnvelope = serde_json::from_str(&out.stdout).map_err(|e| e.to_string())?;
    Ok(env
        .result
        .snapshot
        .panes
        .into_iter()
        .find(|p| p.pane_id == pane_id)
        .map(|p| PaneLoc {
            workspace_id: p.workspace_id,
            tab_id: p.tab_id,
        }))
}

/// Focus a pane's workspace and tab, then zoom the pane by id. herdr has no
/// focus-pane-by-id verb, so jump-to-pane walks the snapshot for the pane's
/// workspace/tab first. Returns false when the pane is absent from the snapshot.
pub fn focus_pane(r: &dyn Runner, pane_id: &str) -> Result<bool, String> {
    let loc = match locate_pane(r, pane_id)? {
        Some(loc) => loc,
        None => return Ok(false),
    };
    let herdr = herdr_bin();
    run_ok(
        r,
        &[herdr.as_str(), "workspace", "focus", &loc.workspace_id],
    )?;
    run_ok(r, &[herdr.as_str(), "tab", "focus", &loc.tab_id])?;
    run_ok(r, &[herdr.as_str(), "pane", "zoom", pane_id, "--on"])?;
    Ok(true)
}

const PLUGIN_ID: &str = "m4ttstack.chat";

/// herdr's refusal while a popup is still registered (`spawn_popup_command`).
const POPUP_BUSY: &str = "popup already open";
const POPUP_OPEN_ATTEMPTS: usize = 40;
const POPUP_OPEN_RETRY_DELAY: Duration = Duration::from_millis(50);

/// Open a plugin popup pane entrypoint for the chat plugin. herdr holds one
/// popup per session and refuses a second until the previous one's process
/// has exited and been reaped, so an open that lands in that window (a popup
/// handing off to a sibling capability) waits it out instead of failing.
pub fn open_popup(r: &dyn Runner, entrypoint: &str) -> Result<(), String> {
    open_popup_with_retry(r, entrypoint, POPUP_OPEN_ATTEMPTS, POPUP_OPEN_RETRY_DELAY)
}

fn open_popup_with_retry(
    r: &dyn Runner,
    entrypoint: &str,
    attempts: usize,
    delay: Duration,
) -> Result<(), String> {
    let herdr = herdr_bin();
    let argv = [
        herdr.as_str(),
        "plugin",
        "pane",
        "open",
        "--plugin",
        PLUGIN_ID,
        "--entrypoint",
        entrypoint,
    ];
    let mut attempt = 0;
    loop {
        attempt += 1;
        let out = r.run(&argv, &[]).map_err(|e| e.to_string())?;
        if out.status == 0 {
            return Ok(());
        }
        if !out.stderr.contains(POPUP_BUSY) || attempt >= attempts {
            return Err(err_text(&out));
        }
        std::thread::sleep(delay);
    }
}

/// Invoke one of this plugin's manifest actions through herdr. The action
/// runs as herdr's own child, outside the calling popup's process session,
/// so it survives that popup's teardown (herdr signals the whole session).
pub fn invoke_action(r: &dyn Runner, action_id: &str) -> Result<(), String> {
    let herdr = herdr_bin();
    run_ok(
        r,
        &[
            herdr.as_str(),
            "plugin",
            "action",
            "invoke",
            action_id,
            "--plugin",
            PLUGIN_ID,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    enum Mode {
        /// Return the next canned body per call, in order; each entry's label
        /// must appear in that call's joined argv.
        Script(Mutex<VecDeque<(String, String)>>),
        /// Return the body of the first rule whose needle the joined argv
        /// contains, else the fallback, else a non-zero "no rule" result.
        Rules {
            rules: Vec<(String, String)>,
            fallback: Option<String>,
        },
    }

    /// Fake [`Runner`] that records every argv and serves canned stdout. `Mutex`
    /// because `Runner: Send + Sync` forces `run(&self, ...)` to use interior
    /// mutability.
    struct FakeRunner {
        mode: Mode,
        calls: Mutex<Vec<Vec<String>>>,
    }

    impl FakeRunner {
        fn script(entries: &[(&str, &str)]) -> Self {
            FakeRunner {
                mode: Mode::Script(Mutex::new(
                    entries
                        .iter()
                        .map(|(label, body)| (label.to_string(), body.to_string()))
                        .collect(),
                )),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn json(needle: &str, body: &str) -> Self {
            FakeRunner {
                mode: Mode::Rules {
                    rules: vec![(needle.to_string(), body.to_string())],
                    fallback: None,
                },
                calls: Mutex::new(Vec::new()),
            }
        }

        fn capture(body: &str) -> Self {
            FakeRunner {
                mode: Mode::Rules {
                    rules: Vec::new(),
                    fallback: Some(body.to_string()),
                },
                calls: Mutex::new(Vec::new()),
            }
        }

        fn argvs(&self) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().clone()
        }

        fn last(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap()
                .last()
                .cloned()
                .expect("no call recorded")
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls
                .lock()
                .unwrap()
                .push(argv.iter().map(|s| s.to_string()).collect());
            let joined = argv[1..].join(" ");
            let body = match &self.mode {
                Mode::Script(queue) => {
                    let (label, body) = queue
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("script exhausted: unexpected extra call");
                    assert!(
                        joined.contains(&label),
                        "call {joined:?} did not match scripted label {label:?}"
                    );
                    Some(body)
                }
                Mode::Rules { rules, fallback } => rules
                    .iter()
                    .find(|(needle, _)| joined.contains(needle.as_str()))
                    .map(|(_, body)| body.clone())
                    .or_else(|| fallback.clone()),
            };
            match body {
                Some(stdout) => Ok(Output {
                    status: 0,
                    stdout,
                    stderr: String::new(),
                }),
                None => Ok(Output {
                    status: 1,
                    stdout: String::new(),
                    stderr: "no matching fake rule".to_string(),
                }),
            }
        }
    }

    // Real `herdr api snapshot` wraps the session as
    // `{"result":{"snapshot":{"panes":[...]}}}`; the fakes mirror that envelope.
    const ONE_PANE: &str = r#"{"result":{"snapshot":{"panes":[{"pane_id":"w1:p2","workspace_id":"w1","tab_id":"w1:t1"}]}}}"#;
    const NO_PANES: &str = r#"{"result":{"snapshot":{"panes":[]}}}"#;

    #[test]
    fn focus_pane_walks_snapshot_then_zooms() {
        let r = FakeRunner::script(&[
            ("snapshot", ONE_PANE),
            ("workspace", "{}"),
            ("tab", "{}"),
            ("pane", "{}"),
        ]);
        assert!(focus_pane(&r, "w1:p2").unwrap());
        let methods = r.argvs();
        assert!(methods.iter().any(|a| a.contains(&"zoom".to_string())));
        // Order matters: snapshot read, then workspace, then tab, then zoom.
        assert_eq!(methods[0], vec!["herdr", "api", "snapshot"]);
        assert_eq!(methods[1], vec!["herdr", "workspace", "focus", "w1"]);
        assert_eq!(methods[2], vec!["herdr", "tab", "focus", "w1:t1"]);
        assert_eq!(methods[3], vec!["herdr", "pane", "zoom", "w1:p2", "--on"]);
    }

    #[test]
    fn focus_pane_is_false_when_pane_absent() {
        let r = FakeRunner::json("snapshot", NO_PANES);
        assert!(!focus_pane(&r, "w9:p9").unwrap());
        // No focus/tab/zoom calls when the pane is absent: snapshot only.
        assert_eq!(r.argvs().len(), 1);
    }

    #[test]
    fn locate_pane_returns_workspace_and_tab() {
        let r = FakeRunner::json("snapshot", ONE_PANE);
        let loc = locate_pane(&r, "w1:p2").unwrap().expect("pane present");
        assert_eq!(loc.workspace_id, "w1");
        assert_eq!(loc.tab_id, "w1:t1");
        assert_eq!(r.last(), vec!["herdr", "api", "snapshot"]);
    }

    #[test]
    fn locate_pane_is_none_when_absent() {
        let r = FakeRunner::json("snapshot", NO_PANES);
        assert!(locate_pane(&r, "w9:p9").unwrap().is_none());
    }

    #[test]
    fn locate_pane_propagates_a_snapshot_failure() {
        struct Boom;
        impl Runner for Boom {
            fn run(
                &self,
                _argv: &[&str],
                _env: &[(&str, Option<&str>)],
            ) -> std::io::Result<Output> {
                Ok(Output {
                    status: 1,
                    stdout: String::new(),
                    stderr: "herdr: no server".to_string(),
                })
            }
        }
        let err = match focus_pane(&Boom, "w1:p2") {
            Ok(_) => panic!("expected an error"),
            Err(e) => e,
        };
        assert_eq!(err, "herdr: no server");
    }

    #[test]
    fn open_popup_builds_the_plugin_open_argv() {
        let r = FakeRunner::capture("{}");
        open_popup(&r, "compose").unwrap();
        assert_eq!(
            r.last(),
            vec![
                "herdr",
                "plugin",
                "pane",
                "open",
                "--plugin",
                "m4ttstack.chat",
                "--entrypoint",
                "compose",
            ]
        );
    }

    /// Fake [`Runner`] that refuses the first `busy` calls the way herdr does
    /// while a previous popup is still tearing down, then succeeds.
    struct BusyThenOk {
        remaining: Mutex<usize>,
        calls: Mutex<usize>,
    }

    impl BusyThenOk {
        fn refusing(busy: usize) -> Self {
            BusyThenOk {
                remaining: Mutex::new(busy),
                calls: Mutex::new(0),
            }
        }
    }

    impl Runner for BusyThenOk {
        fn run(&self, _argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            *self.calls.lock().unwrap() += 1;
            let mut remaining = self.remaining.lock().unwrap();
            if *remaining > 0 {
                *remaining -= 1;
                return Ok(Output {
                    status: 1,
                    stdout: String::new(),
                    stderr: r#"{"id":"cli:plugin","error":{"code":"plugin_pane_open_failed","message":"popup already open"}}"#.to_string(),
                });
            }
            Ok(Output {
                status: 0,
                stdout: "{}".to_string(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn open_popup_retries_while_the_previous_popup_is_closing() {
        let r = BusyThenOk::refusing(2);
        open_popup_with_retry(&r, "broadcast-ui", 5, std::time::Duration::ZERO).unwrap();
        assert_eq!(*r.calls.lock().unwrap(), 3);
    }

    #[test]
    fn open_popup_gives_up_after_the_retry_budget() {
        let r = BusyThenOk::refusing(usize::MAX);
        let err = open_popup_with_retry(&r, "broadcast-ui", 4, std::time::Duration::ZERO)
            .expect_err("expected the busy refusal to surface");
        assert!(
            err.contains("popup already open"),
            "unexpected error: {err}"
        );
        assert_eq!(*r.calls.lock().unwrap(), 4);
    }

    #[test]
    fn open_popup_does_not_retry_other_failures() {
        let r = FakeRunner::json("nothing-matches", "{}");
        let err = open_popup_with_retry(&r, "broadcast-ui", 5, std::time::Duration::ZERO)
            .expect_err("expected the failure to surface");
        assert_eq!(err, "no matching fake rule");
        assert_eq!(r.argvs().len(), 1);
    }

    #[test]
    fn invoke_action_builds_the_plugin_action_invoke_argv() {
        let r = FakeRunner::capture("{}");
        invoke_action(&r, "broadcast").unwrap();
        assert_eq!(
            r.last(),
            vec![
                "herdr",
                "plugin",
                "action",
                "invoke",
                "broadcast",
                "--plugin",
                "m4ttstack.chat",
            ]
        );
    }
}
