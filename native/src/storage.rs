//! Dictionary files and the native-owned durable inventory.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::releases::{release, Edition};

const CHUNK: usize = 1 << 20;
const MANIFEST_FILE: &str = "dictionary-state.json";
const MANIFEST_TEMP: &str = "kashiyomi-manifest-new";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub version: Option<String>,
    pub file: String,
    pub dictionary_bytes: u64,
    pub dictionary_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskManifest {
    pub schema_version: u32,
    pub active: Option<Edition>,
    pub installed: BTreeMap<Edition, InstalledRecord>,
}

impl Default for DiskManifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active: None,
            installed: BTreeMap::new(),
        }
    }
}

#[derive(Debug)]
pub enum StorageError {
    Cancelled,
    Failed(String),
}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

pub fn manifest_path(directory: &Path) -> PathBuf {
    directory.join(MANIFEST_FILE)
}

pub fn dictionary_path(directory: &Path, record: &InstalledRecord) -> Result<PathBuf, String> {
    if !safe_file_name(&record.file) {
        return Err("dictionary manifest contains an unsafe filename".into());
    }
    Ok(directory.join(&record.file))
}

pub fn final_file_name(edition: Edition, version: &str, sha256: &str) -> String {
    let safe_version: String = version
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    format!(
        "kashiyomi-{}-{}-{}.dic",
        edition.as_str(),
        if safe_version.is_empty() {
            "legacy"
        } else {
            &safe_version
        },
        &sha256[..8]
    )
}

pub fn stage_path(directory: &Path, edition: Edition, operation_id: u64, suffix: &str) -> PathBuf {
    directory.join(format!(
        "kashiyomi-{}-{operation_id}.{suffix}",
        edition.as_str()
    ))
}

pub fn load_manifest(directory: &Path) -> Result<Option<DiskManifest>, String> {
    let path = manifest_path(directory);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|error| format!("read manifest: {error}"))?;
    let manifest: DiskManifest =
        serde_json::from_str(&raw).map_err(|error| format!("parse manifest: {error}"))?;
    if manifest.schema_version != 1 {
        return Err("unsupported dictionary manifest schema".into());
    }
    for record in manifest.installed.values() {
        if !safe_file_name(&record.file)
            || record.dictionary_bytes == 0
            || !is_sha256(&record.dictionary_sha256)
        {
            return Err("invalid dictionary manifest entry".into());
        }
    }
    Ok(Some(manifest))
}

pub fn save_manifest(directory: &Path, manifest: &DiskManifest) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("create dictionary directory: {error}"))?;
    let temp = directory.join(MANIFEST_TEMP);
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;
    {
        let mut file = File::create(&temp).map_err(|error| format!("create manifest: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("write manifest: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("write manifest: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("flush manifest: {error}"))?;
    }
    replace_file(&temp, &manifest_path(directory))
        .map_err(|error| format!("commit manifest: {error}"))
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn reconcile_missing(directory: &Path, manifest: &mut DiskManifest) -> bool {
    let before = manifest.installed.len();
    manifest
        .installed
        .retain(|_, record| dictionary_path(directory, record).is_ok_and(|path| path.is_file()));
    if manifest
        .active
        .is_some_and(|edition| !manifest.installed.contains_key(&edition))
    {
        manifest.active = None;
    }
    manifest.installed.len() != before
}

pub fn migrate_legacy(
    directory: &Path,
    preference: Edition,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<DiskManifest, String> {
    let mut manifest = DiskManifest::default();
    for edition in [Edition::Core, Edition::Full] {
        let legacy = directory.join(format!("system_{}.dic", edition.as_str()));
        if !legacy.is_file() {
            continue;
        }
        let bytes = legacy.metadata().map_err(|error| error.to_string())?.len();
        let hash =
            hash_file(&legacy, &AtomicBool::new(false), progress).map_err(|error| match error {
                StorageError::Cancelled => "legacy migration cancelled".into(),
                StorageError::Failed(message) => message,
            })?;
        let pinned = release(edition);
        let version = if bytes == pinned.dictionary_bytes
            && hash.eq_ignore_ascii_case(&pinned.dictionary_sha256)
        {
            Some(pinned.version.clone())
        } else {
            None
        };
        let file = final_file_name(edition, version.as_deref().unwrap_or("legacy"), &hash);
        let target = directory.join(&file);
        if target.exists() {
            let target_hash = hash_file(&target, &AtomicBool::new(false), &mut |_, _| {})
                .map_err(|_| "could not verify migrated dictionary".to_string())?;
            if !target_hash.eq_ignore_ascii_case(&hash) {
                return Err("migrated dictionary filename collision".into());
            }
            fs::remove_file(&legacy)
                .map_err(|error| format!("remove legacy duplicate: {error}"))?;
        } else {
            fs::rename(&legacy, &target)
                .map_err(|error| format!("migrate legacy dictionary: {error}"))?;
        }
        manifest.installed.insert(
            edition,
            InstalledRecord {
                version,
                file,
                dictionary_bytes: bytes,
                dictionary_sha256: hash,
            },
        );
    }
    manifest.active = if manifest.installed.contains_key(&preference) {
        Some(preference)
    } else if manifest.installed.contains_key(&Edition::Core) {
        Some(Edition::Core)
    } else if manifest.installed.contains_key(&Edition::Full) {
        Some(Edition::Full)
    } else {
        None
    };
    Ok(manifest)
}

pub fn cleanup_staging(directory: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let owned = name == MANIFEST_TEMP
            || (name.starts_with("kashiyomi-")
                && (name.ends_with(".download") || name.ends_with(".extracting")));
        if owned && entry.path().is_file() && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub fn hash_file(
    path: &Path,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<String, StorageError> {
    let file = File::open(path)?;
    let total = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let mut reader = BufReader::new(file);
    let mut buffer = vec![0; CHUNK];
    let mut hasher = Sha256::new();
    let mut done = 0;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(StorageError::Cancelled);
        }
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        done += read as u64;
        progress(done, total);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn extract_verified(
    archive: &Path,
    member: &str,
    destination: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), StorageError> {
    let file = File::open(archive)?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|error| StorageError::Failed(format!("invalid archive: {error}")))?;
    let mut entry = zip
        .by_name(member)
        .map_err(|_| StorageError::Failed("dictionary member missing".into()))?;
    if entry.size() != expected_bytes {
        return Err(StorageError::Failed("dictionary size mismatch".into()));
    }
    let mut writer = BufWriter::new(File::create(destination)?);
    let mut buffer = vec![0; CHUNK];
    let mut hasher = Sha256::new();
    let mut done = 0;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(StorageError::Cancelled);
        }
        let read = entry
            .read(&mut buffer)
            .map_err(|error| StorageError::Failed(format!("read archive: {error}")))?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        done += read as u64;
        progress(done, expected_bytes);
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    if done != expected_bytes {
        return Err(StorageError::Failed("dictionary size mismatch".into()));
    }
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(StorageError::Failed("dictionary hash mismatch".into()));
    }
    Ok(())
}

fn safe_file_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && name != "." && name != ".."
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Bytes available to this caller on the volume containing `directory`.
#[cfg(windows)]
pub fn free_space(directory: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let existing = nearest_existing(directory)?;
    let wide: Vec<u16> = existing.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    let mut total = 0;
    let mut total_free = 0;
    let ok =
        unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut total_free) };
    if ok == 0 {
        None
    } else {
        Some(available)
    }
}

#[cfg(not(windows))]
pub fn free_space(directory: &Path) -> Option<u64> {
    let _ = nearest_existing(directory);
    None
}

fn nearest_existing(directory: &Path) -> Option<PathBuf> {
    let mut path = directory.to_path_buf();
    loop {
        if path.exists() {
            return Some(path);
        }
        if !path.pop() {
            return None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("kashiyomi-storage-{name}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn manifest_round_trips_and_rejects_unsafe_filenames() {
        let dir = temp_dir("manifest");
        let mut manifest = DiskManifest::default();
        manifest.installed.insert(
            Edition::Core,
            InstalledRecord {
                version: Some("1".into()),
                file: "kashiyomi-core-1-aaaaaaaa.dic".into(),
                dictionary_bytes: 4,
                dictionary_sha256: "a".repeat(64),
            },
        );
        save_manifest(&dir, &manifest).unwrap();
        assert_eq!(load_manifest(&dir).unwrap().unwrap().installed.len(), 1);
        manifest.installed.get_mut(&Edition::Core).unwrap().file = "../escape".into();
        assert!(dictionary_path(&dir, manifest.installed.get(&Edition::Core).unwrap()).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cleanup_only_removes_owned_staging() {
        let dir = temp_dir("cleanup");
        for name in [
            "kashiyomi-core-1.download",
            "kashiyomi-full-1.extracting",
            "kashiyomi-manifest-new",
            "someone-else.part",
            "kashiyomi-core-1-aaaaaaaa.dic",
        ] {
            fs::write(dir.join(name), b"x").unwrap();
        }
        assert_eq!(cleanup_staging(&dir), 3);
        assert!(dir.join("someone-else.part").exists());
        assert!(dir.join("kashiyomi-core-1-aaaaaaaa.dic").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn extract_checks_member_size_and_hash() {
        let dir = temp_dir("extract");
        let archive = dir.join("archive.zip");
        let file = File::create(&archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("pkg/system.dic", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"dictionary").unwrap();
        writer.finish().unwrap();
        let hash = hex::encode(Sha256::digest(b"dictionary"));
        extract_verified(
            &archive,
            "pkg/system.dic",
            &dir.join("out"),
            10,
            &hash,
            &AtomicBool::new(false),
            &mut |_, _| {},
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("out")).unwrap(), b"dictionary");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn extraction_rejects_missing_corrupt_and_cancelled_members() {
        let dir = temp_dir("extract-failures");
        let archive = dir.join("archive.zip");
        let file = File::create(&archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("pkg/system.dic", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"dictionary").unwrap();
        writer.finish().unwrap();
        let missing = extract_verified(
            &archive,
            "wrong/member.dic",
            &dir.join("missing"),
            10,
            &"a".repeat(64),
            &AtomicBool::new(false),
            &mut |_, _| {},
        );
        assert!(
            matches!(missing, Err(StorageError::Failed(message)) if message.contains("member missing"))
        );
        let corrupt = extract_verified(
            &archive,
            "pkg/system.dic",
            &dir.join("corrupt"),
            10,
            &"a".repeat(64),
            &AtomicBool::new(false),
            &mut |_, _| {},
        );
        assert!(
            matches!(corrupt, Err(StorageError::Failed(message)) if message.contains("hash mismatch"))
        );
        let cancel = AtomicBool::new(true);
        let cancelled = extract_verified(
            &archive,
            "pkg/system.dic",
            &dir.join("cancelled"),
            10,
            &hex::encode(Sha256::digest(b"dictionary")),
            &cancel,
            &mut |_, _| {},
        );
        assert!(matches!(cancelled, Err(StorageError::Cancelled)));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recovery_reconciles_missing_entries_without_touching_unknown_finals() {
        let dir = temp_dir("reconcile");
        let unknown = dir.join("kashiyomi-core-future-deadbeef.dic");
        fs::write(&unknown, b"unknown but final").unwrap();
        let mut manifest = DiskManifest {
            active: Some(Edition::Core),
            ..DiskManifest::default()
        };
        manifest.installed.insert(
            Edition::Core,
            InstalledRecord {
                version: Some("missing".into()),
                file: "kashiyomi-core-missing-aaaaaaaa.dic".into(),
                dictionary_bytes: 10,
                dictionary_sha256: "a".repeat(64),
            },
        );
        assert!(reconcile_missing(&dir, &mut manifest));
        assert!(manifest.installed.is_empty());
        assert_eq!(manifest.active, None);
        assert!(unknown.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_migration_keeps_unknown_versions_usable_and_respects_preference() {
        let dir = temp_dir("legacy");
        fs::write(dir.join("system_core.dic"), b"old core").unwrap();
        fs::write(dir.join("system_full.dic"), b"old full").unwrap();
        let manifest = migrate_legacy(&dir, Edition::Full, &mut |_, _| {}).unwrap();
        assert_eq!(manifest.active, Some(Edition::Full));
        assert_eq!(manifest.installed.len(), 2);
        assert!(manifest
            .installed
            .values()
            .all(|record| record.version.is_none()));
        assert!(!dir.join("system_core.dic").exists());
        assert!(manifest
            .installed
            .values()
            .all(|record| dir.join(&record.file).is_file()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn manifest_commit_failure_does_not_replace_the_previous_inventory() {
        let dir = temp_dir("manifest-failure");
        let original = DiskManifest::default();
        save_manifest(&dir, &original).unwrap();
        fs::create_dir(dir.join(MANIFEST_TEMP)).unwrap();
        let mut next = original.clone();
        next.active = Some(Edition::Core);
        assert!(save_manifest(&dir, &next).is_err());
        assert_eq!(load_manifest(&dir).unwrap().unwrap().active, None);
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn windows_free_space_uses_the_nearest_existing_volume_path() {
        let dir = temp_dir("free-space");
        assert!(free_space(&dir.join("not-created")).is_some_and(|bytes| bytes > 0));
        let _ = fs::remove_dir_all(dir);
    }
}
