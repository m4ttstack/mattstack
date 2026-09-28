use std::io::Write;
use std::process::{Command, Stdio};

/// The captured result of running a subprocess.
pub struct Output {
    pub status: i32,
    pub stdout: String,
    // Read by later subcommands that surface a failed subprocess's diagnostics.
    #[allow(dead_code)]
    pub stderr: String,
}

/// The injectable subprocess seam. Every subcommand shells out through this so
/// tests can substitute a fake that records argv instead of spawning.
pub trait Runner: Send + Sync {
    /// Run `argv` with an optional env overlay applied on top of the inherited
    /// environment. In each `env` entry, `Some(v)` sets the var and `None`
    /// UNSETS it (the `HERDR_PANE_ID` scrub later subcommands rely on).
    fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output>;

    /// Run `argv` while writing `stdin` to the child's standard input, closing it
    /// at EOF before waiting. The default drops `stdin` and forwards to [`run`];
    /// `RealRunner` overrides it to pipe the body in. Used to deliver a broadcast
    /// body that rt's `--text` parser would otherwise misread (a bare `-` means
    /// "read stdin", so any leading-dash body rides stdin instead of argv).
    fn run_with_stdin(
        &self,
        argv: &[&str],
        env: &[(&str, Option<&str>)],
        stdin: &str,
    ) -> std::io::Result<Output> {
        let _ = stdin;
        self.run(argv, env)
    }
}

pub struct RealRunner;

/// The command for `argv` with the env overlay applied (`Some` sets, `None`
/// unsets). Shared by [`RealRunner::run`] and [`RealRunner::run_with_stdin`].
fn base_command(argv: &[&str], env: &[(&str, Option<&str>)]) -> Command {
    let mut cmd = Command::new(argv[0]);
    cmd.args(&argv[1..]);
    for (key, val) in env {
        match val {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
    cmd
}

fn to_output(out: std::process::Output) -> Output {
    Output {
        status: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

impl Runner for RealRunner {
    fn run(&self, argv: &[&str], env: &[(&str, Option<&str>)]) -> std::io::Result<Output> {
        Ok(to_output(base_command(argv, env).output()?))
    }

    fn run_with_stdin(
        &self,
        argv: &[&str],
        env: &[(&str, Option<&str>)],
        stdin: &str,
    ) -> std::io::Result<Output> {
        let mut child = base_command(argv, env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        // Drop the write handle after writing so the child sees EOF and does not
        // hang waiting for more input before we collect its output.
        if let Some(mut pipe) = child.stdin.take() {
            if let Err(e) = pipe.write_all(stdin.as_bytes()) {
                // Close stdin and reap the child before returning, so a write
                // failure cannot leave a zombie or deadlock on a full pipe.
                drop(pipe);
                let _ = child.wait_with_output();
                return Err(e);
            }
        }
        Ok(to_output(child.wait_with_output()?))
    }
}

/// The `rt` binary path: `RT_BIN_PATH` else `rt` on `PATH`.
pub fn rt_bin() -> String {
    std::env::var("RT_BIN_PATH").unwrap_or_else(|_| "rt".to_string())
}

/// The `herdr` binary path: `HERDR_BIN_PATH` else `herdr` on `PATH`.
// Consumed by the herdr subprocess calls a later task (herdr.rs) adds.
#[allow(dead_code)]
pub fn herdr_bin() -> String {
    std::env::var("HERDR_BIN_PATH").unwrap_or_else(|_| "herdr".to_string())
}

/// The `deck` binary path: `DECK_BIN_PATH` else `deck` on `PATH`.
pub fn deck_bin() -> String {
    std::env::var("DECK_BIN_PATH").unwrap_or_else(|_| "deck".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_sets_a_var() {
        let r = RealRunner;
        let out = r
            .run(
                &["/bin/sh", "-c", "printf '%s' \"$HERDR_OVERLAY_SET\""],
                &[("HERDR_OVERLAY_SET", Some("yes"))],
            )
            .unwrap();
        assert_eq!(out.status, 0);
        assert_eq!(out.stdout, "yes");
    }

    #[test]
    fn overlay_none_unsets_a_var() {
        // HOME is inherited from the parent env and `sh` does not repopulate it
        // (unlike PATH); `${HOME+SET}` prints SET only while it is set. The None
        // overlay must fully remove it.
        let r = RealRunner;
        let with = r
            .run(&["/bin/sh", "-c", "printf '%s' \"${HOME+SET}\""], &[])
            .unwrap();
        assert_eq!(with.stdout, "SET");

        let scrubbed = r
            .run(
                &["/bin/sh", "-c", "printf '%s' \"${HOME+SET}\""],
                &[("HOME", None)],
            )
            .unwrap();
        assert_eq!(scrubbed.stdout, "");
    }

    #[test]
    fn run_with_stdin_pipes_the_body_verbatim() {
        // `cat` echoes stdin unchanged, so a leading-dash, multi-line body must
        // come back byte-for-byte through the pipe.
        let r = RealRunner;
        let out = r
            .run_with_stdin(&["/bin/cat"], &[], "-rf\nsecond line")
            .unwrap();
        assert_eq!(out.status, 0);
        assert_eq!(out.stdout, "-rf\nsecond line");
    }

    #[test]
    fn captures_status_and_stderr() {
        let r = RealRunner;
        let out = r
            .run(&["/bin/sh", "-c", "printf oops >&2; exit 3"], &[])
            .unwrap();
        assert_eq!(out.status, 3);
        assert_eq!(out.stderr, "oops");
    }

    #[test]
    fn bin_resolvers_default_to_bare_names() {
        // No env override in the test process, so the bare command name wins.
        assert_eq!(rt_bin(), "rt");
        assert_eq!(herdr_bin(), "herdr");
        assert_eq!(deck_bin(), "deck");
    }
}
