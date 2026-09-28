use crate::rt;
use crate::run::Runner;

pub enum Sign {
    In,
    Out,
}

pub fn run_with(runner: &dyn Runner, which: Sign, pane: Option<&str>) -> Result<String, String> {
    let pane = pane.ok_or_else(|| "pane is required".to_string())?;
    match which {
        Sign::In => rt::chat_sign_in_pane(runner, pane),
        Sign::Out => rt::chat_sign_out_pane(runner, pane),
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
        env: Vec<(String, Option<String>)>,
    }

    /// `capture` replays one fixed body forever; `sequence` serves the given
    /// bodies in order, one per call, for a run that reads state back after
    /// acting on it, and panics once drained rather than answering empty.
    struct FakeRunner {
        bodies: Mutex<VecDeque<String>>,
        fallback: Option<String>,
        calls: Mutex<Vec<Call>>,
    }

    impl FakeRunner {
        fn capture(body: &str) -> Self {
            FakeRunner {
                bodies: Mutex::new(VecDeque::new()),
                fallback: Some(body.to_string()),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn sequence(bodies: &[&str]) -> Self {
            FakeRunner {
                bodies: Mutex::new(bodies.iter().map(|s| s.to_string()).collect()),
                fallback: None,
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

        fn argv_at(&self, n: usize) -> Vec<String> {
            self.calls.lock().unwrap()[n].argv.clone()
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
            let body = self
                .bodies
                .lock()
                .unwrap()
                .pop_front()
                .or_else(|| self.fallback.clone())
                .expect("sequence exhausted: unexpected extra call");
            Ok(Output {
                status: 0,
                stdout: body,
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn sign_in_calls_the_daemon_side_sign_in_for_the_focused_pane_scrubbed() {
        let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
        run_with(&r, Sign::In, Some("w1:p1")).unwrap();
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
    fn sign_in_without_a_pane_is_a_clear_error() {
        let r = FakeRunner::capture("{}");
        assert!(run_with(&r, Sign::In, None).is_err());
    }

    #[test]
    fn sign_out_calls_the_daemon_side_sign_out_for_the_focused_pane_scrubbed() {
        let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
        run_with(&r, Sign::Out, Some("w1:p1")).unwrap();
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
    fn sign_out_without_a_pane_is_a_clear_error() {
        let r = FakeRunner::capture("{}");
        assert!(run_with(&r, Sign::Out, None).is_err());
    }

    #[test]
    fn sign_in_json_answers_with_the_header_the_pane_now_has() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"handle":"kay","room":"rt"}"#,
            r#"{"ok":true,"buddies":[{"handle":"kay","status":"live","sessionId":"s-kay","pane":"w1:p1"}]}"#,
            r#"{"ok":true,"rooms":[{"room":"rt","unread":0}]}"#,
        ]);
        let s = run_json(&r, Sign::In, Some("w1:p1")).unwrap();
        assert_eq!(s.handle.as_deref(), Some("kay"));
        assert_eq!(s.name.as_deref(), Some("kay"));
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
}
