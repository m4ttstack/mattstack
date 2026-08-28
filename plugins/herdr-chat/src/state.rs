#![allow(dead_code)]

use fs2::FileExt;
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

/// Take an exclusive advisory lock on `<dir>/pending.lock`, held until the
/// returned handle drops. Serializes the read-modify-write in [`push_pending`]
/// and [`drain_pending`] so concurrent `on-agent-detected` processes during a
/// fleet spawn cannot clobber each other's queued panes.
fn lock_pending(dir: &Path) -> std::io::Result<fs::File> {
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("pending.lock"))?;
    file.lock_exclusive()?;
    Ok(file)
}

#[derive(Serialize, Deserialize, PartialEq, Clone, Copy, Debug)]
pub enum SigninPref {
    Ask,
    Always,
    Never,
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

pub fn get_pref(dir: &Path, repo: &str) -> SigninPref {
    let pref_file = dir.join("signin_prefs.json");
    match fs::read_to_string(&pref_file) {
        Ok(content) => {
            if let Ok(prefs) =
                serde_json::from_str::<std::collections::HashMap<String, SigninPref>>(&content)
            {
                prefs.get(repo).copied().unwrap_or(SigninPref::Ask)
            } else {
                SigninPref::Ask
            }
        }
        Err(_) => SigninPref::Ask,
    }
}

pub fn set_pref(dir: &Path, repo: &str, pref: SigninPref) -> std::io::Result<()> {
    let pref_file = dir.join("signin_prefs.json");
    let mut prefs = if let Ok(content) = fs::read_to_string(&pref_file) {
        serde_json::from_str::<std::collections::HashMap<String, SigninPref>>(&content)
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
    prefs.insert(repo.to_string(), pref);
    let json = serde_json::to_string(&prefs)?;
    atomic_write(&pref_file, json.as_bytes())
}

pub fn push_pending(dir: &Path, pane_id: &str) -> std::io::Result<()> {
    // Serialize the read-modify-write against a racing drain or push.
    let _guard = lock_pending(dir)?;
    let pending_file = dir.join("pending.json");
    let mut pending = if let Ok(content) = fs::read_to_string(&pending_file) {
        serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    pending.push(pane_id.to_string());
    let json = serde_json::to_string(&pending)?;
    atomic_write(&pending_file, json.as_bytes())
}

pub fn drain_pending(dir: &Path) -> std::io::Result<Vec<String>> {
    // Serialize the read-then-remove against a racing push.
    let _guard = lock_pending(dir)?;
    let pending_file = dir.join("pending.json");
    let pending = if let Ok(content) = fs::read_to_string(&pending_file) {
        serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    if pending_file.exists() {
        fs::remove_file(&pending_file)?;
    }
    Ok(pending)
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
    fn pref_round_trips_per_repo_and_defaults_to_ask() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(get_pref(d.path(), "chat"), SigninPref::Ask);
        set_pref(d.path(), "chat", SigninPref::Always).unwrap();
        assert_eq!(get_pref(d.path(), "chat"), SigninPref::Always);
        assert_eq!(get_pref(d.path(), "other"), SigninPref::Ask);
    }

    #[test]
    fn pending_drains_and_clears() {
        let d = tempfile::tempdir().unwrap();
        push_pending(d.path(), "w1:p1").unwrap();
        push_pending(d.path(), "w1:p2").unwrap();
        assert_eq!(drain_pending(d.path()).unwrap(), vec!["w1:p1", "w1:p2"]);
        assert!(drain_pending(d.path()).unwrap().is_empty());
    }

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
    fn push_pending_preserves_prior_entries() {
        let d = tempfile::tempdir().unwrap();
        push_pending(d.path(), "w1:p1").unwrap();
        push_pending(d.path(), "w1:p2").unwrap();
        push_pending(d.path(), "w1:p3").unwrap();
        // Each push read-modify-writes the file without dropping earlier panes.
        assert_eq!(
            drain_pending(d.path()).unwrap(),
            vec!["w1:p1", "w1:p2", "w1:p3"]
        );
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
