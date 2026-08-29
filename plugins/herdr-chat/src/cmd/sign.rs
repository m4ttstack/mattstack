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

pub fn run(runner: &dyn Runner) -> Result<String, String> {
    let pane = std::env::var("HERDR_PANE_ID")
        .ok()
        .as_deref()
        .map(|s| s.to_string());
    run_with(runner, Sign::In, pane.as_deref())
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

    struct FakeRunner {
        calls: Mutex<Vec<Call>>,
    }

    impl FakeRunner {
        fn capture(_body: &str) -> Self {
            FakeRunner {
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
            Ok(Output {
                status: 0,
                stdout: r#"{"paneId":"w1:p1","delivered":"accepted"}"#.to_string(),
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
}
