//! `jump`: focus a buddy's local pane. This is a peek row action, not its own
//! subcommand ... the handle comes from the row the user picked in the popup.
//! The map is handle -> pane id (via the pane list's `presence.handle`) ->
//! [`herdr::focus_pane`].

use crate::herdr;
use crate::rt;
use crate::run::Runner;

/// Focus the pane a buddy is signed in on. Resolves `handle` to a pane id by its
/// `presence.handle` in `panes`, then focuses that pane. Returns `false` when no
/// pane carries the handle (the buddy has no local pane) or when the pane is
/// absent from herdr's snapshot.
pub fn jump_to(r: &dyn Runner, handle: &str, panes: &[rt::ChatPane]) -> Result<bool, String> {
    let Some(pane) = panes
        .iter()
        .find(|p| p.presence.as_ref().is_some_and(|pr| pr.handle == handle))
    else {
        return Ok(false);
    };
    herdr::focus_pane(r, &pane.pane_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Fake [`Runner`] that serves canned stdout per call, in order, and counts
    /// how many times it was called. `Mutex` because `Runner: Send + Sync`.
    struct FakeRunner {
        bodies: Mutex<VecDeque<String>>,
        calls: Mutex<usize>,
    }

    impl FakeRunner {
        fn sequence(bodies: &[&str]) -> Self {
            FakeRunner {
                bodies: Mutex::new(bodies.iter().map(|s| s.to_string()).collect()),
                calls: Mutex::new(0),
            }
        }
        fn call_count(&self) -> usize {
            *self.calls.lock().unwrap()
        }
    }

    impl Runner for FakeRunner {
        fn run(&self, _argv: &[&str], _env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
            *self.calls.lock().unwrap() += 1;
            let body = self.bodies.lock().unwrap().pop_front().unwrap_or_default();
            Ok(Output {
                status: 0,
                stdout: body,
                stderr: String::new(),
            })
        }
    }

    // Real `herdr api snapshot` wraps the session as
    // `{"result":{"snapshot":{"panes":[...]}}}`; the fakes mirror that envelope.
    const ONE_PANE: &str = r#"{"result":{"snapshot":{"panes":[{"pane_id":"w1:p2","workspace_id":"w1","tab_id":"w1:t1"}]}}}"#;
    const NO_PANES: &str = r#"{"result":{"snapshot":{"panes":[]}}}"#;

    fn with_presence(pane_id: &str, handle: &str) -> rt::ChatPane {
        rt::ChatPane {
            pane_id: pane_id.to_string(),
            workspace: "ws".to_string(),
            title: None,
            cwd: None,
            repo: None,
            branch: None,
            agent_status: "idle".to_string(),
            session_id: None,
            presence: Some(rt::Presence {
                handle: handle.to_string(),
                status: "live".to_string(),
                rooms: Vec::new(),
            }),
        }
    }

    #[test]
    fn jump_maps_handle_to_pane_and_focuses() {
        let panes = vec![with_presence("w1:p2", "fred")];
        // focus_pane walks snapshot -> workspace focus -> tab focus -> pane zoom.
        let r = FakeRunner::sequence(&[ONE_PANE, "{}", "{}", "{}"]);
        assert!(jump_to(&r, "fred", &panes).unwrap());
        assert_eq!(r.call_count(), 4);
    }

    #[test]
    fn jump_is_false_for_a_buddy_with_no_local_pane() {
        // No presence match -> false without ever shelling out to herdr.
        let r = FakeRunner::sequence(&[]);
        assert!(!jump_to(&r, "ghost", &[]).unwrap());
        assert_eq!(r.call_count(), 0);
    }

    #[test]
    fn jump_is_false_when_the_pane_is_absent_from_the_snapshot() {
        // Handle matches a pane, but that pane is gone from herdr's snapshot:
        // only the snapshot read happens, and the result is false.
        let panes = vec![with_presence("w1:p9", "zed")];
        let r = FakeRunner::sequence(&[NO_PANES]);
        assert!(!jump_to(&r, "zed", &panes).unwrap());
        assert_eq!(r.call_count(), 1);
    }
}
