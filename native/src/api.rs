//! JSON command routing for `kashiyomi.dispatch`.
//!
//! Request:  `{"cmd": "init" | "status" | "analyze", ...}`
//! Response: `{"status": "ok", "data": ...}` or `{"status": "error", "message": "..."}`

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::analyzer;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Command {
    #[serde(rename_all = "camelCase")]
    Init {
        dict_path: String,
        resource_dir: String,
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
        Command::Status => ok(json!(status_data())),
        Command::Analyze { lines } => match analyzer::analyze_lines(&lines) {
            Ok(tokens) => ok(json!({ "state": "ready", "lines": tokens })),
            Err(analyzer::AnalyzeError::NotReady) => ok(json!(status_data())),
            Err(analyzer::AnalyzeError::Tokenize(message)) => error(message),
        },
    }
}
