//! The wire shapes every `--json` verb prints, the mappers that build them out
//! of this crate's own types ([`peek_from_rows`], [`targets_from`],
//! [`parse_target`], [`broadcast_from`]), and the two ways to print.
//!
//! The shapes are declared here rather than derived on `rt.rs`'s types because
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

/// A buddy row as a consumer reads it. The identity is required, because a row
/// that cannot name who it is about is not a row anyone can act on; the pane id
/// is not, because a buddy can be signed in with no pane in the roster.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeekBuddy {
    pub handle: String,
    pub pane_id: Option<String>,
    pub status: String,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub title: Option<String>,
    pub unread: u32,
    pub mentions: u32,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PeekRoom {
    pub room: String,
    pub unread: u32,
    pub mentions: u32,
}

/// Two lists rather than the TUI's one flat list: a drawing surface wants them
/// interleaved by attention, and a caller that renders its own sections wants
/// them apart. Order within each list is `rows`' own ordering, preserved.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Peek {
    pub buddies: Vec<PeekBuddy>,
    pub rooms: Vec<PeekRoom>,
}

/// A handle resolves to the first pane in `panes` carrying it, as it does in
/// [`crate::rt::agent_details`].
pub fn peek_from_rows(rows: &[crate::cmd::peek::Row], panes: &[crate::rt::ChatPane]) -> Peek {
    let pane_for = |handle: &str| -> Option<String> {
        panes
            .iter()
            .find(|p| p.presence.as_ref().is_some_and(|pr| pr.handle == handle))
            .map(|p| p.pane_id.clone())
    };
    let mut buddies = Vec::new();
    let mut rooms = Vec::new();
    for row in rows {
        match row.kind {
            crate::cmd::peek::RowKind::Buddy => {
                if let Some(handle) = row.handle.clone() {
                    let pane_id = pane_for(&handle);
                    buddies.push(PeekBuddy {
                        handle,
                        pane_id,
                        status: row.status.clone().unwrap_or_else(|| "unknown".to_string()),
                        repo: row.repo.clone(),
                        branch: row.branch.clone(),
                        title: row.title.clone(),
                        unread: row.unread,
                        mentions: row.mentions,
                    });
                }
            }
            crate::cmd::peek::RowKind::Room => {
                if let Some(room) = row.room.clone() {
                    rooms.push(PeekRoom {
                        room,
                        unread: row.unread,
                        mentions: row.mentions,
                    });
                }
            }
        }
    }
    Peek { buddies, rooms }
}

/// What a caller may send to. The prefixes are the wire form: `#room` and
/// `@handle` are one namespace a caller passes straight back as `--to`, where
/// a bare name would be ambiguous between a room and a person.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Targets {
    pub rooms: Vec<String>,
    pub people: Vec<String>,
}

pub fn targets_from(targets: &[crate::cmd::quick_send::Target]) -> Targets {
    let mut rooms = Vec::new();
    let mut people = Vec::new();
    for t in targets {
        match t {
            crate::cmd::quick_send::Target::Room(r) => rooms.push(format!("#{r}")),
            crate::cmd::quick_send::Target::Dm(h) => people.push(format!("@{h}")),
        }
    }
    Targets { rooms, people }
}

/// The inverse of [`targets_from`]'s prefixes.
pub fn parse_target(s: &str) -> Option<crate::cmd::quick_send::Target> {
    let rest = s.get(1..)?;
    if rest.is_empty() {
        return None;
    }
    match s.as_bytes().first()? {
        b'#' => Some(crate::cmd::quick_send::Target::Room(rest.to_string())),
        b'@' => Some(crate::cmd::quick_send::Target::Dm(rest.to_string())),
        _ => None,
    }
}

/// What a send did. `to` echoes the caller's own prefixed string back, so a
/// caller that fired several sends in a row can match replies to requests
/// without keeping its own side table.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Sent {
    pub ok: bool,
    pub to: String,
}

/// `delivered` is rt's own word, carried through unchanged: `ok` is the
/// question most callers ask, but "accepted" and "queued" are a real
/// difference and only rt gets to name it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastResult {
    pub pane_id: String,
    pub ok: bool,
    pub delivered: String,
    pub error: Option<String>,
}

/// `ok` is every pane taking the message, and an empty fan-out is not ok: a
/// broadcast that reached nobody is a failure the caller has to be able to see.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Broadcast {
    pub ok: bool,
    pub results: Vec<BroadcastResult>,
}

pub fn broadcast_from(results: &[crate::rt::SendResult]) -> Broadcast {
    let mapped: Vec<BroadcastResult> = results
        .iter()
        .map(|r| {
            let ok = r.delivered != "refused";
            BroadcastResult {
                pane_id: r.pane_id.clone(),
                ok,
                delivered: r.delivered.clone(),
                error: if ok {
                    None
                } else {
                    r.reason.clone().or_else(|| Some(r.delivered.clone()))
                },
            }
        })
        .collect();
    Broadcast {
        ok: !mapped.is_empty() && mapped.iter().all(|r| r.ok),
        results: mapped,
    }
}

/// Where a handle is, so the caller can go there itself. Deliberately not a
/// focus: flock moves its own focus, and two clients moving it fight.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Jump {
    pub pane_id: String,
    pub workspace: String,
    pub handle: String,
}

/// The chat viewer URL, deep-linked to a room when the caller asked for one.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Viewer {
    pub url: String,
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

    #[test]
    fn broadcast_result_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&BroadcastResult {
            pane_id: "w1:p1".to_string(),
            ok: true,
            delivered: "accepted".to_string(),
            error: None,
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"paneId":"w1:p1","ok":true,"delivered":"accepted","error":null}"#
        );
    }

    #[test]
    fn jump_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&Jump {
            pane_id: "w1:p1".to_string(),
            workspace: "flock".to_string(),
            handle: "kay".to_string(),
        })
        .unwrap();
        assert_eq!(
            out,
            r#"{"paneId":"w1:p1","workspace":"flock","handle":"kay"}"#
        );
    }

    #[test]
    fn peek_buddy_serializes_pane_id_as_camel_case() {
        let out = serde_json::to_string(&PeekBuddy {
            handle: "kay".to_string(),
            pane_id: Some("w1:p1".to_string()),
            status: "live".to_string(),
            repo: None,
            branch: None,
            title: None,
            unread: 0,
            mentions: 0,
        })
        .unwrap();
        assert!(out.contains(r#""paneId":"w1:p1""#), "got {out}");
    }
}
