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
use std::io::{self, BufReader, BufWriter, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Read in chunks rather than to a `Vec`: the archive is ~69 MB and the member
/// inside it is ~207 MB, and neither has any business being resident.
const CHUNK: usize = 1 << 20;

pub struct Installed {
    pub bytes: u64,
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
) -> Result<Installed, String> {
    let actual = sha256_file(archive)?;
    if !actual.eq_ignore_ascii_case(expected_sha256.trim()) {
        // Deliberately no "install anyway" path. A wasted 69 MB download is an
        // annoyance; a silently corrupted dictionary handed to the analyzer is
        // not, and neither is one an attacker chose.
        remove_quietly(archive);
        return Err(format!(
            "checksum mismatch: expected {expected_sha256}, got {actual}"
        ));
    }

    // Stage beside the target so the rename is on one volume and therefore
    // atomic. A temp directory could be on another drive, where the "rename"
    // becomes a copy and stops being atomic.
    let staged = staging_path(target);
    let extracted = extract_member(archive, member, &staged).inspect_err(|_| {
        remove_quietly(&staged.to_string_lossy());
    })?;

    // The caller unloads the dictionary before this point; on Windows the old
    // file cannot be replaced while it is still open.
    fs::rename(&staged, target).map_err(|e| {
        remove_quietly(&staged.to_string_lossy());
        format!("could not move the dictionary into place: {e}")
    })?;
    remove_quietly(archive);
    Ok(Installed { bytes: extracted })
}

fn sha256_file(path: &str) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("cannot read the download: {e}"))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("cannot read the download: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn extract_member(archive: &str, member: &str, destination: &Path) -> Result<u64, String> {
    let file = File::open(archive).map_err(|e| format!("cannot open the archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|e| format!("the download is not a valid archive: {e}"))?;
    let mut entry = zip
        .by_name(member)
        .map_err(|_| format!("the archive does not contain {member}"))?;

    let mut out = BufWriter::new(
        File::create(destination).map_err(|e| format!("cannot write the dictionary: {e}"))?,
    );
    // `io::copy` streams; the 207 MB never lands in memory at once.
    io::copy(&mut entry, &mut out).map_err(|e| format!("cannot write the dictionary: {e}"))
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
    use std::io::Write;

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
        let hash = sha256_file(&archive.to_string_lossy()).expect("hash");

        let installed = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
        )
        .expect("install");

        assert_eq!(installed.bytes, 16);
        assert_eq!(fs::read(&target).expect("read target"), b"dictionary bytes");
        assert!(!archive.exists(), "the archive is removed once installed");
        assert!(!dir.join("system_core.dic.part").exists(), "no staging left behind");
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
        let hash = sha256_file(&archive.to_string_lossy()).expect("hash");

        let result = verify_and_install(
            &archive.to_string_lossy(),
            &hash,
            "pkg/resources/system.dic",
            &target.to_string_lossy(),
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&target).expect("read target"), b"the previous dictionary");
        assert!(!dir.join("system_core.dic.part").exists(), "staging is cleaned up");
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
