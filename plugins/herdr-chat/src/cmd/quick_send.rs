//! The `quick-send` capability: pick a target (a recent room or a buddy) and
//! type one line, sent to the room or as a DM. Two halves of one flow: the
//! workspace action ([`open`]) opens the `quick-send-ui` popup; the popup
//! entrypoint ([`run`]) builds the target list, composes, and dispatches the
//! send after the popup tears down. [`send`] is the pure routing the composer
//! reuses to deliver one line to a room or a DM.

use crate::herdr;
use crate::rt;
use crate::run::Runner;
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::{KeyCode, KeyModifiers};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

/// A quick-send destination: a room (routes to [`rt::post`]) or a buddy DM
/// (routes to [`rt::dm`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Room(String),
    Dm(String),
}

/// Send `line` to `target`.
pub fn send(r: &dyn Runner, target: Target, line: &str) -> Result<(), String> {
    match target {
        Target::Room(room) => rt::post(r, &room, line),
        Target::Dm(handle) => rt::dm(r, &handle, line),
    }
}

/// Recent rooms first, then buddies, each turned into a [`Target`].
fn targets(rooms: Vec<rt::Room>, buddies: Vec<rt::Buddy>) -> Vec<Target> {
    let mut out: Vec<Target> = rooms.into_iter().map(|r| Target::Room(r.room)).collect();
    out.extend(buddies.into_iter().map(|b| Target::Dm(b.handle)));
    out
}

/// The workspace action: open the quick-send popup. A popup process carries
/// no `HERDR_PANE_ID`, so the send never needs the self-target scrub.
pub fn open(r: &dyn Runner) -> Result<(), String> {
    herdr::open_popup(r, "quick-send-ui")
}

/// The popup entrypoint: build the target list, run the composer, then send
/// after the popup has torn down.
pub fn run(r: &dyn Runner) -> Result<(), String> {
    let theme = theme::load();
    let rooms = rt::rooms(r).unwrap_or_default();
    let buddies = rt::buddies(r).unwrap_or_default();
    let list = targets(rooms, buddies);

    let Some((target, line)) = compose(&theme, &list).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    send(r, target, &line)
}

/// Run the composer popup to completion. Up/down move the target cursor;
/// arrow keys never touch the typed line, so the one-line input and the
/// target list can be driven without a separate filter/typing mode. Enter
/// sends the cursor's target with the typed line (both must be non-empty);
/// Esc cancels.
fn compose(theme: &AppTheme, targets: &[Target]) -> std::io::Result<Option<(Target, String)>> {
    let mut cursor = 0usize;
    let mut scroll = 0usize;
    let mut line = String::new();
    let mut result: Option<(Target, String)> = None;

    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            match key.code {
                KeyCode::Up => cursor = cursor.saturating_sub(1),
                KeyCode::Down if !targets.is_empty() => {
                    cursor = (cursor + 1).min(targets.len() - 1);
                }
                KeyCode::Backspace => {
                    line.pop();
                }
                // Ctrl-C aborts the composer (result stays None).
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    exit = true;
                }
                KeyCode::Char(c)
                    if !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    line.push(c);
                }
                // Any other ctrl/alt-modified char is ignored, not typed.
                KeyCode::Char(_) => {}
                KeyCode::Enter if !line.is_empty() => {
                    if let Some(t) = targets.get(cursor) {
                        result = Some((t.clone(), line.clone()));
                        exit = true;
                    }
                }
                KeyCode::Esc => exit = true,
                _ => {}
            }
        }
        draw(frame, theme, targets, cursor, &line, &mut scroll);
        if exit {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })?;
    Ok(result)
}

fn draw(
    frame: &mut Frame,
    theme: &AppTheme,
    targets: &[Target],
    cursor: usize,
    line: &str,
    scroll: &mut usize,
) {
    let full = frame.area();
    let w = full.width.saturating_sub(4).clamp(24, 88);
    let h = full.height.saturating_sub(2).max(6);
    let area = ui::centered(full, w, h);
    frame.render_widget(Clear, area);

    let block = Block::new()
        .borders(Borders::ALL)
        .title(" quick send ")
        .border_style(theme.border)
        .style(theme.base);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::vertical([
        Constraint::Min(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .split(inner);

    draw_list(frame, theme, targets, cursor, rows[0], scroll);
    frame.render_widget(input_line(theme, line), rows[1]);
    frame.render_widget(footer_line(theme), rows[2]);
}

fn draw_list(
    frame: &mut Frame,
    theme: &AppTheme,
    targets: &[Target],
    cursor: usize,
    area: Rect,
    scroll: &mut usize,
) {
    if targets.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "  no rooms or buddies to send to",
                theme.dim,
            )))
            .style(theme.base),
            area,
        );
        return;
    }

    let lines: Vec<Line> = targets
        .iter()
        .enumerate()
        .map(|(i, t)| target_line(theme, t, i == cursor))
        .collect();

    let vh = area.height as usize;
    if vh > 0 {
        if cursor < *scroll {
            *scroll = cursor;
        } else if cursor + 1 > *scroll + vh {
            *scroll = (cursor + 1).saturating_sub(vh);
        }
        let max_scroll = lines.len().saturating_sub(vh);
        *scroll = (*scroll).min(max_scroll);
    }

    let para = Paragraph::new(lines)
        .style(theme.base)
        .scroll((*scroll as u16, 0));
    frame.render_widget(para, area);
}

fn target_line<'a>(theme: &AppTheme, t: &'a Target, cursor: bool) -> Line<'a> {
    let marker = if cursor { "\u{203a} " } else { "  " };
    let row_style = if cursor { theme.selected } else { theme.base };
    let label = match t {
        Target::Room(room) => format!("# {room}"),
        Target::Dm(handle) => format!("@ {handle}"),
    };
    Line::from(vec![
        Span::styled(marker, row_style),
        Span::styled(label, row_style),
    ])
}

fn input_line<'a>(theme: &AppTheme, line: &'a str) -> Paragraph<'a> {
    let l = Line::from(vec![
        Span::styled("> ", theme.accent),
        Span::styled(line, theme.base),
        Span::styled("_", theme.accent),
    ]);
    Paragraph::new(l).style(theme.base)
}

fn footer_line(theme: &AppTheme) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let line = Line::from(vec![
        key("up/down"),
        Span::styled(" target  ", theme.dim),
        key("enter"),
        Span::styled(" send  ", theme.dim),
        key("esc"),
        Span::styled(" cancel", theme.dim),
    ]);
    Paragraph::new(line).style(theme.base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
    }

    /// Fake [`Runner`] that records every argv and returns a fixed status-0
    /// body. `Mutex` because `Runner: Send + Sync` forces `run(&self, ...)`
    /// to use interior mutability.
    struct FakeRunner {
        body: String,
        calls: Mutex<Vec<Call>>,
    }

    impl FakeRunner {
        fn capture(body: &str) -> Self {
            FakeRunner {
                body: body.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls.lock().unwrap().push(Call {
                argv: argv.iter().map(|s| s.to_string()).collect(),
            });
            Ok(Output {
                status: 0,
                stdout: self.body.clone(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn quick_send_routes_room_vs_dm() {
        let r = FakeRunner::capture("{}");
        send(&r, Target::Room("build".into()), "on it").unwrap();
        send(&r, Target::Dm("fred".into()), "ping").unwrap();
        let calls = r.calls();
        assert_eq!(calls[0].argv, vec!["rt", "chat", "post", "build", "on it"]);
        assert_eq!(calls[1].argv, vec!["rt", "chat", "dm", "fred", "ping"]);
    }

    #[test]
    fn targets_puts_rooms_before_buddies() {
        let rooms = vec![
            rt::Room {
                room: "build".to_string(),
                unread: 0,
                mentions: 0,
            },
            rt::Room {
                room: "ops".to_string(),
                unread: 0,
                mentions: 0,
            },
        ];
        let buddies = vec![rt::Buddy {
            handle: "fred".to_string(),
            status: "live".to_string(),
            pane: None,
            rooms: Vec::new(),
        }];
        let out = targets(rooms, buddies);
        assert_eq!(
            out,
            vec![
                Target::Room("build".to_string()),
                Target::Room("ops".to_string()),
                Target::Dm("fred".to_string()),
            ]
        );
    }
}
