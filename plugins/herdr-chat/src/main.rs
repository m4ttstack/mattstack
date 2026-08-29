use clap::{Parser, Subcommand};

mod deck;
mod herdr;
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
    },
    /// Peek: online buddies + unread rooms as a launcher. The workspace action
    /// opens the popup; `--pane` is the popup entrypoint that runs the TUI.
    Peek {
        #[arg(long)]
        pane: bool,
    },
    /// Quick-send: one line to a room or a buddy DM. The workspace action
    /// opens the popup; `--pane` is the popup entrypoint that runs the TUI.
    QuickSend {
        #[arg(long)]
        pane: bool,
    },
    /// One launcher popup over every capability. The pane action stashes the
    /// focused pane and opens the popup; `--pane` is the popup entrypoint.
    Launcher {
        #[arg(long)]
        pane: bool,
    },
    /// Sign in to chat.
    SignIn,
    /// Sign out of chat.
    SignOut,
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
        Cmd::Broadcast { pane } => {
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
        Cmd::Peek { pane } => {
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
        Cmd::QuickSend { pane } => {
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
        Cmd::SignIn => match cmd::sign::run(&runner) {
            Ok(_) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("sign-in: {e}");
                std::process::ExitCode::FAILURE
            }
        },
        Cmd::SignOut => match cmd::sign::run_with(
            &runner,
            cmd::sign::Sign::Out,
            std::env::var("HERDR_PANE_ID").ok().as_deref(),
        ) {
            Ok(_) => std::process::ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("sign-out: {e}");
                std::process::ExitCode::FAILURE
            }
        },
    }
}
