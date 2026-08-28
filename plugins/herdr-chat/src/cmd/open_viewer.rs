use crate::deck;
use crate::run::Runner;

/// Resolve the chat viewer URL from deck, deep-link to `/r/<room>` when a room
/// is given, and hand it to `open`. Errs when the URL cannot be resolved or the
/// `open` subprocess fails, so a failed open surfaces instead of passing as a
/// silent success.
pub fn run(runner: &dyn Runner, room: Option<&str>) -> Result<(), String> {
    let base = deck::viewer_url_real(runner)
        .map_err(|e| format!("could not resolve the viewer URL: {e}"))?;
    let url = match room {
        Some(r) => format!("{}/r/{}", base.trim_end_matches('/'), r),
        None => base,
    };
    match runner.run(&["open", url.as_str()], &[]) {
        Ok(o) if o.status == 0 => Ok(()),
        Ok(o) => Err(format!("open exited {}", o.status)),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::sync::Mutex;

    struct FakeRunner {
        calls: Mutex<Vec<Vec<String>>>,
    }

    impl FakeRunner {
        fn new() -> Self {
            FakeRunner {
                calls: Mutex::new(Vec::new()),
            }
        }
        fn open_call(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .find(|c| c.first().map(String::as_str) == Some("open"))
                .expect("open was never called")
                .clone()
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls
                .lock()
                .unwrap()
                .push(argv.iter().map(|s| s.to_string()).collect());
            // Short-circuit URL resolution: answer `deck url chat` with the URL
            // so the resolver never touches real fs or HTTP.
            if argv.first() == Some(&"deck") {
                return Ok(Output {
                    status: 0,
                    stdout: "https://chat.mattstack\n".to_string(),
                    stderr: String::new(),
                });
            }
            Ok(Output {
                status: 0,
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn opens_the_resolved_url() {
        let r = FakeRunner::new();
        run(&r, None).unwrap();
        assert_eq!(
            r.open_call(),
            vec!["open".to_string(), "https://chat.mattstack".to_string()]
        );
    }

    #[test]
    fn appends_the_room_suffix() {
        let r = FakeRunner::new();
        run(&r, Some("build")).unwrap();
        assert_eq!(
            r.open_call(),
            vec![
                "open".to_string(),
                "https://chat.mattstack/r/build".to_string()
            ]
        );
    }
}
