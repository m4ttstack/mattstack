//! The `launcher` capability: one popup listing every chat feature and quick
//! action, each on the lowercase letter of its shifted direct binding (b/p/s/v
//! for the popups and viewer, i/o for the sign quick actions).

use crate::cmd::sign::{self, Sign};
use crate::herdr;
use crate::run::Runner;
use crate::state;
use crate::theme::{self, AppTheme};
use crate::ui::{self, Flow};

use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

/// Every launcher row, in display and cursor order: the four features first,
/// then the two sign quick actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Item {
    Broadcast,
    Peek,
    QuickSend,
    OpenViewer,
    SignIn,
    SignOut,
}

pub const ITEMS: [Item; 6] = [
    Item::Broadcast,
    Item::Peek,
    Item::QuickSend,
    Item::OpenViewer,
    Item::SignIn,
    Item::SignOut,
];

/// A row's direct key: the lowercase form of the capability's shifted binding.
pub fn key_for(item: Item) -> char {
    match item {
        Item::Broadcast => 'b',
        Item::Peek => 'p',
        Item::QuickSend => 's',
        Item::OpenViewer => 'v',
        Item::SignIn => 'i',
        Item::SignOut => 'o',
    }
}

fn label(item: Item) -> &'static str {
    match item {
        Item::Broadcast => "Broadcast to panes",
        Item::Peek => "Chat peek",
        Item::QuickSend => "Quick send",
        Item::OpenViewer => "Open viewer",
        Item::SignIn => "Sign in this pane",
        Item::SignOut => "Sign out this pane",
    }
}

pub fn item_for_key(c: char) -> Option<Item> {
    ITEMS.into_iter().find(|i| key_for(*i) == c)
}

/// What the menu resolved to, dispatched after the popup tears down. Sign
/// actions never reach here: they run inside the popup so their result screen
/// can show the outcome.
enum Chosen {
    None,
    Broadcast,
    Peek,
    QuickSend,
    OpenViewer,
}

/// What the popup is showing: the menu, or a sign action's one-line outcome
/// (any key closes).
enum Mode {
    Menu,
    Result(String),
}

/// The pane action: stash the focused pane's id for the popup's sign actions,
/// then open the launcher popup. The popup is a separate herdr-spawned process
/// with no `HERDR_PANE_ID` of its own, so the stash is the only bridge back to
/// the pane the hotkey fired on.
pub fn open(r: &dyn Runner) -> Result<(), String> {
    state::stash_origin_pane(
        &state::state_dir(),
        std::env::var("HERDR_PANE_ID").ok().as_deref(),
    )
    .map_err(|e| e.to_string())?;
    herdr::open_popup(r, "launcher-ui")
}

/// The popup entrypoint: run the menu, then dispatch the one chosen feature
/// after the popup has torn down.
pub fn run(r: &dyn Runner) -> Result<(), String> {
    let theme = theme::load();
    let origin = state::read_origin_pane(&state::state_dir());
    let chosen = menu(r, &theme, origin.as_deref()).map_err(|e| e.to_string())?;
    dispatch(r, &chosen)
}

/// Chain into the picked capability's own popup, or run the viewer directly.
fn dispatch(r: &dyn Runner, chosen: &Chosen) -> Result<(), String> {
    match chosen {
        Chosen::None => Ok(()),
        Chosen::Broadcast => crate::cmd::broadcast::open(r),
        Chosen::Peek => crate::cmd::peek::open(r),
        Chosen::QuickSend => crate::cmd::quick_send::open(r),
        Chosen::OpenViewer => crate::cmd::open_viewer::run(r, None),
    }
}

/// Run a sign quick action against the stashed origin pane and return the
/// one-line outcome the result screen shows.
fn run_sign(r: &dyn Runner, item: Item, origin: Option<&str>) -> String {
    let Some(pane) = origin else {
        return "no origin pane (open the launcher from a pane)".to_string();
    };
    let which = match item {
        Item::SignOut => Sign::Out,
        _ => Sign::In,
    };
    match sign::run_with(r, which, Some(pane)) {
        Ok(body) => sign_result_text(item, &body),
        Err(e) => e,
    }
}

/// Render the sign verb's `--json` stdout (`{ok, handle, room}`) as the result
/// line; a payload with no handle degrades to the generic verb.
fn sign_result_text(item: Item, body: &str) -> String {
    #[derive(serde::Deserialize, Default)]
    struct Reply {
        handle: Option<String>,
        room: Option<String>,
    }
    let reply: Reply = serde_json::from_str(body).unwrap_or_default();
    match item {
        Item::SignOut => match reply.handle {
            Some(h) => format!("signed out {h}"),
            None => "signed out".to_string(),
        },
        _ => match reply.handle {
            Some(h) => match reply.room {
                Some(room) => format!("signed in as {h} \u{b7} joined #{room}"),
                None => format!("signed in as {h}"),
            },
            None => "signed in".to_string(),
        },
    }
}

/// Fire a menu item: the four features record the choice and close the popup;
/// the sign quick actions run right here so the popup can show their outcome.
fn fire(
    r: &dyn Runner,
    item: Item,
    origin: Option<&str>,
    chosen: &mut Chosen,
    mode: &mut Mode,
    exit: &mut bool,
) {
    match item {
        Item::Broadcast => {
            *chosen = Chosen::Broadcast;
            *exit = true;
        }
        Item::Peek => {
            *chosen = Chosen::Peek;
            *exit = true;
        }
        Item::QuickSend => {
            *chosen = Chosen::QuickSend;
            *exit = true;
        }
        Item::OpenViewer => {
            *chosen = Chosen::OpenViewer;
            *exit = true;
        }
        Item::SignIn | Item::SignOut => {
            *mode = Mode::Result(run_sign(r, item, origin));
        }
    }
}

/// Run the launcher popup to completion and return the chosen feature.
fn menu(r: &dyn Runner, theme: &AppTheme, origin: Option<&str>) -> std::io::Result<Chosen> {
    let mut cursor = 0usize;
    let mut mode = Mode::Menu;
    let mut chosen = Chosen::None;

    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            match mode {
                Mode::Result(_) => exit = true,
                Mode::Menu => match key.code {
                    KeyCode::Up | KeyCode::Char('k') => cursor = cursor.saturating_sub(1),
                    KeyCode::Down | KeyCode::Char('j') => {
                        cursor = (cursor + 1).min(ITEMS.len() - 1);
                    }
                    KeyCode::Enter => {
                        fire(r, ITEMS[cursor], origin, &mut chosen, &mut mode, &mut exit);
                    }
                    KeyCode::Esc | KeyCode::Char('q') => exit = true,
                    KeyCode::Char(c) => {
                        if let Some(item) = item_for_key(c) {
                            // Land the marker on the fired row so a sign
                            // result reads against the row that ran it.
                            cursor = ITEMS.iter().position(|i| *i == item).unwrap_or(cursor);
                            fire(r, item, origin, &mut chosen, &mut mode, &mut exit);
                        }
                    }
                    _ => {}
                },
            }
        }
        draw(frame, theme, cursor, &mode);
        if exit {
            Flow::Exit
        } else {
            Flow::Continue
        }
    })?;
    Ok(chosen)
}

fn draw(frame: &mut Frame, theme: &AppTheme, cursor: usize, mode: &Mode) {
    let inner = ui::content(frame.area());
    let parts = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).split(inner);
    match mode {
        Mode::Menu => draw_menu(frame, theme, cursor, parts[0]),
        Mode::Result(text) => draw_result(frame, theme, text, parts[0]),
    }
    frame.render_widget(footer(theme, mode), parts[1]);
}

/// Two columns, as bound: features on the left, quick actions on the right.
/// The cursor walks the flat [`ITEMS`] order (features, then quick actions).
fn draw_menu(frame: &mut Frame, theme: &AppTheme, cursor: usize, area: Rect) {
    let cols = Layout::horizontal([Constraint::Length(26), Constraint::Min(20)]).split(area);

    let column = |title: &'static str, range: std::ops::Range<usize>| {
        let mut lines = vec![Line::from(Span::styled(format!("  {title}"), theme.dim))];
        for i in range {
            lines.push(item_line(theme, ITEMS[i], i == cursor));
        }
        Paragraph::new(lines).style(theme.base)
    };

    frame.render_widget(column("Features", 0..4), cols[0]);
    frame.render_widget(column("Quick actions", 4..6), cols[1]);
}

fn item_line(theme: &AppTheme, item: Item, selected: bool) -> Line<'static> {
    let marker = if selected { "\u{203a} " } else { "  " };
    let style = if selected { theme.selected } else { theme.base };
    Line::from(vec![
        Span::styled(marker.to_string(), style),
        Span::styled(format!("{}  ", key_for(item)), theme.accent),
        Span::styled(label(item).to_string(), style),
    ])
}

fn draw_result(frame: &mut Frame, theme: &AppTheme, text: &str, area: Rect) {
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(format!("  {text}"), theme.base))).style(theme.base),
        area,
    );
}

fn footer(theme: &AppTheme, mode: &Mode) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let spans = match mode {
        Mode::Menu => vec![
            key("up/down"),
            Span::styled(" move  ", theme.dim),
            key("enter"),
            Span::styled(" run  ", theme.dim),
            key("letter"),
            Span::styled(" run direct  ", theme.dim),
            key("esc"),
            Span::styled(" close", theme.dim),
        ],
        Mode::Result(_) => vec![key("any key"), Span::styled(" close", theme.dim)],
    };
    Paragraph::new(Line::from(spans)).style(theme.base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::sync::Mutex;

    /// Fake [`Runner`] that records every argv and serves one canned stdout.
    struct FakeRunner {
        body: String,
        calls: Mutex<Vec<Vec<String>>>,
    }

    impl FakeRunner {
        fn capture(body: &str) -> Self {
            FakeRunner {
                body: body.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn last(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap()
                .last()
                .cloned()
                .expect("no call recorded")
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            self.calls
                .lock()
                .unwrap()
                .push(argv.iter().map(|s| s.to_string()).collect());
            Ok(Output {
                status: 0,
                stdout: self.body.clone(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn every_item_has_a_distinct_key_that_maps_back() {
        let mut seen = std::collections::HashSet::new();
        for item in ITEMS {
            let c = key_for(item);
            assert!(seen.insert(c), "duplicate launcher key {c:?}");
            assert_eq!(item_for_key(c), Some(item));
        }
    }

    #[test]
    fn nav_and_close_keys_are_not_item_keys() {
        for c in ['j', 'k', 'q'] {
            assert_eq!(item_for_key(c), None);
        }
    }

    #[test]
    fn feature_choices_chain_into_their_own_popups() {
        for (chosen, entrypoint) in [
            (Chosen::Broadcast, "broadcast-ui"),
            (Chosen::Peek, "peek-ui"),
            (Chosen::QuickSend, "quick-send-ui"),
        ] {
            let r = FakeRunner::capture("{}");
            dispatch(&r, &chosen).unwrap();
            let argv = r.last();
            assert_eq!(argv[1..4], ["plugin", "pane", "open"]);
            assert_eq!(argv.last().map(String::as_str), Some(entrypoint));
        }
    }

    #[test]
    fn choosing_nothing_runs_nothing() {
        let r = FakeRunner::capture("{}");
        dispatch(&r, &Chosen::None).unwrap();
        assert!(r.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn sign_in_runs_against_the_stashed_origin_pane() {
        let r = FakeRunner::capture(r#"{"ok":true,"handle":"kai","room":"console"}"#);
        let text = run_sign(&r, Item::SignIn, Some("w1:p2"));
        assert_eq!(
            r.last(),
            vec!["rt", "chat", "sign-in", "--pane", "w1:p2", "--json"]
        );
        assert_eq!(text, "signed in as kai \u{b7} joined #console");
    }

    #[test]
    fn sign_out_runs_against_the_stashed_origin_pane() {
        let r = FakeRunner::capture(r#"{"ok":true,"handle":"kai"}"#);
        let text = run_sign(&r, Item::SignOut, Some("w1:p2"));
        assert_eq!(
            r.last(),
            vec!["rt", "chat", "sign-out", "--pane", "w1:p2", "--json"]
        );
        assert_eq!(text, "signed out kai");
    }

    #[test]
    fn sign_without_an_origin_pane_never_touches_rt() {
        let r = FakeRunner::capture("{}");
        let text = run_sign(&r, Item::SignIn, None);
        assert!(r.calls.lock().unwrap().is_empty());
        assert!(text.contains("no origin pane"));
    }

    #[test]
    fn sign_result_degrades_on_a_handleless_or_malformed_payload() {
        assert_eq!(sign_result_text(Item::SignIn, r#"{"ok":true}"#), "signed in");
        assert_eq!(sign_result_text(Item::SignOut, "not json"), "signed out");
        assert_eq!(
            sign_result_text(Item::SignIn, r#"{"ok":true,"handle":"kai"}"#),
            "signed in as kai"
        );
    }
}
