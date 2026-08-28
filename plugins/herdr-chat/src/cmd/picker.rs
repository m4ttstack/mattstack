//! The shared pane picker: a ratatui popup over `rt::pane_list`, grouped by
//! repo, with a text filter, select-all-online, and multi-select. Broadcast and
//! peek's jump reuse it, so the model is a pure value the view drives.

// The picker is wired into dispatch by later tasks (broadcast, peek); until then
// its public surface reads as dead to the bin target.
#![allow(dead_code)]

use crate::rt;
use crate::theme::AppTheme;
use crate::ui::{self, Flow};

use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::collections::{HashMap, HashSet};
use std::io;

/// Group label for panes with no repo, kept out of the real-repo ordering.
const NO_REPO: &str = "(no repo)";

/// The picker's pure state: the panes, the current filter text, the chosen
/// pane-id set, and a cursor into the flattened visible rows. The view owns no
/// selection logic; it drives this and renders it.
pub struct PickerModel {
    panes: Vec<rt::ChatPane>,
    filter: String,
    chosen: HashSet<String>,
    cursor: usize,
}

impl PickerModel {
    pub fn new(panes: Vec<rt::ChatPane>) -> Self {
        Self::with_selection(panes, &[])
    }

    /// Like [`new`](Self::new) but with an initial chosen set. Preselected ids
    /// absent from `panes` are dropped, so re-opening a past broadcast preselects
    /// only the panes still present.
    pub fn with_selection(panes: Vec<rt::ChatPane>, preselect: &[String]) -> Self {
        let present: HashSet<&str> = panes.iter().map(|p| p.pane_id.as_str()).collect();
        let chosen = preselect
            .iter()
            .filter(|id| present.contains(id.as_str()))
            .cloned()
            .collect();
        Self {
            panes,
            filter: String::new(),
            chosen,
            cursor: 0,
        }
    }

    /// Panes matching the current filter, grouped by repo. Real repos keep
    /// first-seen order; panes with no repo collapse into a single trailing
    /// [`NO_REPO`] group so a repo-less pane never jumps the ordering.
    pub fn grouped(&self) -> Vec<(String, Vec<&rt::ChatPane>)> {
        let mut order: Vec<String> = Vec::new();
        let mut groups: HashMap<String, Vec<&rt::ChatPane>> = HashMap::new();
        let mut no_repo: Vec<&rt::ChatPane> = Vec::new();

        for p in self.panes.iter().filter(|p| self.matches(p)) {
            match p.repo.as_deref() {
                Some(repo) if !repo.is_empty() => {
                    if !groups.contains_key(repo) {
                        order.push(repo.to_string());
                    }
                    groups.entry(repo.to_string()).or_default().push(p);
                }
                _ => no_repo.push(p),
            }
        }

        let mut out: Vec<(String, Vec<&rt::ChatPane>)> = order
            .into_iter()
            .map(|repo| {
                let members = groups.remove(&repo).unwrap_or_default();
                (repo, members)
            })
            .collect();
        if !no_repo.is_empty() {
            out.push((NO_REPO.to_string(), no_repo));
        }
        out
    }

    pub fn set_filter(&mut self, q: &str) {
        self.filter = q.to_string();
        self.clamp_cursor();
    }

    /// Select the live panes visible under the current filter (leaving idle/deaf/
    /// offline/absent and not-signed-in panes untouched). Filter-scoped so `a`
    /// never reaches an online pane the filter has hidden from view, which for a
    /// state-changing broadcast would be a footgun. Additive to prior toggles.
    pub fn select_all_online(&mut self) {
        let ids: Vec<String> = self
            .panes
            .iter()
            .filter(|p| self.matches(p))
            .filter(|p| p.presence.as_ref().is_some_and(|pr| pr.status == "live"))
            .map(|p| p.pane_id.clone())
            .collect();
        self.chosen.extend(ids);
    }

    pub fn toggle(&mut self, pane_id: &str) {
        if !self.chosen.remove(pane_id) {
            self.chosen.insert(pane_id.to_string());
        }
    }

    /// Chosen pane ids in the panes' original order (stable, filter-independent).
    pub fn selected(&self) -> Vec<String> {
        self.panes
            .iter()
            .map(|p| &p.pane_id)
            .filter(|id| self.chosen.contains(id.as_str()))
            .cloned()
            .collect()
    }

    fn is_selected(&self, pane_id: &str) -> bool {
        self.chosen.contains(pane_id)
    }

    /// Case-insensitive substring match across handle, workspace, title, repo,
    /// and path. An empty filter matches everything.
    fn matches(&self, p: &rt::ChatPane) -> bool {
        if self.filter.is_empty() {
            return true;
        }
        let q = self.filter.to_lowercase();
        let fields = [
            p.presence.as_ref().map(|pr| pr.handle.as_str()),
            Some(p.workspace.as_str()),
            p.title.as_deref(),
            p.repo.as_deref(),
            p.cwd.as_deref(),
        ];
        fields
            .iter()
            .flatten()
            .any(|s| s.to_lowercase().contains(&q))
    }

    /// The filtered panes flattened in the same order the view renders them, so
    /// the cursor indexes exactly the visible pane rows.
    fn flat(&self) -> Vec<&rt::ChatPane> {
        self.grouped().into_iter().flat_map(|(_, v)| v).collect()
    }

    fn cursor(&self) -> usize {
        self.cursor
    }

    fn move_up(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    fn move_down(&mut self) {
        let n = self.flat().len();
        if n > 0 {
            self.cursor = (self.cursor + 1).min(n - 1);
        }
    }

    fn clamp_cursor(&mut self) {
        let n = self.flat().len();
        self.cursor = if n == 0 { 0 } else { self.cursor.min(n - 1) };
    }

    fn toggle_at_cursor(&mut self) {
        if let Some(id) = self.flat().get(self.cursor).map(|p| p.pane_id.clone()) {
            self.toggle(&id);
        }
    }
}

/// Run the picker popup to completion. Returns the chosen pane ids on Enter, or
/// `None` on Esc (cancel).
pub fn pick(theme: &AppTheme, panes: Vec<rt::ChatPane>) -> io::Result<Option<Vec<String>>> {
    pick_preselected(theme, panes, &[])
}

/// Like [`pick`] but starting with `preselect` already chosen (panes still
/// present). Broadcast's "re-open a recent" flow uses this.
pub fn pick_preselected(
    theme: &AppTheme,
    panes: Vec<rt::ChatPane>,
    preselect: &[String],
) -> io::Result<Option<Vec<String>>> {
    let mut model = PickerModel::with_selection(panes, preselect);
    let mut filter = String::new();
    let mut filtering = false;
    let mut scroll = 0usize;
    let mut result: Option<Vec<String>> = None;

    ui::popup(theme, |frame, key| {
        let mut exit = false;
        if let Some(key) = key {
            if filtering {
                match key.code {
                    KeyCode::Enter | KeyCode::Esc => filtering = false,
                    KeyCode::Backspace => {
                        filter.pop();
                        model.set_filter(&filter);
                    }
                    KeyCode::Char(c) => {
                        filter.push(c);
                        model.set_filter(&filter);
                    }
                    _ => {}
                }
            } else {
                match key.code {
                    KeyCode::Up | KeyCode::Char('k') => model.move_up(),
                    KeyCode::Down | KeyCode::Char('j') => model.move_down(),
                    KeyCode::Char(' ') => model.toggle_at_cursor(),
                    KeyCode::Char('a') => model.select_all_online(),
                    KeyCode::Char('/') => filtering = true,
                    KeyCode::Enter => {
                        result = Some(model.selected());
                        exit = true;
                    }
                    KeyCode::Esc => {
                        result = None;
                        exit = true;
                    }
                    _ => {}
                }
            }
        }
        draw(frame, theme, &model, &filter, filtering, &mut scroll);
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
    model: &PickerModel,
    filter: &str,
    filtering: bool,
    scroll: &mut usize,
) {
    let inner = ui::content(frame.area());
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .split(inner);

    frame.render_widget(filter_line(theme, filter, filtering), rows[0]);
    draw_list(frame, theme, model, rows[1], scroll);
    frame.render_widget(footer_line(theme), rows[2]);
}

fn filter_line<'a>(theme: &AppTheme, filter: &'a str, filtering: bool) -> Paragraph<'a> {
    let line = if filtering {
        Line::from(vec![
            Span::styled("filter: ", theme.accent),
            Span::styled(filter, theme.base),
            Span::styled("_", theme.accent),
        ])
    } else if !filter.is_empty() {
        Line::from(vec![
            Span::styled("filter: ", theme.dim),
            Span::styled(filter, theme.base),
        ])
    } else {
        Line::from(Span::styled("press / to filter", theme.dim))
    };
    Paragraph::new(line).style(theme.base)
}

fn footer_line(theme: &AppTheme) -> Paragraph<'static> {
    let key = |k: &'static str| Span::styled(k, theme.accent);
    let line = Line::from(vec![
        key("space"),
        Span::styled(" toggle  ", theme.dim),
        key("a"),
        Span::styled(" all-online  ", theme.dim),
        key("/"),
        Span::styled(" filter  ", theme.dim),
        key("enter"),
        Span::styled(" confirm  ", theme.dim),
        key("esc"),
        Span::styled(" cancel", theme.dim),
    ]);
    Paragraph::new(line).style(theme.base)
}

fn draw_list(
    frame: &mut Frame,
    theme: &AppTheme,
    model: &PickerModel,
    area: Rect,
    scroll: &mut usize,
) {
    let mut lines: Vec<Line> = Vec::new();
    let mut cursor_line = 0usize;
    let mut pane_idx = 0usize;

    let groups = model.grouped();
    if groups.is_empty() {
        lines.push(Line::from(Span::styled("  (no panes)", theme.dim)));
    } else {
        for (repo, panes) in &groups {
            lines.push(Line::from(Span::styled(
                repo.to_string(),
                theme.accent.add_modifier(Modifier::BOLD),
            )));
            for p in panes {
                let is_cursor = pane_idx == model.cursor();
                if is_cursor {
                    cursor_line = lines.len();
                }
                let (l1, l2) = pane_lines(theme, p, model.is_selected(&p.pane_id), is_cursor);
                lines.push(l1);
                lines.push(l2);
                pane_idx += 1;
            }
        }
    }

    let vh = area.height as usize;
    if vh > 0 {
        // Keep the cursor row (and, budget allowing, its detail line) in view.
        if cursor_line < *scroll {
            *scroll = cursor_line;
        } else if cursor_line + 2 > *scroll + vh {
            *scroll = (cursor_line + 2).saturating_sub(vh);
        }
        let max_scroll = lines.len().saturating_sub(vh);
        *scroll = (*scroll).min(max_scroll);
    }

    let para = Paragraph::new(lines)
        .style(theme.base)
        .scroll((*scroll as u16, 0));
    frame.render_widget(para, area);
}

/// The two lines for one pane: an identity/checkbox row and a dim detail row.
fn pane_lines<'a>(
    theme: &AppTheme,
    p: &'a rt::ChatPane,
    selected: bool,
    cursor: bool,
) -> (Line<'a>, Line<'a>) {
    let (dot, dot_style) = status_dot(theme, p);
    let checkbox = if selected { "[x] " } else { "[ ] " };
    let marker = if cursor { "\u{203a} " } else { "  " };
    let row_style = if cursor { theme.selected } else { theme.base };
    let handle = p
        .presence
        .as_ref()
        .map(|pr| pr.handle.clone())
        .unwrap_or_else(|| "not signed in".to_string());

    let mut spans = vec![
        Span::styled(marker, row_style),
        Span::styled(checkbox, if selected { theme.accent } else { row_style }),
        Span::styled(format!("{dot} "), dot_style),
        Span::styled(handle.clone(), row_style),
        Span::styled(format!("  {}", p.workspace), theme.dim),
    ];
    if let Some(title) = p.title.as_deref() {
        if title != handle {
            spans.push(Span::styled(format!("  {title}"), row_style));
        }
    }
    let line1 = Line::from(spans);

    let repo = p.repo.as_deref().unwrap_or(NO_REPO);
    let branch = p.branch.as_deref().unwrap_or("-");
    let mut detail = vec![Span::styled(
        format!("      {repo} \u{b7} {branch}"),
        theme.dim,
    )];
    if let Some(cwd) = p.cwd.as_deref() {
        detail.push(Span::styled(format!("   {}", short_path(cwd)), theme.dim));
    }
    (line1, Line::from(detail))
}

/// A colored status dot: filled and green for live, yellow for idle, dim for
/// deaf, and a hollow dot for offline/absent or a pane not signed in.
fn status_dot(theme: &AppTheme, p: &rt::ChatPane) -> (char, Style) {
    match p.presence.as_ref().map(|pr| pr.status.as_str()) {
        Some("live") => ('\u{25cf}', Style::new().fg(Color::Green)),
        Some("idle") => ('\u{25cf}', Style::new().fg(Color::Yellow)),
        Some("deaf") => ('\u{25cf}', theme.dim),
        _ => ('\u{25cb}', theme.dim),
    }
}

/// The path's leaf under an elision, e.g. `/home/matt/code/widget` -> `.../widget`.
fn short_path(cwd: &str) -> String {
    let leaf = cwd.trim_end_matches('/').rsplit('/').next().unwrap_or(cwd);
    if leaf.is_empty() {
        cwd.to_string()
    } else {
        format!(".../{leaf}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rt::{ChatPane, Presence};

    fn presence(handle: &str, status: &str) -> Presence {
        Presence {
            handle: handle.to_string(),
            status: status.to_string(),
            rooms: Vec::new(),
        }
    }

    fn base(id: &str) -> ChatPane {
        ChatPane {
            pane_id: id.to_string(),
            workspace: "ws".to_string(),
            title: None,
            cwd: None,
            repo: None,
            branch: None,
            agent_status: "idle".to_string(),
            session_id: None,
            presence: None,
        }
    }

    fn pane(id: &str, repo: &str, handle: &str) -> ChatPane {
        ChatPane {
            repo: Some(repo.to_string()),
            presence: Some(presence(handle, "live")),
            ..base(id)
        }
    }

    fn live(id: &str) -> ChatPane {
        ChatPane {
            presence: Some(presence("h", "live")),
            ..base(id)
        }
    }

    fn offline_pane(id: &str) -> ChatPane {
        ChatPane {
            presence: Some(presence("h", "offline")),
            ..base(id)
        }
    }

    fn unsigned(id: &str) -> ChatPane {
        base(id)
    }

    #[test]
    fn groups_by_repo_and_filters_by_text() {
        let mut m = PickerModel::new(vec![
            pane("w1:p1", "chat", "meg"),
            pane("w1:p2", "rt", "fred"),
        ]);
        m.set_filter("fred");
        let g = m.grouped();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].0, "rt");
        assert_eq!(g[0].1.len(), 1);
        assert_eq!(g[0].1[0].pane_id, "w1:p2");
    }

    #[test]
    fn groups_preserve_first_seen_repo_order_and_sink_no_repo() {
        let m = PickerModel::new(vec![
            pane("w:1", "zeta", "a"),
            pane("w:2", "alpha", "b"),
            base("w:3"),
            pane("w:4", "zeta", "c"),
        ]);
        let g = m.grouped();
        let names: Vec<&str> = g.iter().map(|(r, _)| r.as_str()).collect();
        assert_eq!(names, vec!["zeta", "alpha", NO_REPO]);
        assert_eq!(g[0].1.len(), 2);
        assert_eq!(g[2].1[0].pane_id, "w:3");
    }

    #[test]
    fn filter_matches_across_handle_workspace_title_repo_and_path() {
        let mut seed = pane("w:1", "myrepo", "alice");
        seed.workspace = "acme".to_string();
        seed.title = Some("fix the bug".to_string());
        seed.cwd = Some("/home/matt/code/widget".to_string());

        for q in ["ALICE", "acm", "the bug", "myre", "widget"] {
            let mut m = PickerModel::new(vec![seed.clone()]);
            m.set_filter(q);
            let hits: usize = m.grouped().iter().map(|(_, v)| v.len()).sum();
            assert_eq!(hits, 1, "query {q:?} should match");
        }

        let mut m = PickerModel::new(vec![seed]);
        m.set_filter("zzz-nope");
        assert!(m.grouped().is_empty());
    }

    #[test]
    fn select_all_online_picks_only_live_presence() {
        let mut m = PickerModel::new(vec![
            live("w1:p1"),
            offline_pane("w1:p2"),
            unsigned("w1:p3"),
        ]);
        m.select_all_online();
        assert_eq!(m.selected(), vec!["w1:p1"]);
    }

    #[test]
    fn select_all_online_is_scoped_to_the_current_filter() {
        // With a filter set, `a` must select only the live panes still visible,
        // never online panes the filter has hidden (a footgun for a broadcast).
        let mut m = PickerModel::new(vec![
            pane("w1:p1", "chat", "meg"),
            pane("w1:p2", "rt", "fred"),
        ]);
        m.set_filter("meg");
        m.select_all_online();
        assert_eq!(m.selected(), vec!["w1:p1"]);

        // With no filter, every live pane is fair game (prior behavior).
        let mut all = PickerModel::new(vec![
            pane("w1:p1", "chat", "meg"),
            pane("w1:p2", "rt", "fred"),
        ]);
        all.select_all_online();
        assert_eq!(all.selected(), vec!["w1:p1", "w1:p2"]);
    }

    #[test]
    fn select_all_online_excludes_idle_deaf_and_absent() {
        let idle = ChatPane {
            presence: Some(presence("h", "idle")),
            ..base("i")
        };
        let deaf = ChatPane {
            presence: Some(presence("h", "deaf")),
            ..base("d")
        };
        let absent = ChatPane {
            presence: Some(presence("h", "absent")),
            ..base("ab")
        };
        let mut m = PickerModel::new(vec![live("L"), idle, deaf, absent, unsigned("u")]);
        m.select_all_online();
        assert_eq!(m.selected(), vec!["L"]);
    }

    #[test]
    fn toggle_adds_then_removes_and_selected_is_pane_order() {
        let mut m = PickerModel::new(vec![base("a"), base("b"), base("c")]);
        m.toggle("c");
        m.toggle("a");
        assert_eq!(m.selected(), vec!["a", "c"]);
        m.toggle("a");
        assert_eq!(m.selected(), vec!["c"]);
    }

    #[test]
    fn toggle_at_cursor_uses_grouped_order_not_pane_order() {
        // Pane order is p1(zeta), p2(alpha), p3(zeta); grouped order flattens to
        // zeta[p1,p3] then alpha[p2], so cursor 1 lands on p3, not p2.
        let mut m = PickerModel::new(vec![
            pane("p1", "zeta", "a"),
            pane("p2", "alpha", "b"),
            pane("p3", "zeta", "c"),
        ]);
        m.move_down();
        m.toggle_at_cursor();
        assert_eq!(m.selected(), vec!["p3"]);
    }

    #[test]
    fn set_filter_clamps_a_now_out_of_range_cursor() {
        let mut m = PickerModel::new(vec![pane("p1", "r", "alice"), pane("p2", "r", "bob")]);
        m.move_down();
        assert_eq!(m.cursor(), 1);
        m.set_filter("alice");
        assert_eq!(m.cursor(), 0);
        m.toggle_at_cursor();
        assert_eq!(m.selected(), vec!["p1"]);
    }
}
