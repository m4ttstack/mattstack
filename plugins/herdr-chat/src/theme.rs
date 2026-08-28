// The public surface (load, from_herdr_config, every AppTheme field) is consumed
// by later plugin tasks that render the popups; nothing in this task reads it yet.
#![allow(dead_code)]

use ratatui::style::{Color, Modifier, Style};
use serde::Deserialize;
use std::path::{Path, PathBuf};

pub struct AppTheme {
    pub base: Style,
    pub selected: Style,
    pub border: Style,
    pub dim: Style,
    pub accent: Style,
}

/// Read herdr's active theme, falling back to a built-in palette on any failure.
///
/// Reads once from `~/.config/herdr/config.toml`; it does not track live theme
/// changes (herdr resolves the palette in-process and never exposes it).
pub fn load() -> AppTheme {
    herdr_config_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|contents| from_herdr_config(&contents))
        .unwrap_or_else(fallback)
}

/// Built-in palette that reads legibly on both light and dark terminals: it
/// leans on ANSI colors and reverse-video rather than fixed RGB, so the terminal
/// renders each role against its own background.
pub fn fallback() -> AppTheme {
    AppTheme {
        base: Style::new(),
        selected: Style::new().add_modifier(Modifier::REVERSED),
        border: Style::new().fg(Color::Blue),
        dim: Style::new().add_modifier(Modifier::DIM),
        accent: Style::new().fg(Color::Magenta),
    }
}

/// Pure parse of herdr's `config.toml` `[theme]` section into styles.
///
/// Named built-in palettes live in herdr's binary, not the config, so this
/// starts from the ANSI [`fallback`] base (correct for `name = "terminal"` and
/// for any name we cannot resolve) and layers only the explicit `[theme.custom]`
/// hex overrides on top. Returns `None` for unparseable input or a config with
/// no theme signal, so [`load`] falls back.
pub fn from_herdr_config(input: &str) -> Option<AppTheme> {
    let root: RootConfig = toml::from_str(input).ok()?;
    let theme = root.theme?;
    if theme.name.is_none() && theme.custom.is_none() {
        return None;
    }

    let mut t = fallback();
    let Some(custom) = theme.custom else {
        return Some(t);
    };

    let text = custom.text.as_deref().and_then(parse_color);
    let panel_bg = custom.panel_bg.as_deref().and_then(parse_color);
    let accent = custom
        .accent
        .as_deref()
        .or(custom.mauve.as_deref())
        .and_then(parse_color);
    let border = custom
        .overlay0
        .as_deref()
        .or(custom.surface1.as_deref())
        .and_then(parse_color);
    let dim = custom
        .subtext0
        .as_deref()
        .or(custom.overlay1.as_deref())
        .and_then(parse_color);
    let selection_bg = custom
        .selection_bg
        .as_deref()
        .or(custom.active_row_bg.as_deref())
        .and_then(parse_color);

    if let Some(c) = text {
        t.base = t.base.fg(c);
    }
    if let Some(c) = panel_bg {
        t.base = t.base.bg(c);
    }
    if let Some(c) = accent {
        t.accent = Style::new().fg(c);
    }
    if let Some(c) = border {
        t.border = Style::new().fg(c);
    }
    if let Some(c) = dim {
        t.dim = Style::new().fg(c);
    }
    if let Some(bg) = selection_bg {
        let mut selected = Style::new().bg(bg);
        if let Some(fg) = text {
            selected = selected.fg(fg);
        }
        t.selected = selected;
    }

    Some(t)
}

fn herdr_config_path() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return Some(Path::new(&xdg).join("herdr/config.toml"));
        }
    }
    let home = std::env::var("HOME").ok()?;
    Some(Path::new(&home).join(".config/herdr/config.toml"))
}

/// Parse a herdr color string (`#rrggbb`, `#rgb`, `rgb(r,g,b)`, named, or a reset
/// alias) into a ratatui color. Returns `None` for anything unrecognized so the
/// caller keeps the fallback for that role.
fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim().to_lowercase();

    if matches!(s.as_str(), "reset" | "default" | "none" | "transparent") {
        return Some(Color::Reset);
    }

    if let Some(hex) = s.strip_prefix('#') {
        // len() is byte length: gate on is_ascii() so a multi-byte value never
        // slices mid-character (which would panic and abort the plugin at launch
        // instead of falling back).
        if hex.is_ascii() && hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            return Some(Color::Rgb(r, g, b));
        }
        if hex.is_ascii() && hex.len() == 3 {
            let mut nibbles = hex.chars().map(|c| c.to_digit(16).map(|d| (d * 17) as u8));
            let r = nibbles.next().flatten()?;
            let g = nibbles.next().flatten()?;
            let b = nibbles.next().flatten()?;
            return Some(Color::Rgb(r, g, b));
        }
        return None;
    }

    if let Some(inner) = s.strip_prefix("rgb(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 3 {
            let r = parts[0].trim().parse().ok()?;
            let g = parts[1].trim().parse().ok()?;
            let b = parts[2].trim().parse().ok()?;
            return Some(Color::Rgb(r, g, b));
        }
        return None;
    }

    Some(match s.as_str() {
        "black" => Color::Black,
        "red" => Color::Red,
        "green" => Color::Green,
        "yellow" => Color::Yellow,
        "blue" => Color::Blue,
        "magenta" | "purple" => Color::Magenta,
        "cyan" => Color::Cyan,
        "white" => Color::White,
        "gray" | "grey" => Color::Gray,
        "darkgray" | "darkgrey" => Color::DarkGray,
        _ => return None,
    })
}

#[derive(Deserialize)]
struct RootConfig {
    theme: Option<ThemeSection>,
}

#[derive(Deserialize)]
struct ThemeSection {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    custom: Option<CustomColors>,
}

/// The subset of herdr's `[theme.custom]` tokens the popups map. Unlisted keys
/// (herdr defines more) are ignored by serde.
#[derive(Deserialize, Default)]
#[serde(default)]
struct CustomColors {
    text: Option<String>,
    panel_bg: Option<String>,
    accent: Option<String>,
    mauve: Option<String>,
    selection_bg: Option<String>,
    active_row_bg: Option<String>,
    overlay0: Option<String>,
    overlay1: Option<String>,
    surface1: Option<String>,
    subtext0: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_HERDR_THEME: &str = r##"
[theme]
name = "catppuccin"

[theme.custom]
text = "#cdd6f4"
accent = "#f5c2e7"
selection_bg = "#45475a"
overlay0 = "#6c7086"
subtext0 = "#a6adc8"
"##;

    #[test]
    fn fallback_is_usable() {
        let t = fallback();
        assert!(t.selected != t.base);
        assert!(t.accent != t.base);
    }

    #[test]
    fn parses_a_herdr_theme_into_styles() {
        let t = from_herdr_config(SAMPLE_HERDR_THEME).expect("parse");
        assert!(t.accent != t.base);
        assert_eq!(t.base.fg, Some(Color::Rgb(0xcd, 0xd6, 0xf4)));
        assert_eq!(t.accent.fg, Some(Color::Rgb(0xf5, 0xc2, 0xe7)));
        assert_eq!(t.selected.bg, Some(Color::Rgb(0x45, 0x47, 0x5a)));
        assert_eq!(t.border.fg, Some(Color::Rgb(0x6c, 0x70, 0x86)));
    }

    #[test]
    fn terminal_theme_uses_ansi_fallback_base() {
        // Matt's real config: name = "terminal", no custom overrides.
        let t = from_herdr_config("[theme]\nname = \"terminal\"\n").expect("parse");
        assert!(t.selected != t.base);
        assert!(t.accent != t.base);
    }

    #[test]
    fn no_theme_section_returns_none() {
        assert!(from_herdr_config("onboarding = false\n").is_none());
    }

    #[test]
    fn unparseable_input_returns_none() {
        assert!(from_herdr_config("this is not = = toml").is_none());
    }

    #[test]
    fn parses_short_hex_and_rgb_and_named() {
        assert_eq!(parse_color("#abc"), Some(Color::Rgb(0xaa, 0xbb, 0xcc)));
        assert_eq!(
            parse_color("rgb(255, 85, 85)"),
            Some(Color::Rgb(255, 85, 85))
        );
        assert_eq!(parse_color("purple"), Some(Color::Magenta));
        assert_eq!(parse_color("reset"), Some(Color::Reset));
        assert_eq!(parse_color("not-a-color"), None);
    }

    #[test]
    fn non_ascii_hex_does_not_panic_and_falls_back() {
        // "\u{20ac}uro" is 6 bytes after the '#', so a byte-length gate without
        // an ASCII check would slice mid-character and panic. It must yield None.
        assert_eq!(parse_color("#\u{20ac}uro"), None);

        // Reaching it through the real config path must not abort: the invalid
        // text color is dropped and base keeps the fallback (no explicit fg).
        let config = "[theme.custom]\ntext = \"#\u{20ac}uro\"\naccent = \"#f5c2e7\"\n";
        let t = from_herdr_config(config).expect("parse");
        assert_eq!(t.base.fg, None);
        assert_eq!(t.accent.fg, Some(Color::Rgb(0xf5, 0xc2, 0xe7)));
    }
}
