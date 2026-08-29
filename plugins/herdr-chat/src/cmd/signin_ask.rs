//! The `signin-ask` popup: for every pane queued by the `on-agent-detected`
//! hook, ask whether to sign that pane in to chat. yes/always call the
//! daemon-side sign-in (scrubbed); always/never persist the repo's
//! preference. The pending file is drained again after the popup so a pane
//! queued while it was open (its own open having hit `ui_busy`) is picked up
//! rather than stranded.

use crate::cmd::detect::repo_from_panes;
use crate::rt;
use crate::run::Runner;
use crate::state::{self, SigninPref};
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::KeyCode;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

#[derive(Clone, Copy, PartialEq)]
enum Choice {
    Yes,
    Always,
    Never,
    Skip,
}

pub fn run(runner: &dyn Runner) -> Result<(), String> {
    let dir = state::state_dir();
    let theme = theme::load();
    // Drain, present, apply; then drain again. A pane queued while the popup was
    // open (whose own `plugin pane open` hit ui_busy) lands here on the re-drain
    // rather than waiting for the next detection.
    loop {
        let panes = state::drain_pending(&dir).map_err(|e| e.to_string())?;
        if panes.is_empty() {
            break;
        }
        let list = rt::pane_list(runner).unwrap_or_default();
        let repos: Vec<String> = panes
            .iter()
            .map(|pane| repo_from_panes(&list, pane).unwrap_or_else(|| pane.clone()))
            .collect();
        let choices = prompt(&theme, &panes, &repos).map_err(|e| e.to_string())?;
        apply(runner, &dir, &panes, &repos, &choices)?;
    }
    Ok(())
}

/// Run the modal popup over the queued panes, one prompt per pane, and return a
/// choice for each. Esc or `q` skips the current pane and every one after it.
fn prompt(theme: &AppTheme, panes: &[String], repos: &[String]) -> std::io::Result<Vec<Choice>> {
    let mut idx = 0usize;
    let mut choices = vec![Choice::Skip; panes.len()];
    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                    choices[idx] = Choice::Yes;
                    idx += 1;
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    choices[idx] = Choice::Always;
                    idx += 1;
                }
                KeyCode::Char('n') | KeyCode::Char('N') => {
                    choices[idx] = Choice::Never;
                    idx += 1;
                }
                KeyCode::Char('s') | KeyCode::Char('S') => {
                    choices[idx] = Choice::Skip;
                    idx += 1;
                }
                KeyCode::Esc | KeyCode::Char('q') => exit = true,
                _ => {}
            }
            if idx >= panes.len() {
                exit = true;
            }
        }
        let shown = idx.min(panes.len().saturating_sub(1));
        draw(frame, theme, panes, repos, shown);
        if exit {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })?;
    Ok(choices)
}

// The panes were already drained out of `pending.json`, so a fail-fast on the
// first send would strand every pane after it: removed from the queue yet never
// signed in or re-queued. So each pane is attempted independently and its
// failure collected; the loop runs to the end and the errors are surfaced
// together afterward.
fn apply(
    runner: &dyn Runner,
    dir: &std::path::Path,
    panes: &[String],
    repos: &[String],
    choices: &[Choice],
) -> Result<(), String> {
    let mut failures: Vec<String> = Vec::new();
    for ((pane, repo), choice) in panes.iter().zip(repos).zip(choices) {
        match choice {
            Choice::Yes => {
                if let Err(e) = rt::chat_sign_in_pane(runner, pane) {
                    failures.push(format!("{pane}: {e}"));
                }
            }
            Choice::Always => {
                if let Err(e) = state::set_pref(dir, repo, SigninPref::Always) {
                    failures.push(format!("{repo}: {e}"));
                }
                if let Err(e) = rt::chat_sign_in_pane(runner, pane) {
                    failures.push(format!("{pane}: {e}"));
                }
            }
            Choice::Never => {
                if let Err(e) = state::set_pref(dir, repo, SigninPref::Never) {
                    failures.push(format!("{repo}: {e}"));
                }
            }
            Choice::Skip => {}
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn draw(frame: &mut Frame, theme: &AppTheme, panes: &[String], repos: &[String], idx: usize) {
    let inner = ui::content(frame.area());

    let mut body: Vec<Line> = Vec::new();
    // herdr's popup title is static, so surface the queue position here when
    // more than one detected pane is waiting on an answer.
    if panes.len() > 1 {
        body.push(Line::from(Span::styled(
            format!("{} of {}", idx + 1, panes.len()),
            theme.dim,
        )));
        body.push(Line::from(""));
    }
    body.push(Line::from(Span::styled(
        format!("Agent detected in {}", repos[idx]),
        theme.accent,
    )));
    body.push(Line::from(Span::styled(
        format!("pane {}", panes[idx]),
        theme.dim,
    )));
    body.push(Line::from(""));
    body.push(Line::from("Sign in to chat?"));
    body.push(Line::from(vec![
        Span::styled("[y]", theme.accent),
        Span::raw("es  "),
        Span::styled("[a]", theme.accent),
        Span::raw("lways  "),
        Span::styled("[n]", theme.accent),
        Span::raw("ever  "),
        Span::styled("[s]", theme.accent),
        Span::raw("kip"),
    ]));

    let para = Paragraph::new(body)
        .style(theme.base)
        .wrap(Wrap { trim: true });
    frame.render_widget(para, inner);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::sync::Mutex;

    /// Fake [`Runner`] that records each `pane send` target and fails the one
    /// whose id is `boom`, so a test can prove a mid-batch send failure does not
    /// strand the panes queued after it.
    struct FakeRunner {
        boom: String,
        sent: Mutex<Vec<String>>,
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            // `chat sign-in --pane <pane> --json`: the target is argv[4].
            let pane = argv.get(4).copied().unwrap_or_default();
            self.sent.lock().unwrap().push(pane.to_string());
            if pane == self.boom {
                Ok(Output {
                    status: 1,
                    stdout: String::new(),
                    stderr: "rt: no such pane".to_string(),
                })
            } else {
                Ok(Output {
                    status: 0,
                    stdout: r#"{"paneId":"p","delivered":"accepted"}"#.to_string(),
                    stderr: String::new(),
                })
            }
        }
    }

    /// Fake [`Runner`] that records every call's argv and env for exact
    /// assertions, always succeeding.
    struct CapturingRunner {
        calls: Mutex<Vec<(Vec<String>, Vec<(String, Option<String>)>)>>,
    }

    impl Runner for CapturingRunner {
        fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls.lock().unwrap().push((
                argv.iter().map(|s| s.to_string()).collect(),
                env.iter()
                    .map(|(k, v)| (k.to_string(), v.map(|s| s.to_string())))
                    .collect(),
            ));
            Ok(Output {
                status: 0,
                stdout: r#"{"ok":true}"#.to_string(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn apply_confirms_yes_via_the_daemon_side_sign_in_scrubbed() {
        let r = CapturingRunner {
            calls: Mutex::new(Vec::new()),
        };
        let panes = vec!["w1:p1".to_string()];
        let repos = vec!["chat".to_string()];
        let choices = vec![Choice::Yes];

        apply(&r, std::path::Path::new("."), &panes, &repos, &choices).unwrap();

        let (argv, env) = r.calls.lock().unwrap().last().cloned().unwrap();
        assert_eq!(
            argv,
            vec!["rt", "chat", "sign-in", "--pane", "w1:p1", "--json"]
        );
        assert!(env.iter().any(|(k, v)| k == "HERDR_PANE_ID" && v.is_none()));
    }

    #[test]
    fn apply_continues_past_a_failed_send() {
        let r = FakeRunner {
            boom: "w1:p2".to_string(),
            sent: Mutex::new(Vec::new()),
        };
        let panes = vec![
            "w1:p1".to_string(),
            "w1:p2".to_string(),
            "w1:p3".to_string(),
        ];
        let repos = vec!["r1".to_string(), "r2".to_string(), "r3".to_string()];
        let choices = vec![Choice::Yes, Choice::Yes, Choice::Yes];

        // `dir` is untouched for `Yes` choices (no pref is written).
        let result = apply(&r, std::path::Path::new("."), &panes, &repos, &choices);

        // Every pane was attempted, including the two on either side of the
        // failure: the mid-batch failure does not abandon the rest.
        assert_eq!(*r.sent.lock().unwrap(), vec!["w1:p1", "w1:p2", "w1:p3"]);
        // The failure is still surfaced rather than swallowed.
        assert!(result.is_err());
    }
}
