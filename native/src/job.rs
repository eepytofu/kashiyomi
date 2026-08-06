//! The state of a running install, readable while it is still running.
//!
//! `install` used to be a synchronous command: the renderer thread hashed
//! 69 to 121 MB and then extracted 207 MB before returning, so NCM's whole UI
//! froze for seconds with nothing on screen to say why. The work now happens on
//! a worker thread and this is how the host finds out how it is going.
//!
//! One job at a time, deliberately. Two installs writing the same target is the
//! one race that can corrupt a good dictionary, and `begin` refusing is a
//! cheaper guard than any amount of coordination afterwards.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Verifying,
    Extracting,
    Swapping,
    Loading,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Verifying => "verifying",
            Phase::Extracting => "extracting",
            Phase::Swapping => "swapping",
            Phase::Loading => "loading",
        }
    }
}

#[derive(Clone)]
pub enum Job {
    Idle,
    Running {
        phase: Phase,
        done: u64,
        /// Zero when the size is not knowable yet, which the host reads as
        /// indeterminate rather than as "no work to do".
        total: u64,
    },
    Done {
        bytes: u64,
        /// Whether the analyzer accepted the load. False means it was busy, not
        /// that the dictionary is bad: the file is in place and verified.
        started: bool,
    },
    Failed {
        message: String,
    },
    /// Stopped on request. Distinct from `Failed` because nothing is wrong: the
    /// row goes back to offering exactly what it offered before the press,
    /// rather than reporting a fault the user caused deliberately.
    Cancelled,
}

/// Set by `request_cancel`, read by the worker between chunks.
///
/// An `AtomicBool` rather than a field on the job, because the worker checks it
/// thousands of times over a 207 MB extract and taking the job mutex that often
/// would put the polling host and the worker in each other's way.
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn is_cancelled() -> bool {
    CANCEL.load(Ordering::Relaxed)
}

/// Ask the worker to stop, or refuse because it is past the point of no return.
///
/// Returns false once the swap has begun. By then the old dictionary is
/// unloaded and the rename may already have landed, so "stopping" would leave
/// the analyzer closed over a half-replaced file, which is worse than finishing.
pub fn request_cancel() -> bool {
    let guard = cell().lock().expect("install job lock");
    match &*guard {
        Job::Running { phase: Phase::Verifying | Phase::Extracting, .. } => {
            CANCEL.store(true, Ordering::Relaxed);
            true
        }
        _ => false,
    }
}

pub fn finish_cancelled() {
    *cell().lock().expect("install job lock") = Job::Cancelled;
}

fn cell() -> &'static Mutex<Job> {
    static JOB: OnceLock<Mutex<Job>> = OnceLock::new();
    JOB.get_or_init(|| Mutex::new(Job::Idle))
}

pub fn snapshot() -> Job {
    cell().lock().expect("install job lock").clone()
}

/// Claim the job slot, or refuse because one is already running.
///
/// A finished job does not block a new one: `Done` and `Failed` are results
/// waiting to be read, not work in progress.
pub fn begin() -> bool {
    let mut guard = cell().lock().expect("install job lock");
    if matches!(*guard, Job::Running { .. }) {
        return false;
    }
    // Cleared here rather than after the previous job ended: a cancel that
    // arrived as the worker was already finishing would otherwise still be set
    // and stop the next install before it began.
    CANCEL.store(false, Ordering::Relaxed);
    *guard = Job::Running { phase: Phase::Verifying, done: 0, total: 0 };
    true
}

pub fn progress(phase: Phase, done: u64, total: u64) {
    let mut guard = cell().lock().expect("install job lock");
    // Only a running job has progress. Writing into a finished one would
    // resurrect it and leave the host waiting for an end that already happened.
    if matches!(*guard, Job::Running { .. }) {
        *guard = Job::Running { phase, done, total };
    }
}

pub fn finish_ok(bytes: u64, started: bool) {
    *cell().lock().expect("install job lock") = Job::Done { bytes, started };
}

pub fn finish_err(message: String) {
    *cell().lock().expect("install job lock") = Job::Failed { message };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test, not three. The job slot is process-global and `cargo test` runs
    /// a crate's tests in parallel, so separate tests would race each other for
    /// it and fail on timing rather than on behaviour.
    #[test]
    fn the_job_slot_admits_one_writer_and_stays_finished() {
        // The window that matters is verify through swap: two installs renaming
        // onto the same target is the one race that can corrupt a good
        // dictionary.
        assert!(begin());
        assert!(!begin(), "a second install started while one was running");

        // A finished job is a result waiting to be read, not work in progress,
        // so it must not block the next attempt.
        finish_ok(1, true);
        assert!(begin());

        // Late progress from a thread that has already failed must not
        // resurrect the job; the host would wait forever for an end that
        // already happened.
        finish_err("failed".into());
        progress(Phase::Extracting, 5, 10);
        assert!(matches!(snapshot(), Job::Failed { .. }));

        // Nothing is running, so there is nothing to cancel.
        assert!(!request_cancel());

        // The two long phases can be stopped.
        assert!(begin());
        progress(Phase::Extracting, 1, 10);
        assert!(request_cancel());
        assert!(is_cancelled());

        // Past the swap the old dictionary is unloaded and the rename may have
        // landed, so a cancel would leave the analyzer closed over a
        // half-replaced file. Refused.
        finish_cancelled();
        assert!(begin());
        progress(Phase::Swapping, 0, 0);
        assert!(!request_cancel());

        // Starting a job clears a stale flag, or the next install would stop
        // before it began.
        assert!(!is_cancelled(), "begin must clear the cancel flag");
        finish_cancelled();
    }
}
