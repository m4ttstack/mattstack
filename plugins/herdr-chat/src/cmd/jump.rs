//! `jump`: the pane a buddy is signed in on, found by the pane list's
//! `presence.handle`. Two entry points over that one map, and they differ in
//! what they do with the answer: [`jump_to`] focuses the pane through
//! [`herdr::focus_pane`], and is the peek row action the popup dispatches;
//! [`locate`] is the `jump` subcommand, and answers with the pane while moving
//! nothing, because the caller driving it focuses panes itself.

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

/// The pane `handle` is signed in on. Errs rather than answering an empty
/// object, so a caller cannot mistake "nobody by that name" for "found it".
pub fn locate(r: &dyn Runner, handle: &str) -> Result<crate::json::Jump, String> {
    let panes = rt::pane_list(r)?;
    let pane = panes
        .iter()
        .find(|p| p.presence.as_ref().is_some_and(|pr| pr.handle == handle))
        .ok_or_else(|| format!("no pane is signed in as {handle:?}"))?;
    Ok(crate::json::Jump {
        pane_id: pane.pane_id.clone(),
        workspace: pane.workspace.clone(),
        handle: handle.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Output;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Fake [`Runner`] that serves canned stdout per call, in order, and counts
    /// how many times it was called. A drained sequence panics rather than
    /// answering empty, so an unexpected extra call fails its test. `Mutex`
    /// because `Runner: Send + Sync`.
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
            let body = self
                .bodies
                .lock()
                .unwrap()
                .pop_front()
                .expect("sequence exhausted: unexpected extra call");
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
                name: None,
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

    /// Named apart from this module's existing `ONE_PANE`, which is herdr's
    /// snapshot shape rather than rt's roster.
    const RT_ONE_PANE: &str = r#"{"ok":true,"panes":[{"paneId":"w1:p1","workspace":"flock","agentStatus":"idle","presence":{"handle":"kay","status":"live"}}]}"#;

    #[test]
    fn locate_answers_with_the_pane_that_handle_is_signed_in_on() {
        let r = FakeRunner::sequence(&[RT_ONE_PANE]);
        let j = locate(&r, "kay").unwrap();
        assert_eq!(j.pane_id, "w1:p1");
        assert_eq!(j.workspace, "flock");
        assert_eq!(j.handle, "kay");
    }

    /// An empty answer would be mistaken for "found it, at no pane".
    #[test]
    fn locate_is_an_error_for_a_handle_on_no_pane() {
        let r = FakeRunner::sequence(&[r#"{"ok":true,"panes":[]}"#]);
        assert!(locate(&r, "ghost").is_err());
    }

    #[test]
    fn locate_never_moves_focus() {
        let r = FakeRunner::sequence(&[RT_ONE_PANE]);
        locate(&r, "kay").unwrap();
        assert_eq!(
            r.call_count(),
            1,
            "a second call here is a focus this verb must not perform"
        );
    }
}
