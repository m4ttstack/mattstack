//! The `broadcast` capability: pick panes, inject one message into each,
//! summarize the delivery, and record it. Two halves of one flow: the workspace
//! action ([`open`]) opens the `broadcast-ui` popup; the popup entrypoint
//! ([`run`]) composes the message, reuses the shared pane picker, fans the
//! message out, and records a recipient snapshot. The fan-out and its summary
//! are pure so they are unit-tested without a terminal.

use std::path::Path;

use crate::cmd::picker;
use crate::herdr;
use crate::rt;
use crate::run::Runner;
use crate::state::{self, Broadcast, Recipient};
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::{KeyCode, KeyModifiers};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

/// The workspace action: open the broadcast popup. A popup process carries no
/// `HERDR_PANE_ID`, so the picker and send never need the self-target scrub.
pub fn open(r: &dyn Runner) -> Result<(), String> {
    herdr::open_popup(r, "broadcast-ui")
}

/// The popup entrypoint: compose a message, pick recipients, fan out, record.
pub fn run(r: &dyn Runner) -> Result<(), String> {
    let dir = state::state_dir();
    let theme = theme::load();
    // A daemon-down error must surface as a clear failure, not an empty picker.
    let panes = rt::pane_list(r)?;

    let Some((message, preselect)) = compose(&theme, &dir)? else {
        return Ok(());
    };
    let Some(chosen) =
        picker::pick_preselected(&theme, panes.clone(), &preselect).map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    if chosen.is_empty() {
        return Ok(());
    }

    let results = fan_out(r, &chosen, &message);
    let recipients = recipients(&results, &panes);
    let line = summary(&results);
    // The messages are already delivered, so a history-persistence failure must
    // not sink the whole broadcast: surface the results regardless and fold the
    // failure into the summary as a warning.
    let warn = state::push_broadcast(
        &dir,
        &Broadcast {
            at: now_unix(),
            message,
            recipients: recipients.clone(),
        },
    )
    .err()
    .map(|e| format!("history not saved: {e}"));
    show_result(&theme, &line, &recipients, warn.as_deref()).map_err(|e| e.to_string())
}

/// Send `message` to each pane in order, collecting one result per pane. A send
/// that fails outright still yields a `refused` result so the pane appears in
/// the summary and the recorded snapshot rather than vanishing.
pub fn fan_out(r: &dyn Runner, panes: &[String], message: &str) -> Vec<rt::SendResult> {
    panes
        .iter()
        .map(|pane| {
            rt::pane_send(r, pane, message, false).unwrap_or_else(|reason| rt::SendResult {
                pane_id: pane.clone(),
                delivered: "refused".to_string(),
                reason: Some(reason),
            })
        })
        .collect()
}

/// The one-line delivery tally, e.g. `broadcast to 5 . 3 accepted . 2 queued . 0 refused`.
pub fn summary(results: &[rt::SendResult]) -> String {
    let count = |kind: &str| results.iter().filter(|r| r.delivered == kind).count();
    format!(
        "broadcast to {} . {} accepted . {} queued . {} refused",
        results.len(),
        count("accepted"),
        count("queued"),
        count("refused"),
    )
}

/// The recorded snapshot: each result joined to its pane's handle (when the pane
/// is still in the list and signed in).
fn recipients(results: &[rt::SendResult], panes: &[rt::ChatPane]) -> Vec<Recipient> {
    results
        .iter()
        .map(|res| Recipient {
            pane_id: res.pane_id.clone(),
            handle: panes
                .iter()
                .find(|p| p.pane_id == res.pane_id)
                .and_then(|p| p.presence.as_ref().map(|pr| pr.handle.clone())),
            delivered: res.delivered.clone(),
        })
        .collect()
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Which pane of the composer has focus.
enum Mode {
    Compose,
    Recent,
}

/// The composer popup: type the message, or `ctrl-r` to re-open a recent
/// broadcast (loading its message and preselecting its recipients). Returns the
/// message and the preselect pane ids on Enter, or `None` on Esc (cancel).
fn compose(theme: &AppTheme, dir: &Path) -> Result<Option<(String, Vec<String>)>, String> {
    let recents = state::recent_broadcasts(dir);
    let mut message = String::new();
    let mut preselect: Vec<String> = Vec::new();
    let mut mode = Mode::Compose;
    let mut ridx = 0usize;
    let mut confirmed = false;

    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            match mode {
                Mode::Compose => match key.code {
                    KeyCode::Enter if !message.trim().is_empty() => {
                        confirmed = true;
                        exit = true;
                    }
                    KeyCode::Esc => exit = true,
                    KeyCode::Backspace => {
                        message.pop();
                    }
                    // Ctrl-C aborts the composer (confirmed stays false).
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        exit = true;
                    }
                    KeyCode::Char('r')
                        if key.modifiers.contains(KeyModifiers::CONTROL) && !recents.is_empty() =>
                    {
                        mode = Mode::Recent;
                        ridx = 0;
                    }
                    // With no recents to open, ctrl-r is a no-op rather than
                    // falling through to type a literal `r` into the message.
                    KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {}
                    KeyCode::Char(c)
                        if !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                    {
                        message.push(c);
                    }
                    // Any other ctrl/alt-modified char is ignored, not typed.
                    KeyCode::Char(_) => {}
                    _ => {}
                },
                Mode::Recent => match key.code {
                    KeyCode::Up | KeyCode::Char('k') => ridx = ridx.saturating_sub(1),
                    KeyCode::Down | KeyCode::Char('j') if !recents.is_empty() => {
                        ridx = (ridx + 1).min(recents.len() - 1);
                    }
                    KeyCode::Enter => {
                        if let Some(b) = recents.get(ridx) {
                            message = b.message.clone();
                            preselect = b.recipients.iter().map(|r| r.pane_id.clone()).collect();
                        }
                        mode = Mode::Compose;
                    }
                    KeyCode::Esc => mode = Mode::Compose,
                    _ => {}
                },
            }
        }
        draw_compose(frame, theme, &message, &mode, &recents, ridx);
        if exit {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })
    .map_err(|e| e.to_string())?;

    Ok(confirmed.then_some((message, preselect)))
}

fn draw_compose(
    frame: &mut Frame,
    theme: &AppTheme,
    message: &str,
    mode: &Mode,
    recents: &[Broadcast],
    ridx: usize,
) {
    let full = frame.area();
    let w = full.width.saturating_sub(4).clamp(24, 88);
    let h = full.height.saturating_sub(2).max(8);
    let area = ui::centered(full, w, h);
    frame.render_widget(Clear, area);

    let block = Block::new()
        .borders(Borders::ALL)
        .title(" broadcast ")
        .border_style(theme.border)
        .style(theme.base);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(inner);

    frame.render_widget(
        Paragraph::new(Line::from(Span::styled("message", theme.dim))).style(theme.base),
        rows[0],
    );
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(message.to_string(), theme.base),
            Span::styled("_", theme.accent),
        ]))
        .style(theme.base)
        .wrap(Wrap { trim: false }),
        rows[1],
    );

    match mode {
        Mode::Recent => draw_recent(frame, theme, recents, ridx, rows[2]),
        Mode::Compose => {
            if !recents.is_empty() {
                frame.render_widget(
                    Paragraph::new(Line::from(Span::styled(
                        format!("{} recent broadcast(s) . ctrl-r to re-open", recents.len()),
                        theme.dim,
                    )))
                    .style(theme.base),
                    rows[2],
                );
            }
        }
    }

    frame.render_widget(compose_footer(theme, mode, recents), rows[3]);
}

fn draw_recent(
    frame: &mut Frame,
    theme: &AppTheme,
    recents: &[Broadcast],
    ridx: usize,
    area: Rect,
) {
    let mut lines: Vec<Line> = Vec::new();
    for (i, b) in recents.iter().enumerate() {
        let marker = if i == ridx { "\u{203a} " } else { "  " };
        let style = if i == ridx {
            theme.selected
        } else {
            theme.base
        };
        let preview: String = b.message.replace('\n', " ").chars().take(48).collect();
        lines.push(Line::from(vec![
            Span::styled(marker, style),
            Span::styled(preview, style),
            Span::styled(
                format!("  ({} recipient(s))", b.recipients.len()),
                theme.dim,
            ),
        ]));
    }
    frame.render_widget(Paragraph::new(lines).style(theme.base), area);
}

fn compose_footer(theme: &AppTheme, mode: &Mode, recents: &[Broadcast]) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let line = match mode {
        Mode::Compose => {
            let mut spans = vec![
                key("enter"),
                Span::styled(" pick recipients  ", theme.dim),
                key("esc"),
                Span::styled(" cancel", theme.dim),
            ];
            if !recents.is_empty() {
                spans.push(Span::styled("  ", theme.dim));
                spans.push(key("ctrl-r"));
                spans.push(Span::styled(" recent", theme.dim));
            }
            Line::from(spans)
        }
        Mode::Recent => Line::from(vec![
            key("enter"),
            Span::styled(" load  ", theme.dim),
            key("esc"),
            Span::styled(" back", theme.dim),
        ]),
    };
    Paragraph::new(line).style(theme.base)
}

/// The delivery summary and per-recipient rows, plus an optional warning (e.g. a
/// history-persistence failure); closes on any key.
fn show_result(
    theme: &AppTheme,
    line: &str,
    recipients: &[Recipient],
    warn: Option<&str>,
) -> std::io::Result<()> {
    ui::popup(theme, |frame, key| {
        draw_result(frame, theme, line, recipients, warn);
        if key.is_some() {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })
}

fn draw_result(
    frame: &mut Frame,
    theme: &AppTheme,
    line: &str,
    recipients: &[Recipient],
    warn: Option<&str>,
) {
    let full = frame.area();
    let w = full.width.saturating_sub(4).clamp(24, 88);
    let h = full.height.saturating_sub(2).max(6);
    let area = ui::centered(full, w, h);
    frame.render_widget(Clear, area);

    let block = Block::new()
        .borders(Borders::ALL)
        .title(" broadcast sent ")
        .border_style(theme.border)
        .style(theme.base);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines: Vec<Line> = vec![
        Line::from(Span::styled(line.to_string(), theme.accent)),
        Line::from(""),
    ];
    for r in recipients {
        let who = r.handle.clone().unwrap_or_else(|| r.pane_id.clone());
        lines.push(Line::from(vec![
            Span::styled(format!("{:<10} ", r.delivered), theme.dim),
            Span::styled(who, theme.base),
        ]));
    }
    if let Some(w) = warn {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(w.to_string(), theme.accent)));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "press any key to close",
        theme.dim,
    )));

    frame.render_widget(Paragraph::new(lines).style(theme.base), inner);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Fake [`Runner`] that serves a canned stdout per call, in order. `Mutex`
    /// because `Runner: Send + Sync` forces `run(&self, ...)`.
    struct FakeRunner {
        bodies: Mutex<VecDeque<String>>,
    }

    impl FakeRunner {
        fn sequence(bodies: &[&str]) -> Self {
            FakeRunner {
                bodies: Mutex::new(bodies.iter().map(|s| s.to_string()).collect()),
            }
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, _argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            let body = self
                .bodies
                .lock()
                .unwrap()
                .pop_front()
                .expect("sequence exhausted: unexpected extra send");
            Ok(Output {
                status: 0,
                stdout: body,
                stderr: String::new(),
            })
        }
    }

    fn sr(pane_id: &str, delivered: &str) -> rt::SendResult {
        rt::SendResult {
            pane_id: pane_id.to_string(),
            delivered: delivered.to_string(),
            reason: None,
        }
    }

    #[test]
    fn fan_out_sends_to_each_and_summarizes() {
        let r = FakeRunner::sequence(&[
            r#"{"paneId":"w1:p1","delivered":"accepted"}"#,
            r#"{"paneId":"w1:p2","delivered":"queued"}"#,
        ]);
        let res = fan_out(&r, &["w1:p1".into(), "w1:p2".into()], "standup in 5");
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].pane_id, "w1:p1");
        assert_eq!(
            summary(&res),
            "broadcast to 2 . 1 accepted . 1 queued . 0 refused"
        );
    }

    #[test]
    fn fan_out_counts_a_failed_send_as_refused() {
        // A non-zero rt exit becomes a refused result rather than dropping the
        // pane, so the summary and record still account for it.
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
                    stderr: "rt: no such pane".to_string(),
                })
            }
        }
        let res = fan_out(&Boom, &["w1:p1".into()], "hi");
        assert_eq!(res[0].delivered, "refused");
        assert_eq!(
            summary(&res),
            "broadcast to 1 . 0 accepted . 0 queued . 1 refused"
        );
    }

    #[test]
    fn summary_counts_each_delivery_bucket() {
        let res = vec![
            sr("a", "accepted"),
            sr("b", "accepted"),
            sr("c", "accepted"),
            sr("d", "queued"),
            sr("e", "queued"),
        ];
        assert_eq!(
            summary(&res),
            "broadcast to 5 . 3 accepted . 2 queued . 0 refused"
        );
    }

    #[test]
    fn recipients_join_handle_from_pane_list_and_tolerate_absent_panes() {
        let panes = vec![chat_pane("w1:p1", Some("meg")), chat_pane("w1:p2", None)];
        let results = vec![sr("w1:p1", "accepted"), sr("w1:p9", "refused")];
        let recs = recipients(&results, &panes);
        assert_eq!(recs[0].handle.as_deref(), Some("meg"));
        assert_eq!(recs[0].delivered, "accepted");
        // A pane no longer in the list keeps its id, with no handle.
        assert_eq!(recs[1].pane_id, "w1:p9");
        assert_eq!(recs[1].handle, None);
        assert_eq!(recs[1].delivered, "refused");
    }

    fn chat_pane(id: &str, handle: Option<&str>) -> rt::ChatPane {
        rt::ChatPane {
            pane_id: id.to_string(),
            workspace: "ws".to_string(),
            title: None,
            cwd: None,
            repo: None,
            branch: None,
            agent_status: "idle".to_string(),
            session_id: None,
            presence: handle.map(|h| rt::Presence {
                handle: h.to_string(),
                status: "live".to_string(),
                rooms: Vec::new(),
            }),
        }
    }
}
