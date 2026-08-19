//! JSON command routing for `kashiyomi.dispatch`.
//!
//! Request:  `{"cmd": "init" | "install" | "dictStatus" | "cancelInstall" | "freeSpace" | "sweepPartials" | "status" | "analyze", ...}`
//! Response: `{"status": "ok", "data": ...}` or `{"status": "error", "message": "..."}`

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{analyzer, install, job};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Command {
    #[serde(rename_all = "camelCase")]
    Init {
        dict_path: String,
        resource_dir: String,
    },
    /// Verify a downloaded archive, put the dictionary in place, and load it.
    ///
    /// The host does the fetching; this does the part that must not touch the
    /// JS heap — and, deliberately, **the whole tail in one call**. Unloading,
    /// renaming and loading were split across the FFI boundary, which is how
    /// they ended up in the wrong order: the host cannot unload, because the
    /// analyzer's state is behind its own mutex, so the rename always ran
    /// against a still-mapped file.
    #[serde(rename_all = "camelCase")]
    Install {
        archive: String,
        sha256: String,
        member: String,
        target: String,
        resource_dir: String,
        /// A dictionary this one replaces, deleted only once the new one loads.
        #[serde(default)]
        superseded: Option<String>,
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
    /// Analyzer state and install progress in one call, for polling while an
    /// install runs on its worker thread.
    DictStatus,
    /// Ask a running install to stop. Refused once the swap has begun.
    CancelInstall,
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

/// The install job as JSON. `kind` is what the host branches on; the other
/// fields are present only where they mean something.
fn job_data() -> serde_json::Value {
    match job::snapshot() {
        job::Job::Idle => json!({ "kind": "idle" }),
        job::Job::Running { phase, done, total } => json!({
            "kind": "running",
            "phase": phase.as_str(),
            "done": done,
            "total": total,
        }),
        job::Job::Done { bytes, started } => json!({
            "kind": "done",
            "bytes": bytes,
            "started": started,
        }),
        job::Job::Failed { message } => json!({ "kind": "failed", "message": message }),
        job::Job::Cancelled => json!({ "kind": "cancelled" }),
    }
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
        Command::Install {
            archive,
            sha256,
            member,
            target,
            resource_dir,
            superseded,
        } => {
            // Returns as soon as the worker is running. Hashing 69 to 121 MB and
            // extracting 207 MB used to happen on the renderer thread, which is
            // the thread NCM draws with, so the whole app stopped for the
            // duration with nothing on screen explaining it.
            if !job::begin() {
                return ok(json!({ "started": false, "busy": true }));
            }
            std::thread::spawn(move || {
                let outcome = install::verify_and_install(
                    &archive,
                    &sha256,
                    &member,
                    &target,
                    &|| {
                        analyzer::unload();
                    },
                    &|phase, done, total| job::progress(phase, done, total),
                    &job::is_cancelled,
                );
                match outcome {
                    Err(install::InstallError::Cancelled) => job::finish_cancelled(),
                    Ok(installed) => {
                        // The dictionary is unloaded at this point *because* the
                        // rename required it, so loading again is not optional:
                        // returning without it would leave the analyzer closed.
                        job::progress(job::Phase::Loading, 0, 0);
                        let started =
                            analyzer::begin_reload_replacing(target, resource_dir, superseded);
                        job::finish_ok(installed.bytes, started);
                    }
                    Err(install::InstallError::Failed(message)) => job::finish_err(message),
                }
            });
            ok(json!({ "started": true }))
        }
        // `accepted: false` means the worker is past the swap, not that the
        // command failed. The row keeps its Cancel visible and disabled through
        // those phases, so this should not normally be reachable from the UI.
        Command::CancelInstall => ok(json!({ "accepted": job::request_cancel() })),
        // One poll for everything the host needs while an install runs: how the
        // worker is getting on, and whether the analyzer has come back up
        // afterwards. Deliberately does *not* report which editions are on disk.
        // That answer depends on the `system_<edition>.dic` naming, which
        // `engine/dictionaryLayout.ts` exists to be the only holder of, and
        // duplicating it here would recreate the defect that module was written
        // to end.
        Command::DictStatus => ok(json!({
            "analyzer": status_data(),
            "job": job_data(),
        })),
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
