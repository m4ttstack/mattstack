//! The `peek` capability: a glanceable launcher of who is online and what is
//! unread for me. [`rows`] is the pure merge of `rt::buddies` (presence) and
//! `rt::rooms` (unread/mentions) into a sorted row list; the popup renders it
//! and dispatches one row action per invocation.

use crate::cmd::jump;
use crate::herdr;
use crate::rt;
use crate::run::Runner;
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

/// Whether a launcher row stands for an online buddy or an unread room.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowKind {
    /// An online buddy: Enter jumps to their pane.
    Buddy,
    /// A room carrying unread for me: Enter opens it in the viewer.
    Room,
}

/// One launcher row. A flat shape (not an enum of two payloads) so the view and
/// the sort read `unread`/`mentions` uniformly; `kind` says which identity field
/// (`handle` for a buddy, `room` for a room) is populated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub kind: RowKind,
    /// The buddy handle (buddy rows), else `None`.
    pub handle: Option<String>,
    /// The buddy's presence status (buddy rows), else `None`.
    pub status: Option<String>,
    /// The buddy's repo / branch / task title, from the pane roster (buddy rows).
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
    /// The room name (room rows), else `None`.
    pub room: Option<String>,
    pub unread: u32,
    pub mentions: u32,
}

/// Merge online buddies and unread rooms into one sorted launcher list.
///
/// Rooms with nothing unread and no mention are dropped (they add no signal).
/// `Buddy.rooms` is never read: rt's presence row has no rooms field, so a buddy
/// row always carries zero unread ... unread is a per-room count, sourced only
/// from `rooms`. Order is attention-first and fully deterministic: by `mentions`
/// desc, then `unread` desc, then (buddies) live before idle before deaf before
/// the rest, then the identity label (handle or room) ascending. Since every
/// unread/mention room outranks every buddy (which sits at 0/0), the effect is
/// hot rooms on top, then online buddies live-first and alphabetical.
pub fn rows(
    buddies: Vec<rt::Buddy>,
    rooms: Vec<rt::Room>,
    details: &std::collections::HashMap<String, rt::AgentDetail>,
) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::new();

    for r in rooms {
        if r.unread == 0 && r.mentions == 0 {
            continue;
        }
        out.push(Row {
            kind: RowKind::Room,
            handle: None,
            status: None,
            repo: None,
            branch: None,
            title: None,
            room: Some(r.room),
            unread: r.unread,
            mentions: r.mentions,
        });
    }

    for b in buddies {
        // Offline buddies carry no unread (unread is per-room) and are not
        // present, so they add no signal to a who's-online launcher.
        if b.status == "offline" {
            continue;
        }
        let detail = details.get(&b.handle).cloned().unwrap_or_default();
        out.push(Row {
            kind: RowKind::Buddy,
            handle: Some(b.handle),
            status: Some(b.status),
            repo: detail.repo,
            branch: detail.branch,
            title: detail.title,
            room: None,
            unread: 0,
            mentions: 0,
        });
    }

    out.sort_by(|a, b| {
        b.mentions
            .cmp(&a.mentions)
            .then(b.unread.cmp(&a.unread))
            .then(status_rank(a).cmp(&status_rank(b)))
            .then_with(|| label(a).cmp(label(b)))
    });
    out
}

/// A buddy's presence priority for the tie-break: live, then idle, then deaf,
/// then anything else. Room rows never reach this tie-break against a buddy (an
/// unread room always outranks a 0/0 buddy on the earlier keys), so their rank
/// is immaterial and folds in with `live`.
fn status_rank(row: &Row) -> u8 {
    match row.status.as_deref() {
        Some("live") | None => 0,
        Some("idle") => 1,
        Some("deaf") => 2,
        Some(_) => 3,
    }
}

/// The row's identity for the final tie-break: a buddy's handle or a room's name.
fn label(row: &Row) -> &str {
    row.handle.as_deref().or(row.room.as_deref()).unwrap_or("")
}

/// The row action the popup captured.
enum Action {
    /// Esc/q: close and do nothing.
    None,
    /// Jump to the buddy with this handle.
    Jump(String),
    /// Open the web viewer: a specific room, or the home page (`None`).
    OpenViewer(Option<String>),
}

/// The workspace action: open the peek popup. A popup process carries no
/// `HERDR_PANE_ID`, so nothing it fans out to needs the self-target scrub.
pub fn open(r: &dyn Runner) -> Result<(), String> {
    herdr::open_popup(r, "peek-ui")
}

/// The popup entrypoint: build the launcher, run it, then dispatch the one
/// chosen action after the popup has torn down.
pub fn run(r: &dyn Runner) -> Result<(), String> {
    let theme = theme::load();
    let buddies = rt::buddies(r).unwrap_or_default();
    let rooms = rt::rooms(r).unwrap_or_default();
    let panes = rt::pane_list(r).unwrap_or_default();
    let details = rt::agent_details(&panes);
    let launcher = rows(buddies, rooms, &details);

    let action = choose(&theme, &launcher).map_err(|e| e.to_string())?;

    match action {
        Action::None => Ok(()),
        Action::Jump(handle) => {
            if !jump::jump_to(r, &handle, &panes)? {
                eprintln!("peek: {handle} has no local pane to jump to");
            }
            Ok(())
        }
        Action::OpenViewer(room) => crate::cmd::open_viewer::run(r, room.as_deref()),
    }
}

/// Run the launcher popup to completion and return the chosen [`Action`].
/// Up/down (or k/j) move the cursor; Enter fires the row's primary action (jump
/// for a buddy, open-in-viewer for a room); `o` opens a room row in the viewer;
/// Esc/q cancel.
fn choose(theme: &AppTheme, launcher: &[Row]) -> std::io::Result<Action> {
    let mut cursor = 0usize;
    let mut scroll = 0usize;
    let mut action = Action::None;

    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            match key.code {
                KeyCode::Up | KeyCode::Char('k') => cursor = cursor.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') if !launcher.is_empty() => {
                    cursor = (cursor + 1).min(launcher.len() - 1);
                }
                KeyCode::Enter => {
                    if let Some(row) = launcher.get(cursor) {
                        action = primary(row);
                        exit = true;
                    }
                }
                KeyCode::Char('o') => {
                    // Always open the viewer: the cursor's room if it is a room
                    // row, otherwise the viewer home. On a buddy this pairs with
                    // Enter (jump to their pane).
                    action = Action::OpenViewer(launcher.get(cursor).and_then(|r| r.room.clone()));
                    exit = true;
                }
                KeyCode::Esc | KeyCode::Char('q') => exit = true,
                _ => {}
            }
        }
        draw(frame, theme, launcher, cursor, &mut scroll);
        if exit {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })?;
    Ok(action)
}

/// A row's primary (Enter) action: jump for a buddy, open-in-viewer for a room.
fn primary(row: &Row) -> Action {
    match row.kind {
        RowKind::Buddy => match &row.handle {
            Some(h) => Action::Jump(h.clone()),
            None => Action::None,
        },
        RowKind::Room => match &row.room {
            Some(r) => Action::OpenViewer(Some(r.clone())),
            None => Action::None,
        },
    }
}

fn draw(frame: &mut Frame, theme: &AppTheme, launcher: &[Row], cursor: usize, scroll: &mut usize) {
    let inner = ui::content(frame.area());
    let parts = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).split(inner);
    draw_list(frame, theme, launcher, cursor, parts[0], scroll);
    frame.render_widget(footer(theme, launcher.get(cursor)), parts[1]);
}

fn draw_list(
    frame: &mut Frame,
    theme: &AppTheme,
    launcher: &[Row],
    cursor: usize,
    area: Rect,
    scroll: &mut usize,
) {
    if launcher.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "  nobody online, nothing unread",
                theme.dim,
            )))
            .style(theme.base),
            area,
        );
        return;
    }

    let lines: Vec<Line> = launcher
        .iter()
        .enumerate()
        .map(|(i, row)| row_line(theme, row, i == cursor))
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

/// One launcher line: a status dot + handle for a buddy, or `# room` plus unread
/// and mention badges for a room.
fn row_line<'a>(theme: &AppTheme, row: &'a Row, cursor: bool) -> Line<'a> {
    let marker = if cursor { "\u{203a} " } else { "  " };
    let row_style = if cursor { theme.selected } else { theme.base };
    match row.kind {
        RowKind::Buddy => {
            let (dot, dot_style) = buddy_dot(theme, row.status.as_deref());
            let handle = row.handle.as_deref().unwrap_or("?");
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("{dot} "), dot_style),
                Span::styled(format!("{handle:<8}"), row_style),
            ];
            // repo · branch, from the pane roster, so the row says where the
            // agent is, not just who; the dot already carries presence.
            if let Some(repo) = row.repo.as_deref() {
                let branch = row.branch.as_deref().unwrap_or("-");
                spans.push(Span::styled(format!("  {repo} \u{b7} {branch}"), theme.dim));
            }
            // The pane title is the agent's task line; skip it when it just
            // echoes the handle (nothing new to say).
            if let Some(title) = row.title.as_deref() {
                if title != handle && !title.is_empty() {
                    spans.push(Span::styled(format!("   {title}"), row_style));
                }
            }
            Line::from(spans)
        }
        RowKind::Room => {
            let room = row.room.as_deref().unwrap_or("?");
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("# {room}"), row_style),
            ];
            if row.unread > 0 {
                spans.push(Span::styled(
                    format!("   {} unread", row.unread),
                    theme.accent,
                ));
            }
            if row.mentions > 0 {
                spans.push(Span::styled(format!("   {}@", row.mentions), theme.accent));
            }
            Line::from(spans)
        }
    }
}

/// A colored status dot: filled green for live, yellow for idle, dim for deaf,
/// a hollow dim dot otherwise.
fn buddy_dot(theme: &AppTheme, status: Option<&str>) -> (char, Style) {
    match status {
        Some("live") => ('\u{25cf}', Style::new().fg(Color::Green)),
        Some("idle") => ('\u{25cf}', Style::new().fg(Color::Yellow)),
        Some("deaf") => ('\u{25cf}', theme.dim),
        _ => ('\u{25cb}', theme.dim),
    }
}

/// The footer's key hints. The primary (Enter) verb is contextual to the
/// selected row; close is always available.
fn footer(theme: &AppTheme, selected: Option<&Row>) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let mut spans = vec![key("up/down"), Span::styled(" move  ", theme.dim)];
    match selected.map(|r| r.kind) {
        Some(RowKind::Buddy) => {
            spans.push(key("enter"));
            spans.push(Span::styled(" jump  ", theme.dim));
        }
        Some(RowKind::Room) => {
            spans.push(key("enter"));
            spans.push(Span::styled(" open  ", theme.dim));
        }
        None => {}
    }
    spans.push(key("o"));
    spans.push(Span::styled(" viewer  ", theme.dim));
    spans.push(key("esc"));
    spans.push(Span::styled(" close", theme.dim));
    Paragraph::new(Line::from(spans)).style(theme.base)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buddy(handle: &str, status: &str) -> rt::Buddy {
        rt::Buddy {
            handle: handle.to_string(),
            status: status.to_string(),
            session_id: None,
            pane: None,
            rooms: Vec::new(),
        }
    }

    fn room(name: &str, unread: u32, mentions: u32) -> rt::Room {
        rt::Room {
            room: name.to_string(),
            unread,
            mentions,
            kind: None,
        }
    }

    fn no_details() -> std::collections::HashMap<String, rt::AgentDetail> {
        std::collections::HashMap::new()
    }

    #[test]
    fn peek_rows_carry_unread_from_rooms() {
        let out = rows(
            vec![buddy("fred", "live")],
            vec![room("build", 3, 1)],
            &no_details(),
        );
        assert_eq!(out.iter().map(|r| r.unread).sum::<u32>(), 3);
    }

    #[test]
    fn a_buddy_with_no_unread_still_appears() {
        let out = rows(vec![buddy("fred", "live")], vec![], &no_details());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RowKind::Buddy);
        assert_eq!(out[0].handle.as_deref(), Some("fred"));
        assert_eq!(out[0].unread, 0);
    }

    #[test]
    fn buddy_rooms_field_is_never_used_for_unread() {
        // A buddy carrying a (wire-impossible) rooms field must NOT pick up that
        // room's unread; the count lives only on the room row.
        let mut b = buddy("fred", "live");
        b.rooms = vec!["build".to_string()];
        let out = rows(vec![b], vec![room("build", 3, 0)], &no_details());
        let fred = out
            .iter()
            .find(|r| r.handle.as_deref() == Some("fred"))
            .unwrap();
        assert_eq!(fred.unread, 0);
        let build = out
            .iter()
            .find(|r| r.room.as_deref() == Some("build"))
            .unwrap();
        assert_eq!(build.unread, 3);
    }

    #[test]
    fn rooms_without_unread_or_mentions_are_dropped() {
        let out = rows(
            vec![],
            vec![room("quiet", 0, 0), room("busy", 2, 0)],
            &no_details(),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].room.as_deref(), Some("busy"));
    }

    #[test]
    fn offline_buddies_are_dropped() {
        let out = rows(
            vec![buddy("on", "live"), buddy("gone", "offline")],
            vec![],
            &no_details(),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].handle.as_deref(), Some("on"));
    }

    #[test]
    fn buddy_rows_pick_up_repo_branch_and_title_from_details() {
        let mut details = std::collections::HashMap::new();
        details.insert(
            "kai".to_string(),
            rt::AgentDetail {
                repo: Some("console".into()),
                branch: Some("feat/x".into()),
                title: Some("app-kit".into()),
            },
        );
        let out = rows(vec![buddy("kai", "live")], vec![], &details);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].repo.as_deref(), Some("console"));
        assert_eq!(out[0].branch.as_deref(), Some("feat/x"));
        assert_eq!(out[0].title.as_deref(), Some("app-kit"));
    }

    #[test]
    fn unread_and_mention_rooms_sort_above_buddies_hottest_first() {
        let out = rows(
            vec![buddy("amy", "live"), buddy("bob", "live")],
            vec![room("x", 1, 0), room("y", 5, 2)],
            &no_details(),
        );
        let ids: Vec<&str> = out
            .iter()
            .map(|r| r.room.as_deref().or(r.handle.as_deref()).unwrap())
            .collect();
        // y (2 mentions) then x (1 unread, 0 mentions), then the two buddies.
        assert_eq!(ids, vec!["y", "x", "amy", "bob"]);
    }

    #[test]
    fn buddies_sort_live_before_idle_then_by_handle() {
        let out = rows(
            vec![
                buddy("zoe", "idle"),
                buddy("bob", "live"),
                buddy("amy", "live"),
            ],
            vec![],
            &no_details(),
        );
        let ids: Vec<&str> = out.iter().map(|r| r.handle.as_deref().unwrap()).collect();
        // live before idle; alphabetical within a status.
        assert_eq!(ids, vec!["amy", "bob", "zoe"]);
    }
}
