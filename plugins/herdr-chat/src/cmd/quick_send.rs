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
use ratatui::widgets::Paragraph;
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

/// Sends `body` to the prefixed `to`. Every guard runs before the send, so a
/// refused call has changed nothing. An absent `to` is told apart from a
/// malformed one: the caller who left the flag off and the caller who spelled
/// its value wrong have different things to fix.
pub fn send_json(r: &dyn Runner, to: &str, body: &str) -> Result<crate::json::Sent, String> {
    if body.trim().is_empty() {
        return Err("body is required".to_string());
    }
    if to.trim().is_empty() {
        return Err("to is required".to_string());
    }
    let target = crate::json::parse_target(to)
        .ok_or_else(|| format!("target must be #room or @name, got {to:?}"))?;
    send(r, target, body)?;
    Ok(crate::json::Sent {
        ok: true,
        to: to.to_string(),
    })
}

/// A pickable target plus, for a DM, the buddy's repo/branch/task detail so the
/// row can show what that agent is doing. Rooms carry no such detail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetRow {
    pub target: Target,
    /// What the row shows. Never what the send keys on: that is `target`.
    pub label: String,
    /// `'@'` for a buddy or a DM room, `'#'` for a channel.
    pub sigil: char,
    pub detail: Option<rt::AgentDetail>,
}

/// Recent rooms first, then buddies, each turned into a [`TargetRow`]; a buddy
/// picks up its agent detail from the pane roster index, keyed by its id.
fn targets(
    rooms: Vec<rt::Room>,
    buddies: Vec<rt::Buddy>,
    details: &std::collections::HashMap<String, rt::AgentDetail>,
) -> Vec<TargetRow> {
    let mut out: Vec<TargetRow> = rooms
        .into_iter()
        .map(|r| TargetRow {
            label: r.label(),
            sigil: if r.is_dm() { '@' } else { '#' },
            target: Target::Room(r.room),
            detail: None,
        })
        .collect();
    let live_names: std::collections::HashSet<String> = buddies
        .iter()
        .filter(|b| b.status != "offline")
        .map(|b| b.display_name().to_string())
        .collect();
    out.extend(
        buddies
            .into_iter()
            .filter(|b| b.status != "offline" || !live_names.contains(b.display_name()))
            .map(|b| {
                let detail = details.get(&b.handle).cloned();
                TargetRow {
                    label: b.display_name().to_string(),
                    sigil: '@',
                    target: Target::Dm(b.handle),
                    detail,
                }
            }),
    );
    out
}

/// The same list the TUI picks from, flattened to the two prefixed namespaces,
/// over the same three rt calls. Where `run` tolerates a call that answers
/// nothing and offers what it has, this propagates: an empty list is a real
/// answer, and a caller with no terminal to look at has nothing else to tell
/// it apart from an rt that is down.
pub fn targets_json(r: &dyn Runner) -> Result<crate::json::Targets, String> {
    let rooms = rt::rooms(r)?;
    let buddies = rt::buddies(r)?;
    let panes = rt::pane_list(r)?;
    let details = rt::agent_details(&panes);
    Ok(crate::json::targets_from(&targets(
        rooms, buddies, &details,
    )))
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
    let panes = rt::pane_list(r).unwrap_or_default();
    let details = rt::agent_details(&panes);
    let list = targets(rooms, buddies, &details);

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
fn compose(theme: &AppTheme, targets: &[TargetRow]) -> std::io::Result<Option<(Target, String)>> {
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
                        result = Some((t.target.clone(), line.clone()));
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
    targets: &[TargetRow],
    cursor: usize,
    line: &str,
    scroll: &mut usize,
) {
    let inner = ui::content(frame.area());
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
    targets: &[TargetRow],
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

fn target_line<'a>(theme: &AppTheme, row: &'a TargetRow, cursor: bool) -> Line<'a> {
    let marker = if cursor { "\u{203a} " } else { "  " };
    let row_style = if cursor { theme.selected } else { theme.base };
    match &row.target {
        Target::Room(_) => Line::from(vec![
            Span::styled(marker, row_style),
            Span::styled(format!("{} {}", row.sigil, row.label), row_style),
        ]),
        Target::Dm(_) => {
            let mut spans = vec![
                Span::styled(marker, row_style),
                Span::styled(format!("{} {:<8}", row.sigil, row.label), row_style),
            ];
            // For a DM, show where the buddy is and what they're working on,
            // from the pane roster; a room row has no such detail.
            if let Some(d) = &row.detail {
                if let Some(repo) = d.repo.as_deref() {
                    let branch = d.branch.as_deref().unwrap_or("-");
                    spans.push(Span::styled(format!("  {repo} \u{b7} {branch}"), theme.dim));
                }
                if let Some(title) = d.title.as_deref() {
                    if title != row.label && !title.is_empty() {
                        spans.push(Span::styled(format!("   {title}"), row_style));
                    }
                }
            }
            Line::from(spans)
        }
    }
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
    use std::collections::VecDeque;
    use std::sync::Mutex;

    fn line_text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
    }

    /// A [`Runner`] standing in for an rt that is not running: every call
    /// exits non-zero with the message rt itself would print.
    struct DeadRt;

    impl Runner for DeadRt {
        fn run(&self, _argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            Ok(Output {
                status: 1,
                stdout: String::new(),
                stderr: "rt: daemon not running".to_string(),
            })
        }
    }

    /// `capture` replays one fixed body forever; `sequence` serves the given
    /// bodies in order, one per call, lets a test assert how many calls were
    /// made, and panics once drained rather than answering empty. `Mutex`
    /// because `Runner: Send + Sync` forces `run(&self, ...)` to use interior
    /// mutability.
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

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }

        fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls.lock().unwrap().push(Call {
                argv: argv.iter().map(|s| s.to_string()).collect(),
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
    fn quick_send_routes_room_vs_dm() {
        let r = FakeRunner::capture("{}");
        send(&r, Target::Room("build".into()), "on it").unwrap();
        send(&r, Target::Dm("fred".into()), "ping").unwrap();
        let calls = r.calls();
        assert_eq!(calls[0].argv, vec!["rt", "chat", "post", "build", "on it"]);
        assert_eq!(calls[1].argv, vec!["rt", "chat", "dm", "fred", "ping"]);
    }

    #[test]
    fn send_json_posts_to_the_room_it_was_given_and_echoes_the_target() {
        let r = FakeRunner::sequence(&[r#"{"ok":true}"#]);
        let out = send_json(&r, "#rt", "schema v5 is mine").unwrap();
        assert!(out.ok);
        assert_eq!(out.to, "#rt");
    }

    #[test]
    fn an_unprefixed_target_is_refused_rather_than_guessed() {
        let r = FakeRunner::sequence(&[]);
        assert_eq!(
            send_json(&r, "rt", "hello").unwrap_err(),
            r#"target must be #room or @name, got "rt""#
        );
        assert_eq!(
            r.call_count(),
            0,
            "nothing may be sent for an unprefixed target"
        );
    }

    /// A caller who left the flag off is told the flag is missing, not that
    /// the empty string it never passed is the wrong shape.
    #[test]
    fn an_absent_target_is_refused_as_a_missing_flag() {
        let r = FakeRunner::sequence(&[]);
        assert_eq!(send_json(&r, "", "hello").unwrap_err(), "to is required");
        assert_eq!(r.call_count(), 0, "nothing may be sent with no target");
    }

    /// rt would accept an empty line, and an empty line in a room is noise
    /// nobody meant to make.
    #[test]
    fn an_empty_body_is_refused_before_anything_is_sent() {
        let r = FakeRunner::sequence(&[]);
        assert!(send_json(&r, "#rt", "   ").is_err());
        assert_eq!(r.call_count(), 0, "nothing may be sent for an empty body");
    }

    #[test]
    fn targets_puts_rooms_before_buddies() {
        let rooms = vec![
            rt::Room {
                room: "build".to_string(),
                unread: 0,
                mentions: 0,
                kind: None,
                participants: None,
            },
            rt::Room {
                room: "ops".to_string(),
                unread: 0,
                mentions: 0,
                kind: None,
                participants: None,
            },
        ];
        let buddies = vec![rt::Buddy {
            handle: "fred".to_string(),
            name: None,
            status: "live".to_string(),
            session_id: None,
            pane: None,
            rooms: Vec::new(),
            signed_in_at: None,
        }];
        let out = targets(rooms, buddies, &std::collections::HashMap::new());
        let got: Vec<Target> = out.into_iter().map(|r| r.target).collect();
        assert_eq!(
            got,
            vec![
                Target::Room("build".to_string()),
                Target::Room("ops".to_string()),
                Target::Dm("fred".to_string()),
            ]
        );
    }

    /// An empty target list is a real answer: no rooms, no buddies. A caller
    /// reading only the JSON has no second cue to tell that apart from an rt
    /// it could not reach.
    #[test]
    fn targets_json_propagates_a_dead_rt_rather_than_answering_empty() {
        assert_eq!(targets_json(&DeadRt).unwrap_err(), "rt: daemon not running");
    }

    #[test]
    fn targets_json_lists_rooms_with_their_hash_and_people_with_their_at() {
        let t = crate::json::targets_from(&[
            TargetRow {
                target: Target::Room("rt".to_string()),
                label: "rt".to_string(),
                sigil: '#',
                detail: None,
            },
            TargetRow {
                target: Target::Dm("scout".to_string()),
                label: "scout".to_string(),
                sigil: '@',
                detail: None,
            },
        ]);
        assert_eq!(t.rooms, vec!["#rt".to_string()]);
        assert_eq!(t.people, vec!["@scout".to_string()]);
        assert_eq!(t.labels.get("#rt").map(String::as_str), Some("#rt"));
    }

    #[test]
    fn targets_json_names_people_by_display_name() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"rooms":[{"room":"rt"},{"room":"dm-3f9a","kind":"dm","participants":{"a":"kai","b":"remy.k3f9","aName":"kai","bName":"remy"}}]}"#,
            r#"{"ok":true,"buddies":[{"handle":"remy.k3f9","name":"remy","status":"live"},{"handle":"meg","status":"idle"}]}"#,
            r#"{"ok":true,"panes":[]}"#,
        ]);
        let t = targets_json(&r).unwrap();
        assert_eq!(t.rooms, vec!["#rt", "#dm-3f9a"]);
        assert_eq!(t.people, vec!["@remy", "@meg"]);
        assert_eq!(
            t.labels.get("#dm-3f9a").map(String::as_str),
            Some("kai \u{2194} remy")
        );
        assert_eq!(t.labels.get("#rt").map(String::as_str), Some("#rt"));
        assert_eq!(t.labels.get("@remy").map(String::as_str), Some("@remy"));
        assert_eq!(t.labels.len(), 4);
    }

    /// A signed-out identity keeps its name while a live one holds it too, and
    /// `@remy` reaches only the live one.
    #[test]
    fn people_are_listed_once_per_name() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"rooms":[]}"#,
            r#"{"ok":true,"buddies":[{"handle":"remy","status":"offline"},{"handle":"remy.k3f9","name":"remy","status":"live"}]}"#,
            r#"{"ok":true,"panes":[]}"#,
        ]);
        assert_eq!(targets_json(&r).unwrap().people, vec!["@remy"]);
    }

    /// A signed-out identity's row is dropped when a live one holds its name,
    /// so the popup never shows two identical rows for the one name.
    #[test]
    fn the_popup_lists_one_row_per_name() {
        let buddies = vec![
            rt::Buddy {
                handle: "remy.0001".to_string(),
                name: Some("remy".to_string()),
                status: "offline".to_string(),
                session_id: None,
                pane: None,
                rooms: Vec::new(),
                signed_in_at: None,
            },
            rt::Buddy {
                handle: "remy.k3f9".to_string(),
                name: Some("remy".to_string()),
                status: "live".to_string(),
                session_id: None,
                pane: None,
                rooms: Vec::new(),
                signed_in_at: None,
            },
            rt::Buddy {
                handle: "meg".to_string(),
                name: None,
                status: "idle".to_string(),
                session_id: None,
                pane: None,
                rooms: Vec::new(),
                signed_in_at: None,
            },
        ];
        let rows = targets(vec![], buddies, &std::collections::HashMap::new());
        let got: Vec<Target> = rows.into_iter().map(|r| r.target).collect();
        assert_eq!(
            got,
            vec![
                Target::Dm("remy.k3f9".to_string()),
                Target::Dm("meg".to_string()),
            ]
        );
    }

    #[test]
    fn a_dm_target_passes_a_name_or_an_id_through_for_rt_to_resolve() {
        let r = FakeRunner::capture("{}");
        send_json(&r, "@remy", "hi").unwrap();
        send_json(&r, "@remy.k3f9", "hi").unwrap();
        let calls = r.calls();
        assert_eq!(calls[0].argv, vec!["rt", "chat", "dm", "remy", "hi"]);
        assert_eq!(calls[1].argv, vec!["rt", "chat", "dm", "remy.k3f9", "hi"]);
    }

    #[test]
    fn a_buddy_target_sends_to_the_id_and_shows_the_name() {
        let buddies = vec![rt::Buddy {
            handle: "remy.k3f9".to_string(),
            name: Some("remy".to_string()),
            status: "live".to_string(),
            session_id: None,
            pane: None,
            rooms: Vec::new(),
            signed_in_at: None,
        }];
        let mut details = std::collections::HashMap::new();
        details.insert(
            "remy.k3f9".to_string(),
            rt::AgentDetail {
                repo: Some("rt".to_string()),
                branch: Some("main".to_string()),
                title: Some("remy".to_string()),
            },
        );
        let rows = targets(vec![], buddies, &details);
        assert_eq!(rows[0].target, Target::Dm("remy.k3f9".to_string()));
        let text = line_text(&target_line(&theme::fallback(), &rows[0], false));
        assert!(text.starts_with("  @ remy"), "got {text:?}");
        assert!(
            !text.contains("k3f9"),
            "the id leaked onto the screen: {text:?}"
        );
        assert_eq!(
            text.matches("remy").count(),
            1,
            "a title equal to the name is not repeated: {text:?}"
        );
    }

    #[test]
    fn a_dm_room_target_shows_its_participants_and_posts_to_the_room() {
        let rooms = vec![rt::Room {
            room: "dm-3f9a".to_string(),
            unread: 0,
            mentions: 0,
            kind: Some("dm".to_string()),
            participants: Some(rt::Participants {
                a: "kai".to_string(),
                b: "remy.k3f9".to_string(),
                a_name: Some("kai".to_string()),
                b_name: Some("remy".to_string()),
            }),
        }];
        let rows = targets(rooms, vec![], &std::collections::HashMap::new());
        assert_eq!(rows[0].target, Target::Room("dm-3f9a".to_string()));
        let text = line_text(&target_line(&theme::fallback(), &rows[0], false));
        assert_eq!(text, "  @ kai \u{2194} remy");
    }

    #[test]
    fn a_target_string_round_trips_back_to_the_target_it_names() {
        assert_eq!(
            crate::json::parse_target("#rt"),
            Some(Target::Room("rt".to_string()))
        );
        assert_eq!(
            crate::json::parse_target("@scout"),
            Some(Target::Dm("scout".to_string()))
        );
    }

    /// The caller was handed prefixed names and is expected to return one. A
    /// bare name is refused rather than guessed, because guessing picks
    /// between a room and a person with no way to be sure.
    #[test]
    fn an_unprefixed_or_empty_target_is_refused() {
        assert_eq!(crate::json::parse_target("rt"), None);
        assert_eq!(crate::json::parse_target("#"), None);
        assert_eq!(crate::json::parse_target("@"), None);
        assert_eq!(crate::json::parse_target(""), None);
    }

    /// `s.get(1..)?` returns `None` before the match ever runs, since a
    /// multi-byte first character puts byte index 1 outside a char boundary.
    #[test]
    fn a_multi_byte_first_character_is_refused_rather_than_crashing() {
        assert_eq!(crate::json::parse_target("\u{df}"), None);
        assert_eq!(crate::json::parse_target("\u{1f600}"), None);
    }
}
