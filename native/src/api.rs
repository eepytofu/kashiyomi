//! JSON command routing for `kashiyomi.dispatch`.
//!
//! Request:  `{"cmd": "init" | "reload" | "install" | "freeSpace" | "sweepPartials" | "status" | "analyze", ...}`
//! Response: `{"status": "ok", "data": ...}` or `{"status": "error", "message": "..."}`

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{analyzer, install};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Command {
    #[serde(rename_all = "camelCase")]
    Init {
        dict_path: String,
        resource_dir: String,
    },
    /// Swap the loaded dictionary without restarting NCM. `init` cannot do
    /// this: it returns early once a dictionary is loaded, by design.
    #[serde(rename_all = "camelCase")]
    Reload {
        dict_path: String,
        resource_dir: String,
    },
    /// Verify a downloaded archive and move the dictionary into place. The host
    /// does the fetching; this does the part that must not touch the JS heap.
    #[serde(rename_all = "camelCase")]
    Install {
        archive: String,
        sha256: String,
        member: String,
        target: String,
    },
    /// Bytes free on the volume holding a directory, for checking before a
    /// download rather than after the bandwidth is spent.
    FreeSpace {
        directory: String,
    },
    /// Delete `.part` files abandoned by an interrupted download.
    SweepPartials {
        directory: String,
    },
    Status,
    Analyze {
        lines: Vec<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusData {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok(data: serde_json::Value) -> String {
    json!({ "status": "ok", "data": data }).to_string()
}

fn error(message: impl Into<String>) -> String {
    json!({ "status": "error", "message": message.into() }).to_string()
}

fn status_data() -> StatusData {
    match analyzer::state() {
        analyzer::StateView::Uninitialized => StatusData { state: "uninitialized", error: None },
        analyzer::StateView::Loading => StatusData { state: "loading", error: None },
        analyzer::StateView::Ready => StatusData { state: "ready", error: None },
        analyzer::StateView::Failed(message) => {
            StatusData { state: "failed", error: Some(message) }
        }
    }
}

pub fn handle(raw: &str) -> String {
    let command: Command = match serde_json::from_str(raw) {
        Ok(command) => command,
        Err(parse_error) => return error(format!("bad command: {parse_error}")),
    };
    match command {
        Command::Init { dict_path, resource_dir } => {
            analyzer::begin_init(dict_path, resource_dir);
            ok(json!(status_data()))
        }
        Command::Reload { dict_path, resource_dir } => {
            // `false` means a load was already running. Reported rather than
            // queued, so the caller can retry once the state settles instead of
            // two threads racing to replace the same dictionary.
            let started = analyzer::begin_reload(dict_path, resource_dir);
            ok(json!({ "started": started, "state": status_data().state }))
        }
        Command::Install { archive, sha256, member, target } => {
            match install::verify_and_install(&archive, &sha256, &member, &target) {
                Ok(installed) => ok(json!({ "bytes": installed.bytes })),
                Err(message) => error(message),
            }
        }
        Command::FreeSpace { directory } => {
            ok(json!({ "bytes": install::free_space(&directory) }))
        }
        Command::SweepPartials { directory } => {
            ok(json!({ "removed": install::sweep_partials(&directory) }))
        }
        Command::Status => ok(json!(status_data())),
        Command::Analyze { lines } => match analyzer::analyze_lines(&lines) {
            Ok(tokens) => ok(json!({ "state": "ready", "lines": tokens })),
            Err(analyzer::AnalyzeError::NotReady) => ok(json!(status_data())),
            Err(analyzer::AnalyzeError::Tokenize(message)) => error(message),
        },
    }
}
