//! Shared modal-popup scaffolding every plugin popup reuses. `popup` owns the
//! terminal lifecycle so each caller supplies only a draw-and-handle closure.

// The popup loop is the first consumer; later popup subcommands (compose,
// picker, peek) reuse it, so the whole module reads as dead to this task's
// wired subcommands until they land.
#![allow(dead_code)]

use crate::theme::AppTheme;
use crossterm::event::{self, Event, KeyEvent, KeyEventKind};
use ratatui::layout::Rect;
use ratatui::widgets::Block;
use ratatui::Frame;

/// What the per-iteration closure asks the loop to do next.
pub enum Flow {
    /// Keep the popup open, waiting for the next key.
    Continue,
    /// Tear the popup down and restore the terminal.
    Exit,
    /// Paint again at once with no key, before waiting for input. For a step
    /// that shows a "working" frame and then does slow work on the next call.
    Again,
}

/// Run a modal popup event loop.
///
/// Enters raw mode and the alternate screen via [`ratatui::run`], which also
/// installs a panic hook and restores the terminal on every exit path (normal
/// return, an early `?`, or a panic) so the loop can never leave the terminal
/// wedged. Each iteration paints a themed backdrop, invokes `step` to render the
/// popup and process an optional key, then blocks on the next key. `step`
/// returns [`Flow::Exit`] to close.
pub fn popup<F>(theme: &AppTheme, mut step: F) -> std::io::Result<()>
where
    F: FnMut(&mut Frame, Option<KeyEvent>) -> Flow,
{
    ratatui::run(|terminal| {
        // Paint once before the first blocking read so the popup is visible at
        // once rather than after the first key. Honor an immediate Exit so a
        // step that closes on its keyless first paint is respected.
        if matches!(draw_settled(terminal, theme, &mut step, None)?, Flow::Exit) {
            return Ok(());
        }
        loop {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    if matches!(
                        draw_settled(terminal, theme, &mut step, Some(key))?,
                        Flow::Exit
                    ) {
                        break;
                    }
                }
                // A resize needs a repaint; the next `draw` re-renders at the new
                // size. Other events (mouse, focus, paste) are ignored.
                Event::Resize(_, _) => {
                    if matches!(draw_settled(terminal, theme, &mut step, None)?, Flow::Exit) {
                        break;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    })
}

/// One draw for `key`, repeated with no key for as long as the step answers
/// [`Flow::Again`]. Returns the last answer, never `Again`.
fn draw_settled<B, F>(
    terminal: &mut ratatui::Terminal<B>,
    theme: &AppTheme,
    step: &mut F,
    mut key: Option<KeyEvent>,
) -> std::io::Result<Flow>
where
    B: ratatui::backend::Backend,
    B::Error: Into<std::io::Error>,
    F: FnMut(&mut Frame, Option<KeyEvent>) -> Flow,
{
    loop {
        let mut flow = Flow::Continue;
        terminal
            .draw(|frame| {
                flow = paint(frame, theme, step, key.take());
            })
            .map_err(Into::into)?;
        if !matches!(flow, Flow::Again) {
            return Ok(flow);
        }
    }
}

/// Fill the frame with the theme's base style, then hand it to the caller's
/// closure. The backdrop covers herdr's screen behind an alternate-screen popup
/// so partial popup boxes never show the host UI through the gaps.
fn paint<F>(frame: &mut Frame, theme: &AppTheme, step: &mut F, key: Option<KeyEvent>) -> Flow
where
    F: FnMut(&mut Frame, Option<KeyEvent>) -> Flow,
{
    frame.render_widget(Block::new().style(theme.base), frame.area());
    step(frame, key)
}

/// The popup's content rectangle. herdr already frames the popup pane and
/// shows its title, so plugin popups render borderless into this, inset one
/// column so text does not sit against herdr's frame. Drawing our own bordered
/// box here would nest a second frame inside herdr's (a box-in-a-box).
pub fn content(area: Rect) -> Rect {
    Rect {
        x: area.x + 1,
        y: area.y,
        width: area.width.saturating_sub(2),
        height: area.height,
    }
}
