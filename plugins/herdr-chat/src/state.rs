#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Write `bytes` to `path` atomically: write a sibling temp file, then rename it
/// over `path`. A same-directory rename is atomic, so a concurrent reader never
/// sees a half-written file and a crash mid-write cannot truncate the existing
/// one. The temp name carries the pid so two processes writing the same file do
/// not collide on the scratch file.
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp.{}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Broadcast {
    pub at: i64,
    pub message: String,
    pub recipients: Vec<Recipient>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Recipient {
    pub pane_id: String,
    pub handle: Option<String>,
    pub delivered: String,
}

#[allow(dead_code)]
pub fn state_dir() -> PathBuf {
    PathBuf::from(std::env::var("HERDR_PLUGIN_STATE_DIR").unwrap_or_else(|_| ".".to_string()))
}

pub fn push_broadcast(dir: &Path, b: &Broadcast) -> std::io::Result<()> {
    let broadcasts_file = dir.join("broadcasts.json");
    let mut broadcasts = if let Ok(content) = fs::read_to_string(&broadcasts_file) {
        serde_json::from_str::<Vec<Broadcast>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    broadcasts.push(b.clone());
    if broadcasts.len() > 50 {
        broadcasts.remove(0);
    }
    let json = serde_json::to_string(&broadcasts)?;
    atomic_write(&broadcasts_file, json.as_bytes())
}

pub fn recent_broadcasts(dir: &Path) -> Vec<Broadcast> {
    let broadcasts_file = dir.join("broadcasts.json");
    if let Ok(content) = fs::read_to_string(&broadcasts_file) {
        if let Ok(mut broadcasts) = serde_json::from_str::<Vec<Broadcast>>(&content) {
            broadcasts.reverse();
            return broadcasts;
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("x.json");
        atomic_write(&target, b"first").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");
        // A second write replaces the file in place via temp + rename.
        atomic_write(&target, b"second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
        // The rename consumes the scratch file; none is left behind.
        let temps: Vec<_> = fs::read_dir(d.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(temps.is_empty(), "temp file left behind: {temps:?}");
    }

    #[test]
    fn broadcasts_cap_at_fifty_newest_first() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..60 {
            push_broadcast(
                d.path(),
                &Broadcast {
                    at: i,
                    message: i.to_string(),
                    recipients: vec![],
                },
            )
            .unwrap();
        }
        let r = recent_broadcasts(d.path());
        assert_eq!(r.len(), 50);
        assert_eq!(r[0].message, "59");
    }
}
