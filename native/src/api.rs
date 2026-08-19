//! JSON command routing for `kashiyomi.dispatch`.
//!
//! Browser callers may choose an edition or cancel an operation, but they
//! never supply a URL or a target dictionary path. Release pins and all
//! network/filesystem transactions remain native-owned.

use serde::Deserialize;
use serde_json::json;

use crate::analyzer;
use crate::dictionary::{self, ErrorCode};
use crate::releases::Edition;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    #[serde(rename_all = "camelCase")]
    ConfigureDictionary {
        data_dir: String,
        resource_dir: String,
        legacy_preference: Edition,
    },
    DictionaryStatus,
    DictionaryInstall {
        edition: Edition,
    },
    DictionaryActivate {
        edition: Edition,
    },
    DictionaryRemove {
        edition: Edition,
    },
    #[serde(rename_all = "camelCase")]
    DictionaryCancel {
        operation_id: u64,
    },
    Analyze {
        lines: Vec<String>,
    },
}

fn ok(data: impl serde::Serialize) -> String {
    json!({ "status": "ok", "data": data }).to_string()
}

fn error(code: &str) -> String {
    json!({ "status": "error", "errorCode": code }).to_string()
}

fn manager_error(code: ErrorCode) -> String {
    let value = serde_json::to_value(code).unwrap_or_else(|_| json!("io"));
    error(value.as_str().unwrap_or("io"))
}

fn analyzer_status() -> serde_json::Value {
    match analyzer::state() {
        analyzer::StateView::Uninitialized => json!({ "state": "uninitialized" }),
        analyzer::StateView::Loading => json!({ "state": "loading" }),
        analyzer::StateView::Ready => json!({ "state": "ready" }),
        analyzer::StateView::Failed(_) => json!({ "state": "failed" }),
    }
}

fn dictionary_status() -> serde_json::Value {
    json!({
        "dictionary": dictionary::status(),
        "analyzer": analyzer_status(),
    })
}

pub fn handle(raw: &str) -> String {
    let command: Command = match serde_json::from_str(raw) {
        Ok(command) => command,
        Err(_) => return error("badCommand"),
    };
    match command {
        Command::ConfigureDictionary {
            data_dir,
            resource_dir,
            legacy_preference,
        } => match dictionary::configure(data_dir, resource_dir, legacy_preference) {
            Ok(_) => ok(dictionary_status()),
            Err(code) => manager_error(code),
        },
        Command::DictionaryStatus => ok(dictionary_status()),
        Command::DictionaryInstall { edition } => match dictionary::install(edition) {
            Ok(operation_id) => ok(json!({ "operationId": operation_id })),
            Err(code) => manager_error(code),
        },
        Command::DictionaryActivate { edition } => match dictionary::activate(edition) {
            Ok(operation_id) => ok(json!({ "operationId": operation_id })),
            Err(code) => manager_error(code),
        },
        Command::DictionaryRemove { edition } => match dictionary::remove(edition) {
            Ok(operation_id) => ok(json!({ "operationId": operation_id })),
            Err(code) => manager_error(code),
        },
        Command::DictionaryCancel { operation_id } => {
            ok(json!({ "accepted": dictionary::cancel(operation_id) }))
        }
        Command::Analyze { lines } => match analyzer::analyze_lines(&lines) {
            Ok(lines) => ok(json!({ "state": "ready", "lines": lines })),
            Err(analyzer::AnalyzeError::NotReady) => ok(analyzer_status()),
            Err(analyzer::AnalyzeError::Tokenize(_)) => error("analysisFailed"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_browser_supplied_install_paths() {
        let response = handle(
            r#"{"cmd":"dictionaryInstall","edition":"core","url":"https://example.com","target":"x"}"#,
        );
        assert!(response.contains("badCommand"));
    }

    #[test]
    fn status_is_available_before_configuration() {
        let response = handle(r#"{"cmd":"dictionaryStatus"}"#);
        assert!(response.contains("\"configured\":false"));
        assert!(response.contains("\"analyzer\""));
    }
}
