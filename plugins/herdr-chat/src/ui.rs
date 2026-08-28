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
        let mut flow = Flow::Continue;
        terminal.draw(|frame| {
            flow = paint(frame, theme, &mut step, None);
        })?;
        if matches!(flow, Flow::Exit) {
            return Ok(());
        }
        loop {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    let mut flow = Flow::Continue;
                    terminal.draw(|frame| {
                        flow = paint(frame, theme, &mut step, Some(key));
                    })?;
                    if matches!(flow, Flow::Exit) {
                        break;
                    }
                }
                // A resize needs a repaint; the next `draw` re-renders at the new
                // size. Other events (mouse, focus, paste) are ignored.
                Event::Resize(_, _) => {
                    let mut flow = Flow::Continue;
                    terminal.draw(|frame| {
                        flow = paint(frame, theme, &mut step, None);
                    })?;
                    if matches!(flow, Flow::Exit) {
                        break;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    })
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

/// A `width` by `height` rect centered in `area`, clamped to fit. Every popup
/// centers its box through this so the geometry lives in one place.
pub fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let w = width.min(area.width);
    let h = height.min(area.height);
    Rect {
        x: area.x + area.width.saturating_sub(w) / 2,
        y: area.y + area.height.saturating_sub(h) / 2,
        width: w,
        height: h,
    }
}
