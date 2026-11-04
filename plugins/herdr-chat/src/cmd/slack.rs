//! The `slack-support` capability: turn a Slack support chat on or off for a
//! pane. On types `/slack-support <person> <problem>` into the pane, the only
//! way a chat opens; Off asks rt to close the pane's chat. The headless verbs
//! `slack-status` and `slack-close` back the same two controls for a front end.

use std::time::Duration;

use crate::herdr;
use crate::json::{self, SlackClose, SlackStatus};
use crate::rt::{self, SlackConversation};
use crate::run::Runner;
use crate::state;
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::layout::{Constraint, Layout};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

/// The slash command takes a few seconds to sign the pane in and open the
/// chat, so the popup waits this long for the chat to show up before saying so.
const OPEN_POLLS: usize = 10;
const OPEN_POLL_DELAY: Duration = Duration::from_millis(500);

/// The chat held by `pane`, if one is open.
pub fn chat_for_pane<'a>(
    chats: &'a [SlackConversation],
    pane: &str,
) -> Option<&'a SlackConversation> {
    chats.iter().find(|c| c.pane.as_deref() == Some(pane))
}

pub fn status_json(r: &dyn Runner) -> Result<SlackStatus, String> {
    Ok(json::slack_status_from(&rt::slack_status(r)?))
}

pub fn close_json(r: &dyn Runner, pane: Option<&str>) -> Result<SlackClose, String> {
    let pane = pane.ok_or_else(|| "pane is required".to_string())?;
    let closed = rt::slack_close(r, pane)?;
    Ok(SlackClose {
        ok: true,
        conversation_id: closed.conversation_id,
        closed: closed.closed,
    })
}

/// The plain-text `slack-status`: one line per open chat.
pub fn status_text(r: &dyn Runner) -> Result<String, String> {
    let chats = rt::slack_status(r)?;
    if chats.is_empty() {
        return Ok("No Slack chats are open".to_string());
    }
    Ok(chats
        .iter()
        .map(|c| format!("{}  {}", c.name, c.pane.as_deref().unwrap_or("no pane")))
        .collect::<Vec<_>>()
        .join("\n"))
}

/// The plain-text `slack-close`.
pub fn close_text(r: &dyn Runner, pane: Option<&str>) -> Result<String, String> {
    Ok(close_line(close_json(r, pane)?.closed))
}

fn close_line(closed: bool) -> String {
    if closed {
        "Chat closed".to_string()
    } else {
        "Closing. Waiting on the pane".to_string()
    }
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The line typed into the pane. `rt pane send` injects one line, so newlines
/// collapse to spaces. The command's parser reads the person as one word or a
/// double-quoted name: a `"` inside the person would end it early, and a bare
/// leading `'` does not parse, so that name goes in double quotes too.
pub fn support_command(person: &str, problem: &str) -> Result<String, String> {
    let person = one_line(&person.replace('"', ""));
    let problem = one_line(problem);
    if person.is_empty() {
        return Err("a person is required".to_string());
    }
    if problem.is_empty() {
        return Err("a problem is required".to_string());
    }
    let person = if person.contains(' ') || person.starts_with('\'') {
        format!("\"{person}\"")
    } else {
        person
    };
    Ok(format!("/slack-support {person} {problem}"))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Started {
    Open { name: String },
    NotOpen,
}

/// Type the command into `pane`, then read the pane's open chat from
/// `slack-status`. `rt pane send` answers `queued` for a slash command that
/// ran, so what it says about delivery proves nothing; only a refusal is
/// believed, because that one means nothing was typed.
///
/// The send scrubs `HERDR_PANE_ID`: the daemon refuses this command from
/// anything that identifies as a pane, and a popup may inherit that id.
pub fn start(
    r: &dyn Runner,
    pane: &str,
    person: &str,
    problem: &str,
    polls: usize,
    delay: Duration,
) -> Result<Started, String> {
    let command = support_command(person, problem)?;
    let sent = rt::pane_send(r, pane, &command, true)?;
    if sent.delivered == "refused" {
        return Err(sent
            .reason
            .unwrap_or_else(|| "the pane refused it".to_string()));
    }
    for _ in 0..polls {
        std::thread::sleep(delay);
        if let Some(chat) = chat_for_pane(&rt::slack_status(r)?, pane) {
            return Ok(Started::Open {
                name: chat.name.clone(),
            });
        }
    }
    Ok(Started::NotOpen)
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    #[default]
    Person,
    Problem,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FormEvent {
    Stay,
    Submit,
    Cancel,
}

/// The two text fields of the On form.
#[derive(Debug, Default)]
pub struct Form {
    pub person: String,
    pub problem: String,
    pub focus: Field,
    /// An Enter on an empty field was refused; cleared by the next key.
    pub warn: bool,
}

impl Form {
    fn field(&mut self) -> &mut String {
        match self.focus {
            Field::Person => &mut self.person,
            Field::Problem => &mut self.problem,
        }
    }

    pub fn key(&mut self, key: KeyEvent) -> FormEvent {
        self.warn = false;
        match key.code {
            KeyCode::Esc => return FormEvent::Cancel,
            KeyCode::Tab | KeyCode::BackTab | KeyCode::Up | KeyCode::Down => {
                self.focus = match self.focus {
                    Field::Person => Field::Problem,
                    Field::Problem => Field::Person,
                };
            }
            KeyCode::Backspace => {
                self.field().pop();
            }
            KeyCode::Enter => {
                if self.person.trim().is_empty() {
                    self.focus = Field::Person;
                    self.warn = true;
                } else if self.focus == Field::Person {
                    self.focus = Field::Problem;
                } else if self.problem.trim().is_empty() {
                    self.warn = true;
                } else {
                    return FormEvent::Submit;
                }
            }
            KeyCode::Char(c)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                self.field().push(c);
            }
            _ => {}
        }
        FormEvent::Stay
    }
}

/// The pane action: stash the focused pane's id for the popup, then open it.
/// The popup process has no `HERDR_PANE_ID` of its own.
pub fn open(r: &dyn Runner) -> Result<(), String> {
    state::stash_origin_pane(
        &state::state_dir(),
        std::env::var("HERDR_PANE_ID").ok().as_deref(),
    )
    .map_err(|e| e.to_string())?;
    herdr::open_popup(r, "slack-support-ui")
}

enum Mode {
    /// No chat is open: ask who and what.
    Form(Form),
    /// A chat is open: offer to close it.
    Off {
        name: String,
    },
    /// Slow work is pending; the text is what to show meanwhile.
    Working(String),
    Result(String),
}

enum Pending {
    Start { person: String, problem: String },
    Close,
}

fn opened_text(started: &Result<Started, String>) -> String {
    match started {
        Ok(Started::Open { name }) => format!("Chat open with {name}"),
        Ok(Started::NotOpen) => "Not open yet. Check the pane".to_string(),
        Err(e) => e.clone(),
    }
}

fn run_pending(r: &dyn Runner, pane: &str, pending: Pending) -> String {
    match pending {
        Pending::Start { person, problem } => opened_text(&start(
            r,
            pane,
            &person,
            &problem,
            OPEN_POLLS,
            OPEN_POLL_DELAY,
        )),
        Pending::Close => match rt::slack_close(r, pane) {
            Ok(c) => close_line(c.closed),
            Err(e) => e,
        },
    }
}

/// The popup entrypoint.
pub fn run(r: &dyn Runner) -> Result<(), String> {
    let theme = theme::load();
    let origin = state::read_origin_pane(&state::state_dir());
    let mode = match origin.as_deref() {
        None => Mode::Result("Open this from a pane".to_string()),
        Some(pane) => match rt::slack_status(r) {
            Ok(chats) => match chat_for_pane(&chats, pane) {
                Some(chat) => Mode::Off {
                    name: chat.name.clone(),
                },
                None => Mode::Form(Form::default()),
            },
            Err(e) => Mode::Result(e),
        },
    };
    popup(r, &theme, origin.as_deref(), mode).map_err(|e| e.to_string())
}

fn popup(
    r: &dyn Runner,
    theme: &AppTheme,
    pane: Option<&str>,
    initial: Mode,
) -> std::io::Result<()> {
    let mut mode = initial;
    let mut pending: Option<Pending> = None;
    ui::popup(theme, |frame, key| {
        if let (Some(work), Some(pane)) = (pending.take(), pane) {
            mode = Mode::Result(run_pending(r, pane, work));
        }
        let mut again = false;
        if let Some(key) = key {
            match &mut mode {
                Mode::Form(form) => match form.key(key) {
                    FormEvent::Cancel => return Flow::Exit,
                    FormEvent::Submit => {
                        pending = Some(Pending::Start {
                            person: form.person.clone(),
                            problem: form.problem.clone(),
                        });
                        mode = Mode::Working("Starting the chat".to_string());
                        again = true;
                    }
                    FormEvent::Stay => {}
                },
                Mode::Off { .. } => match key.code {
                    KeyCode::Enter => {
                        pending = Some(Pending::Close);
                        mode = Mode::Working("Closing the chat".to_string());
                        again = true;
                    }
                    KeyCode::Esc | KeyCode::Char('q') => return Flow::Exit,
                    _ => {}
                },
                Mode::Working(_) => {}
                Mode::Result(_) => return Flow::Exit,
            }
        }
        draw(frame, theme, pane, &mode);
        if again || pending.is_some() {
            Flow::Again
        } else {
            Flow::Continue
        }
    })
}

fn draw(frame: &mut Frame, theme: &AppTheme, pane: Option<&str>, mode: &Mode) {
    let inner = ui::content(frame.area());
    let parts = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(inner);
    let mut title = vec![Span::styled("  Slack support", theme.base)];
    if let Some(p) = pane {
        title.push(Span::styled(format!("   pane {p}"), theme.dim));
    }
    frame.render_widget(
        Paragraph::new(Line::from(title)).style(theme.base),
        parts[0],
    );
    let width = parts[1].width as usize;
    let body = match mode {
        Mode::Form(form) => form_lines(theme, form, width),
        Mode::Off { name } => vec![
            Line::from(Span::styled(format!("  Talking to {name}"), theme.base)),
            Line::from(""),
            Line::from(vec![
                Span::styled("  enter  ", theme.accent),
                Span::styled("Close the chat", theme.selected),
            ]),
        ],
        Mode::Working(text) | Mode::Result(text) => {
            vec![Line::from(Span::styled(format!("  {text}"), theme.base))]
        }
    };
    frame.render_widget(Paragraph::new(body).style(theme.base), parts[1]);
    frame.render_widget(footer(theme, mode), parts[2]);
}

fn tail(s: &str, width: usize) -> String {
    let count = s.chars().count();
    s.chars().skip(count.saturating_sub(width)).collect()
}

fn form_lines(theme: &AppTheme, form: &Form, width: usize) -> Vec<Line<'static>> {
    let room = width.saturating_sub("  Problem > _".len());
    let field = |label: &'static str, text: &str, focused: bool| {
        let mut spans = vec![
            Span::styled(format!("  {label:<8}"), theme.dim),
            Span::styled("> ", theme.accent),
            Span::styled(tail(text, room), theme.base),
        ];
        if focused {
            spans.push(Span::styled("_", theme.accent));
        }
        Line::from(spans)
    };
    let mut lines = vec![
        field("Person", &form.person, form.focus == Field::Person),
        field("Problem", &form.problem, form.focus == Field::Problem),
        Line::from(""),
    ];
    if form.warn {
        lines.push(Line::from(Span::styled(
            "  Add a person and a problem",
            theme.dim,
        )));
    }
    lines
}

fn footer(theme: &AppTheme, mode: &Mode) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let spans = match mode {
        Mode::Form(_) => vec![
            key("tab"),
            Span::styled(" next field  ", theme.dim),
            key("enter"),
            Span::styled(" start  ", theme.dim),
            key("esc"),
            Span::styled(" close", theme.dim),
        ],
        Mode::Off { .. } => vec![key("esc"), Span::styled(" close", theme.dim)],
        Mode::Working(_) => vec![Span::styled("working", theme.dim)],
        Mode::Result(_) => vec![key("any key"), Span::styled(" close", theme.dim)],
    };
    Paragraph::new(Line::from(spans)).style(theme.base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::{Output, Runner};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use std::time::Duration;

    #[derive(Clone)]
    struct Call {
        argv: Vec<String>,
        env: Vec<(String, Option<String>)>,
    }

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

        fn call(&self, n: usize) -> Call {
            self.calls.lock().unwrap()[n].clone()
        }

        fn count(&self) -> usize {
            self.calls.lock().unwrap().len()
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

    const QUEUED: &str = r#"{"ok":true,"paneId":"w1:p1","delivered":"queued"}"#;
    const NO_CHATS: &str = r#"{"ok":true,"conversations":[]}"#;
    const ALEX_OPEN: &str = r#"{"ok":true,"conversations":[{"id":3,"room":"slack-3","pane":"w1:p1","name":"alex","openedAt":1700,"lastActiveAt":1800}]}"#;

    fn start_for(r: &FakeRunner) -> Result<Started, String> {
        start(r, "w1:p1", "alex", "printer jams", 3, Duration::ZERO)
    }

    #[test]
    fn slack_status_json_lists_the_conversations() {
        let r = FakeRunner::capture(ALEX_OPEN);
        let out = status_json(&r).unwrap();
        assert_eq!(r.call(0).argv, vec!["rt", "chat", "slack-status", "--json"]);
        assert_eq!(out.conversations.len(), 1);
        assert_eq!(out.conversations[0].name, "alex");
    }

    #[test]
    fn slack_close_passes_the_pane() {
        let r = FakeRunner::capture(r#"{"ok":true,"conversationId":3,"closed":true}"#);
        let out = close_json(&r, Some("w1:p1")).unwrap();
        assert_eq!(
            r.call(0).argv,
            vec!["rt", "chat", "slack-close", "--pane", "w1:p1", "--json"]
        );
        assert!(out.ok && out.closed);
        assert_eq!(out.conversation_id, 3);
    }

    #[test]
    fn slack_close_without_a_pane_is_refused_before_rt_is_touched() {
        let r = FakeRunner::sequence(&[]);
        assert_eq!(close_json(&r, None).unwrap_err(), "pane is required");
        assert_eq!(r.count(), 0);
    }

    #[test]
    fn the_popups_on_types_the_slash_command_into_the_pane() {
        let r = FakeRunner::sequence(&[QUEUED, ALEX_OPEN]);
        start_for(&r).unwrap();
        let send = r.call(0);
        assert_eq!(
            send.argv,
            vec![
                "rt",
                "pane",
                "send",
                "w1:p1",
                "--text",
                "/slack-support alex printer jams",
                "--json"
            ]
        );
        // A pane identity on the send is how the daemon tells a pane from a
        // person, and it refuses this command from a pane.
        assert!(send
            .env
            .iter()
            .any(|(k, v)| k == "HERDR_PANE_ID" && v.is_none()));
    }

    #[test]
    fn the_popup_shows_on_worked_from_the_slack_chat_not_the_send_result() {
        for delivered in ["queued", "accepted"] {
            let send = format!(r#"{{"ok":true,"paneId":"w1:p1","delivered":"{delivered}"}}"#);
            let r = FakeRunner::sequence(&[&send, NO_CHATS, NO_CHATS, NO_CHATS]);
            assert_eq!(start_for(&r).unwrap(), Started::NotOpen, "{delivered}");
        }
        let r = FakeRunner::sequence(&[QUEUED, NO_CHATS, ALEX_OPEN]);
        assert_eq!(
            start_for(&r).unwrap(),
            Started::Open {
                name: "alex".to_string()
            }
        );
    }

    #[test]
    fn a_chat_open_in_another_pane_is_not_this_panes() {
        let r = FakeRunner::sequence(&[
            QUEUED,
            r#"{"ok":true,"conversations":[{"id":3,"room":"slack-3","pane":"w9:p9","name":"sam","openedAt":1,"lastActiveAt":1}]}"#,
            NO_CHATS,
            NO_CHATS,
        ]);
        assert_eq!(start_for(&r).unwrap(), Started::NotOpen);
    }

    #[test]
    fn a_refused_send_is_an_error_and_never_polls() {
        let r = FakeRunner::sequence(&[
            r#"{"ok":true,"paneId":"w1:p1","delivered":"refused","reason":"that is this pane"}"#,
        ]);
        assert!(start_for(&r).is_err());
        assert_eq!(r.count(), 1);
    }

    #[test]
    fn the_command_quotes_a_person_with_spaces() {
        assert_eq!(
            support_command("alex smith", "printer jams").unwrap(),
            r#"/slack-support "alex smith" printer jams"#
        );
    }

    #[test]
    fn the_command_is_one_line_and_keeps_an_apostrophe_in_the_person() {
        assert_eq!(
            support_command("  \"O'Brien\"\n", "line one\nline two\r\n  line three").unwrap(),
            "/slack-support O'Brien line one line two line three"
        );
    }

    #[test]
    fn a_two_word_name_with_an_apostrophe_is_double_quoted_intact() {
        assert_eq!(
            support_command("Mary O'Brien", "printer jams").unwrap(),
            r#"/slack-support "Mary O'Brien" printer jams"#
        );
    }

    /// A bare leading `'` does not parse as a person, while the same name
    /// inside double quotes does.
    #[test]
    fn a_leading_apostrophe_gets_double_quotes() {
        assert_eq!(
            support_command("'alex", "printer jams").unwrap(),
            r#"/slack-support "'alex" printer jams"#
        );
    }

    #[test]
    fn the_command_needs_a_person_and_a_problem() {
        assert!(support_command("", "problem").is_err());
        assert!(support_command("alex", " \n ").is_err());
        assert!(support_command("\"\"", "problem").is_err());
    }

    #[test]
    fn typing_moves_between_the_fields_and_submits_when_both_are_filled() {
        let key = |code| KeyEvent::new(code, KeyModifiers::NONE);
        let mut form = Form::default();
        assert_eq!(form.key(key(KeyCode::Enter)), FormEvent::Stay);
        for c in "alex".chars() {
            form.key(key(KeyCode::Char(c)));
        }
        assert_eq!(form.key(key(KeyCode::Enter)), FormEvent::Stay);
        assert_eq!(form.focus, Field::Problem);
        for c in "it breaks".chars() {
            form.key(key(KeyCode::Char(c)));
        }
        form.key(key(KeyCode::Backspace));
        assert_eq!(form.person, "alex");
        assert_eq!(form.problem, "it break");
        assert_eq!(form.key(key(KeyCode::Tab)), FormEvent::Stay);
        assert_eq!(form.focus, Field::Person);
        assert_eq!(form.key(key(KeyCode::Enter)), FormEvent::Stay);
        assert_eq!(form.focus, Field::Problem);
        assert_eq!(form.key(key(KeyCode::Enter)), FormEvent::Submit);
        assert_eq!(form.key(key(KeyCode::Esc)), FormEvent::Cancel);
    }

    #[test]
    fn a_long_field_with_its_cursor_fills_the_width_exactly() {
        let form = Form {
            person: "x".repeat(200),
            ..Form::default()
        };
        let lines = form_lines(&theme::load(), &form, 40);
        assert_eq!(lines[0].width(), 40);
    }

    #[test]
    fn a_control_chord_types_nothing() {
        let mut form = Form::default();
        form.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        assert_eq!(form.person, "");
    }
}
