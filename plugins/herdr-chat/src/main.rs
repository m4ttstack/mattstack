use clap::{Parser, Subcommand};

mod deck;
mod herdr;
mod json;
mod rt;
mod run;
mod state;
mod theme;
mod ui;
mod cmd {
    pub mod broadcast;
    pub mod jump;
    pub mod launcher;
    pub mod open_viewer;
    pub mod peek;
    pub mod picker;
    pub mod quick_send;
    pub mod sign;
}

#[derive(Parser)]
#[command(name = "herdr-chat")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Open the chat web viewer (deck-sourced URL).
    OpenViewer {
        #[arg(long)]
        room: Option<String>,
    },
    /// Broadcast a message to picked panes. The workspace action opens the
    /// popup; `--pane` is the popup entrypoint that runs the TUI.
    Broadcast {
        #[arg(long)]
        pane: bool,
        #[arg(long)]
        json: bool,
        /// Comma-separated pane ids.
        #[arg(long, value_delimiter = ',')]
        panes: Vec<String>,
        #[arg(long)]
        body: Option<String>,
    },
    /// Peek: online buddies + unread rooms as a launcher. The workspace action
    /// opens the popup; `--pane` is the popup entrypoint that runs the TUI.
    Peek {
        #[arg(long)]
        pane: bool,
        #[arg(long)]
        json: bool,
    },
    /// Quick-send: one line to a room or a buddy DM. The workspace action
    /// opens the popup; `--pane` is the popup entrypoint that runs the TUI.
    QuickSend {
        #[arg(long)]
        pane: bool,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        body: Option<String>,
    },
    /// One launcher popup over every capability. The pane action stashes the
    /// focused pane and opens the popup; `--pane` is the popup entrypoint.
    Launcher {
        #[arg(long)]
        pane: bool,
    },
    /// Sign in to chat.
    SignIn {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pane: Option<String>,
    },
    /// Sign out of chat.
    SignOut {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        pane: Option<String>,
    },
    /// Print the chat status of a pane. JSON only.
    Status {
        #[arg(long)]
        pane: Option<String>,
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
    /// Print what quick-send can send to. JSON only.
    Targets {
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
    /// Print where a handle's pane is. JSON only, and moves no focus.
    Jump {
        #[arg(long)]
        handle: String,
        /// Accepted for symmetry with the other verbs. This one has no other
        /// mode, so it changes nothing.
        #[arg(long)]
        json: bool,
    },
}

/// `--pane` wins over the environment: a caller outside herdr has no
/// `HERDR_PANE_ID` to inherit, and a caller inside one may mean a pane other
/// than the one it happens to be running in.
fn sign_dispatch(
    runner: &run::RealRunner,
    which: cmd::sign::Sign,
    json: bool,
    pane: Option<String>,
) -> std::process::ExitCode {
    let pane = pane.or_else(|| std::env::var("HERDR_PANE_ID").ok());
    if !json {
        return match cmd::sign::run_with(runner, which, pane.as_deref()) {
            Ok(_) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("sign: {e}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    match cmd::sign::run_json(runner, which, pane.as_deref()).and_then(|s| json::emit(&s)) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            json::fail(&e);
            std::process::ExitCode::FAILURE
        }
    }
}

fn main() -> std::process::ExitCode {
    let runner = run::RealRunner;
    match Cli::parse().cmd {
        Cmd::OpenViewer { room } => match cmd::open_viewer::run(&runner, room.as_deref()) {
            Ok(_) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("open-viewer: {e}");
                std::process::ExitCode::FAILURE
            }
        },
        Cmd::Broadcast {
            pane,
            json,
            panes,
            body,
        } => {
            if json {
                return match body
                    .ok_or_else(|| "--body is required with --json".to_string())
                    .and_then(|body| cmd::broadcast::fan_out_json(&runner, &panes, &body))
                    .and_then(|b| json::emit(&b))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
            let result = if pane {
                cmd::broadcast::run(&runner)
            } else {
                cmd::broadcast::open(&runner)
            };
            match result {
                Ok(_) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("broadcast: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::Peek { pane, json } => {
            if json {
                return match cmd::peek::rows_json(&runner).and_then(|p| json::emit(&p)) {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
            let result = if pane {
                cmd::peek::run(&runner)
            } else {
                cmd::peek::open(&runner)
            };
            match result {
                Ok(_) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("peek: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::QuickSend {
            pane,
            json,
            to,
            body,
        } => {
            if json {
                return match to
                    .zip(body)
                    .ok_or_else(|| "--to and --body are required with --json".to_string())
                    .and_then(|(to, body)| cmd::quick_send::send_json(&runner, &to, &body))
                    .and_then(|s| json::emit(&s))
                {
                    Ok(()) => std::process::ExitCode::SUCCESS,
                    Err(e) => {
                        json::fail(&e);
                        std::process::ExitCode::FAILURE
                    }
                };
            }
            let result = if pane {
                cmd::quick_send::run(&runner)
            } else {
                cmd::quick_send::open(&runner)
            };
            match result {
                Ok(_) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("quick-send: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::Launcher { pane } => {
            let result = if pane {
                cmd::launcher::run(&runner)
            } else {
                cmd::launcher::open(&runner)
            };
            match result {
                Ok(_) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("launcher: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::SignIn { json, pane } => sign_dispatch(&runner, cmd::sign::Sign::In, json, pane),
        Cmd::SignOut { json, pane } => sign_dispatch(&runner, cmd::sign::Sign::Out, json, pane),
        Cmd::Status { pane, json: _ } => {
            let pane = pane.or_else(|| std::env::var("HERDR_PANE_ID").ok());
            match cmd::launcher::status_json(&runner, pane.as_deref()).and_then(|s| json::emit(&s))
            {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::Targets { json: _ } => {
            match cmd::quick_send::targets_json(&runner).and_then(|t| json::emit(&t)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Cmd::Jump { handle, json: _ } => {
            match cmd::jump::locate(&runner, &handle).and_then(|j| json::emit(&j)) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(e) => {
                    json::fail(&e);
                    std::process::ExitCode::FAILURE
                }
            }
        }
    }
}
