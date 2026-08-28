use crate::rt;
use crate::run::Runner;

pub enum Sign {
    In,
    Out,
}

pub fn run_with(
    runner: &dyn Runner,
    which: Sign,
    pane: Option<&str>,
) -> Result<rt::SendResult, String> {
    let pane = pane.ok_or_else(|| "pane is required".to_string())?;
    let cmd = match which {
        Sign::In => "/chat:sign-in",
        Sign::Out => "/chat:sign-out",
    };
    rt::pane_send(runner, pane, cmd, true)
}

pub fn run(runner: &dyn Runner) -> Result<rt::SendResult, String> {
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
    fn sign_in_injects_the_slash_command_into_the_focused_pane_scrubbed() {
        let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
        run_with(&r, Sign::In, Some("w1:p1")).unwrap();
        let call = r.last();
        assert_eq!(
            call.argv,
            vec![
                "rt",
                "pane",
                "send",
                "w1:p1",
                "--text",
                "/chat:sign-in",
                "--json"
            ]
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
    fn sign_out_injects_the_slash_command_into_the_focused_pane_scrubbed() {
        let r = FakeRunner::capture(r#"{"paneId":"w1:p1","delivered":"accepted"}"#);
        run_with(&r, Sign::Out, Some("w1:p1")).unwrap();
        let call = r.last();
        assert_eq!(
            call.argv,
            vec![
                "rt",
                "pane",
                "send",
                "w1:p1",
                "--text",
                "/chat:sign-out",
                "--json"
            ]
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
