//! The wire shapes every `--json` verb prints, and the two ways to print.
//!
//! These are declared here rather than derived on `rt.rs`'s types because
//! `rt.rs` mirrors whatever rt prints today, while this file is a promise to
//! another repo: a field renamed here breaks a consumer that cannot be
//! recompiled with this crate.

use serde::Serialize;

/// What a pane is on chat right now. `state` keeps rt's own vocabulary rather
/// than a rendered phrase, so the caller decides how to say it; the one word
/// this adds is "not signed in", which rt has no row for.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub handle: Option<String>,
    pub state: String,
    pub pane: Option<String>,
    pub signed_in: bool,
    pub rooms: Vec<String>,
}

/// Prints `value` as one line on stdout.
pub fn emit<T: Serialize>(value: &T) -> Result<(), String> {
    let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
    println!("{line}");
    Ok(())
}

/// Prints the error envelope. The caller exits non-zero; this only writes it,
/// so a verb's failure is machine-readable on the same stream as its success.
pub fn fail(message: &str) {
    let body = serde_json::json!({ "error": message });
    println!("{body}");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `signedIn` is the one field here whose Rust name differs from its wire
    /// name, and the consumer reads the wire name.
    #[test]
    fn status_serializes_signed_in_as_camel_case() {
        let out = serde_json::to_string(&Status {
            handle: Some("kay".to_string()),
            state: "live".to_string(),
            pane: Some("w1:p1".to_string()),
            signed_in: true,
            rooms: vec!["#rt".to_string()],
        })
        .unwrap();
        assert_eq!(
            out,
            r##"{"handle":"kay","state":"live","pane":"w1:p1","signedIn":true,"rooms":["#rt"]}"##
        );
    }

    #[test]
    fn a_missing_handle_is_null_rather_than_absent() {
        let out = serde_json::to_string(&Status {
            handle: None,
            state: "not signed in".to_string(),
            pane: None,
            signed_in: false,
            rooms: Vec::new(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"handle":null,"state":"not signed in","pane":null,"signedIn":false,"rooms":[]}"#
        );
    }
}
