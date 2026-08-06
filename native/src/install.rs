//! Verify a downloaded dictionary archive and install it.
//!
//! The host fetches the wheel over HTTPS — `fetch` is already there, already
//! streams, and already honours whatever proxy the user has configured, which
//! a hand-rolled Rust client would not. It writes the bytes to a `.part` file
//! and calls in here for the rest, because extraction produces 207 MB and that
//! must never exist in the renderer's heap.
//!
//! Everything below is written so that **a failure at any point leaves the
//! previous dictionary exactly as it was**. Nothing writes to the live path;
//! the last step is a rename over it, and only after the hash matched and the
//! extraction finished.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::job::Phase;

/// Read in chunks rather than to a `Vec`: the archive is ~69 MB and the member
/// inside it is ~207 MB, and neither has any business being resident.
const CHUNK: usize = 1 << 20;

pub struct Installed {
    pub bytes: u64,
}

/// Why an install stopped.
///
/// Cancellation is its own variant rather than an error string the caller
/// pattern-matches: nothing is wrong when a user stops a download, and mapping
/// it back out of a message would be one `contains("cancel")` away from
/// misreading a genuine failure that happens to mention the word.
#[derive(Debug)]
pub enum InstallError {
    Cancelled,
    Failed(String),
}

impl From<String> for InstallError {
    fn from(message: String) -> Self {
        InstallError::Failed(message)
    }
}

/// Hash `archive`, extract `member` from it, and move the result onto `target`.
///
/// `expected_sha256` is pinned at build time rather than fetched at runtime. A
/// user whose upstream is blocked cannot reach the metadata API to *get* a
/// hash, so looking it up online would drop the check exactly where the
/// download is least trustworthy — behind a mirror.
pub fn verify_and_install(
    archive: &str,
    expected_sha256: &str,
    member: &str,
    target: &str,
    unload: &dyn Fn(),
    progress: &dyn Fn(Phase, u64, u64),
    cancelled: &dyn Fn() -> bool,
) -> Result<Installed, InstallError> {
    let actual = sha256_file(archive, progress, cancelled).inspect_err(|_| {
        remove_quietly(archive);
    })?;
    if !actual.eq_ignore_ascii_case(expected_sha256.trim()) {
        // Deliberately no "install anyway" path. A wasted 69 MB download is an
        // annoyance; a silently corrupted dictionary handed to the analyzer is
        // not, and neither is one an attacker chose.
        remove_quietly(archive);
        return Err(InstallError::Failed(format!(
            "checksum mismatch: expected {expected_sha256}, got {actual}"
        )));
    }

    // Stage beside the target so the rename is on one volume and therefore
    // atomic. A temp directory could be on another drive, where the "rename"
    // becomes a copy and stops being atomic.
    let staged = staging_path(target);
    let extracted =
        extract_member(archive, member, &staged, progress, cancelled).inspect_err(|_| {
            // Both go, on cancel as much as on failure: the staged file is a
            // partial dictionary and the archive would otherwise sit there as
            // the abandoned download the startup sweeper exists to catch.
            remove_quietly(&staged.to_string_lossy());
            remove_quietly(archive);
        })?;

    // Past this line cancelling is refused, because the old dictionary is about
    // to be unloaded and stopping between that and the rename would leave the
    // analyzer closed over nothing.
    progress(Phase::Swapping, 0, 0);
    swap(&staged, target, unload)?;
    remove_quietly(archive);
    Ok(Installed { bytes: extracted })
}

/// Put the staged file in place, closing the loaded dictionary first.
///
/// The ordering used to be split across the FFI boundary, where a comment
/// claimed "the caller unloads the dictionary before this point" and **the
/// caller could not** — the analyzer's state is behind its own mutex.
///
/// Renaming over the mapped file happens to succeed on current Windows, so this
/// is not repairing a reproduced failure; it removes the dependency on that,
/// and closes the old mapping, which nothing did until the host asked for a
/// separate reload. `renaming_over_a_mapped_dictionary_is_permitted_here`
/// pins the OS behaviour so a toolchain change says so.
///
/// `unload` is injected so the ordering is testable without a 207 MB dictionary.
pub fn swap(staged: &Path, target: &str, unload: &dyn Fn()) -> Result<(), String> {
    unload();
    fs::rename(staged, target).map_err(|e| {
        remove_quietly(&staged.to_string_lossy());
        format!("could not move the dictionary into place: {e}")
    })
}

fn sha256_file(
    path: &str,
    progress: &dyn Fn(Phase, u64, u64),
    cancelled: &dyn Fn() -> bool,
) -> Result<String, InstallError> {
    let file = File::open(path).map_err(|e| format!("cannot read the download: {e}"))?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("cannot read the download: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        done += read as u64;
        progress(Phase::Verifying, done, total);
        // Checked per chunk rather than per phase: hashing 121 MB takes long
        // enough that a cancel honoured only at the end is a cancel that does
        // nothing a user can perceive.
        if cancelled() {
            return Err(InstallError::Cancelled);
        }
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn extract_member(
    archive: &str,
    member: &str,
    destination: &Path,
    progress: &dyn Fn(Phase, u64, u64),
    cancelled: &dyn Fn() -> bool,
) -> Result<u64, InstallError> {
    let file = File::open(archive).map_err(|e| format!("cannot open the archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|e| format!("the download is not a valid archive: {e}"))?;
    let mut entry = zip
        .by_name(member)
        .map_err(|_| format!("the archive does not contain {member}"))?;
    let total = entry.size();

    let mut out = BufWriter::new(
        File::create(destination).map_err(|e| format!("cannot write the dictionary: {e}"))?,
    );
    // Copied a chunk at a time rather than with `io::copy`, which reports
    // nothing until it returns. The 207 MB still never lands in memory at once,
    // and this is the longest phase of the install, so it is the one that most
    // needs something on screen.
    let mut buffer = vec![0u8; CHUNK];
    let mut done = 0u64;
    loop {
        let read = entry
            .read(&mut buffer)
            .map_err(|e| format!("cannot read the archive: {e}"))?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read])
            .map_err(|e| format!("cannot write the dictionary: {e}"))?;
        done += read as u64;
        progress(Phase::Extracting, done, total);
        if cancelled() {
            return Err(InstallError::Cancelled);
        }
    }
    out.flush().map_err(|e| format!("cannot write the dictionary: {e}"))?;
    Ok(done)
}

fn staging_path(target: &str) -> PathBuf {
    let mut path = PathBuf::from(target);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "dictionary".into());
    path.set_file_name(format!("{name}.part"));
    path
}

/// Best effort. Failing to tidy up is never worth reporting over the error that
/// caused it, and a leftover `.part` is swept on the next startup anyway.
fn remove_quietly(path: &str) {
    let _ = fs::remove_file(path);
}

/// Bytes free on the volume holding `directory`, or None if it cannot be asked.
///
/// Checked **before** downloading. Extraction needs ~207 MB on top of the 69 MB
/// archive and both exist at once, so a disk with 100 MB free would otherwise
/// fail only after spending the user's bandwidth — the one failure that wastes
/// something unrecoverable.
///
/// Declared directly rather than pulling in a crate: this is one call, and the
/// alternative is several hundred KB of dependency in a DLL we ship.
#[cfg(windows)]
pub fn free_space(directory: &str) -> Option<u64> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            directory_name: *const u16,
            free_bytes_available_to_caller: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }

    let wide: Vec<u16> = OsStr::new(directory).encode_wide().chain(Some(0)).collect();
    let mut available: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the three outputs
    // are owned locals.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) };
    // Report what this *caller* may use, not the volume total: a disk quota can
    // make those differ, and the smaller one is the one a write actually hits.
    if ok == 0 { None } else { Some(available) }
}

#[cfg(not(windows))]
pub fn free_space(_directory: &str) -> Option<u64> {
    None
}

/// Delete stray `.part` files left by a download that never finished.
///
/// Called at startup. Without it, a kill mid-download leaves ~69 MB stranded on
/// a disk the user may already be short of — us being the cause of the problem
/// we are otherwise careful to report.
pub fn sweep_partials(directory: &str) -> u64 {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "part") && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::Write;

    /// Nothing to unload: the first install has no dictionary open.
    fn no_unload() {}

    /// Most tests are about what lands on disk, not about the progress feed.
    fn no_progress(_: Phase, _: u64, _: u64) {}

    /// Most tests never cancel; the ones that do pass their own probe.
    fn never_cancelled() -> bool {
        false
    }

    /// What sudachi.rs holds on a loaded dictionary — a memory map of the file.
    fn map_file(path: &Path) -> memmap2::Mmap {
        let file = File::open(path).expect("open for mapping");
        // SAFETY: the test owns the file and nothing else writes it while mapped.
        unsafe { memmap2::Mmap::map(&file).expect("map the dictionary") }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kashiyomi-install-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    /// A real zip, built here rather than committed: a fixture archive would be
    /// a binary blob nobody could review.
    fn write_archive(path: &Path, member: &str, contents: &[u8]) {
        let file = File::create(path).expect("create archive");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(member, zip::write::SimpleFileOptions::default())
            .expect("start entry");
        zip.write_all(contents).expect("write entry");
        zip.finish().expect("finish archive");
    }

    #[test]
    fn installs_a_verified_archive() {
        let dir = temp_dir("ok");
        let archive = dir.join("d.whl");
        let target = dir.join("system_core.dic");
        write_archive(&archive, "pkg/resources/system.dic", b"dictionary bytes");
        let hash = sha256_file(&archive.to_string_lossy(), &no_progress, &never_cancelled).expect("hash");

        let installed = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &no_unload,
            &no_progress,
            &never_cancelled,
        )
        .expect("install");

        assert_eq!(installed.bytes, 16);
        assert_eq!(fs::read(&target).expect("read target"), b"dictionary bytes");
        assert!(!archive.exists(), "the archive is removed once installed");
        assert!(!dir.join("system_core.dic.part").exists(), "no staging left behind");
    }

    /// The install reports where it is, in order, with byte counts that reach
    /// the total.
    ///
    /// Without this the feed compiles and reports nothing, which looks identical
    /// from the host: an install that never moves and an install that never
    /// reports both render as a frozen bar.
    #[test]
    fn an_install_reports_each_phase_as_it_goes() {
        let dir = temp_dir("progress");
        let archive = dir.join("d.whl");
        let target = dir.join("system_core.dic");
        // Larger than one CHUNK, so extraction reports more than a single step
        // and a per-chunk feed is distinguishable from a single final call.
        let payload = vec![b'x'; CHUNK * 2 + 7];
        write_archive(&archive, "pkg/resources/system.dic", &payload);
        let hash = sha256_file(&archive.to_string_lossy(), &no_progress, &never_cancelled).expect("hash");

        let seen: RefCell<Vec<(&'static str, u64, u64)>> = RefCell::new(Vec::new());
        verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &no_unload,
            &|phase, done, total| seen.borrow_mut().push((phase.as_str(), done, total)),
            &never_cancelled,
        )
        .expect("install");

        let seen = seen.borrow();
        let phases: Vec<&str> = {
            let mut order: Vec<&str> = Vec::new();
            for (phase, _, _) in seen.iter() {
                if order.last() != Some(phase) {
                    order.push(phase);
                }
            }
            order
        };
        assert_eq!(phases, vec!["verifying", "extracting", "swapping"]);

        let extract: Vec<_> = seen.iter().filter(|(p, _, _)| *p == "extracting").collect();
        assert!(extract.len() > 1, "extraction reports as it goes, not once at the end");
        let (_, last_done, last_total) = extract.last().expect("an extraction step");
        assert_eq!(*last_done, payload.len() as u64);
        assert_eq!(*last_total, payload.len() as u64, "total is the uncompressed size");

        // Monotonic, so a bar driven by this never goes backwards.
        let mut previous = 0;
        for (_, done, _) in extract.iter() {
            assert!(*done > previous, "progress must only move forwards");
            previous = *done;
        }
    }

    /// Cancelling mid-extract leaves the machine exactly as it was.
    ///
    /// The dangerous shape here is a cancel that stops the work but leaves a
    /// half-written `.part` beside the real dictionary, or an archive nothing
    /// collects. Both are checked, along with the working dictionary surviving.
    #[test]
    fn cancelling_during_extraction_installs_nothing_and_leaves_no_litter() {
        let dir = temp_dir("cancel");
        let archive = dir.join("d.whl");
        let target = dir.join("system_core.dic");
        fs::write(&target, b"the previous dictionary").expect("seed target");
        write_archive(&archive, "pkg/resources/system.dic", &vec![b'x'; CHUNK * 3]);
        let hash = sha256_file(&archive.to_string_lossy(), &no_progress, &never_cancelled)
            .expect("hash");

        // Cancel once extraction has actually started, so the flag is read on
        // the path that matters rather than short-circuiting before any work.
        let started_extracting = RefCell::new(false);
        let result = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &|| panic!("a cancelled install must never unload the dictionary"),
            &|phase, _, _| {
                if phase.as_str() == "extracting" {
                    *started_extracting.borrow_mut() = true;
                }
            },
            &|| *started_extracting.borrow(),
        );

        assert!(matches!(result, Err(InstallError::Cancelled)));
        assert_eq!(
            fs::read(&target).expect("read target"),
            b"the previous dictionary",
            "the working dictionary survives a cancelled install",
        );
        assert!(!dir.join("system_core.dic.part").exists(), "staging is cleaned up");
        assert!(!archive.exists(), "the archive is not left for the sweeper to find");
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing() {
        let dir = temp_dir("badhash");
        let archive = dir.join("d.whl");
        let target = dir.join("system_core.dic");
        fs::write(&target, b"the previous dictionary").expect("seed target");
        write_archive(&archive, "pkg/resources/system.dic", b"tampered");

        let result = verify_and_install(
            &archive.to_string_lossy(),
            &"a".repeat(64),
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &no_unload,
            &no_progress,
            &never_cancelled,
        );

        assert!(result.is_err(), "must refuse");
        assert_eq!(
            fs::read(&target).expect("read target"),
            b"the previous dictionary",
            "the working dictionary survives a rejected download",
        );
    }

    #[test]
    fn a_missing_member_leaves_the_old_dictionary_alone() {
        let dir = temp_dir("nomember");
        let archive = dir.join("d.whl");
        let target = dir.join("system_core.dic");
        fs::write(&target, b"the previous dictionary").expect("seed target");
        write_archive(&archive, "pkg/something-else", b"x");
        let hash = sha256_file(&archive.to_string_lossy(), &no_progress, &never_cancelled).expect("hash");

        let result = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &no_unload,
            &no_progress,
            &never_cancelled,
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&target).expect("read target"), b"the previous dictionary");
        assert!(!dir.join("system_core.dic.part").exists(), "staging is cleaned up");
    }

    /// The regression that made **Update** fail while **Switch** worked.
    ///
    /// An update writes the same filename the analyzer already has mapped, so
    /// it is the only case where the rename meets a mapped file. It surfaced as
    /// "could not unpack the download" after a download that verified.
    #[test]
    fn an_update_replaces_a_dictionary_that_is_currently_mapped() {
        let dir = temp_dir("update-mapped");
        let archive = dir.join("d.whl.part");
        let target = dir.join("system_core.dic");
        fs::write(&target, b"the previous dictionary").expect("seed target");
        write_archive(&archive, "pkg/resources/system.dic", b"the new dictionary");
        let hash = sha256_file(&archive.to_string_lossy(), &no_progress, &never_cancelled).expect("hash");

        let mapped = RefCell::new(Some(map_file(&target)));

        let installed = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
            &|| {
                mapped.borrow_mut().take();
            },
            &no_progress,
            &never_cancelled,
        )
        .expect("an update over a mapped dictionary must succeed");

        assert_eq!(installed.bytes, 18);
        assert_eq!(fs::read(&target).expect("read target"), b"the new dictionary");
        assert!(!archive.exists(), "the archive is removed once installed");
    }

    /// What the OS actually does, measured rather than assumed.
    ///
    /// This was written expecting the rename to **fail** while the target is
    /// mapped — the belief that "Update is broken and Switch works". It does
    /// not fail: Rust's `rename` on current Windows replaces a file that still
    /// has a mapping, so the old dictionary is unlinked and the live mapping
    /// keeps serving the old bytes until it is dropped.
    ///
    /// Kept as a test because it is the fact the ordering is designed around,
    /// and because if a future toolchain or filesystem takes the older
    /// `MoveFileEx` path instead, this starts failing and says so directly.
    #[cfg(windows)]
    #[test]
    fn renaming_over_a_mapped_dictionary_is_permitted_here() {
        let dir = temp_dir("rename-while-mapped");
        let target = dir.join("system_core.dic");
        let staged = dir.join("system_core.dic.part");
        fs::write(&target, b"the previous dictionary").expect("seed target");
        fs::write(&staged, b"the new dictionary").expect("seed staged");

        let mapped = map_file(&target);

        assert!(
            fs::rename(&staged, &target).is_ok(),
            "a mapped target does not block the rename on this platform",
        );
        assert_eq!(fs::read(&target).expect("read target"), b"the new dictionary");
        assert_eq!(
            mapped.as_ref(),
            b"the previous dictionary",
            "the live mapping still serves the unlinked bytes",
        );
    }

    /// The ordering contract, independent of what any OS permits.
    ///
    /// The unload has to happen **before** the rename and exactly once. Leaving
    /// that to the caller is what went wrong originally: the analyzer's state
    /// is behind its own mutex, so the host could not unload even though a
    /// comment here claimed it had.
    #[test]
    fn the_dictionary_is_closed_before_the_file_is_replaced() {
        let dir = temp_dir("order");
        let target = dir.join("system_core.dic");
        let staged = dir.join("system_core.dic.part");
        fs::write(&target, b"old").expect("seed target");
        fs::write(&staged, b"new").expect("seed staged");

        let unloads = RefCell::new(0u32);
        let seen_target_when_unloaded = RefCell::new(Vec::new());

        swap(&staged, &target.to_string_lossy(), &|| {
            *unloads.borrow_mut() += 1;
            seen_target_when_unloaded
                .borrow_mut()
                .extend_from_slice(&fs::read(&target).expect("read during unload"));
        })
        .expect("swap");

        assert_eq!(*unloads.borrow(), 1, "unloaded exactly once");
        assert_eq!(
            &*seen_target_when_unloaded.borrow(),
            b"old",
            "the unload ran while the old dictionary was still the file on disk",
        );
        assert_eq!(fs::read(&target).expect("read target"), b"new");
    }

    #[test]
    fn stray_partials_are_swept() {
        let dir = temp_dir("sweep");
        fs::write(dir.join("system_core.dic.part"), b"abandoned").expect("write part");
        fs::write(dir.join("system_core.dic"), b"real").expect("write real");
        assert_eq!(sweep_partials(&dir.to_string_lossy()), 1);
        assert!(dir.join("system_core.dic").exists(), "the real dictionary is untouched");
    }
}
