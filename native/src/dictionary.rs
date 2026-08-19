//! Native-owned dictionary inventory and operations.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use serde::Serialize;

use crate::analyzer;
use crate::download::{self, DownloadError};
use crate::releases::{release, Edition};
use crate::storage::{self, DiskManifest, InstalledRecord, StorageError};

const SAFETY_MARGIN: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Recover,
    Install,
    Activate,
    Remove,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationState {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationPhase {
    Starting,
    Connecting,
    Downloading,
    Extracting,
    Validating,
    Activating,
    Cleaning,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NotConfigured,
    Busy,
    NotInstalled,
    DiskSpace,
    Offline,
    Http,
    ArchiveSize,
    ArchiveHash,
    ArchiveInvalid,
    DictionarySize,
    DictionaryHash,
    DictionaryMissing,
    LoadFailed,
    DeleteFailed,
    Manifest,
    Io,
    #[cfg(not(windows))]
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot {
    pub id: u64,
    pub kind: OperationKind,
    pub edition: Option<Edition>,
    pub state: OperationState,
    pub phase: OperationPhase,
    pub done: u64,
    pub total: u64,
    pub cancellable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ErrorCode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledView {
    pub edition: Edition,
    pub version: Option<String>,
    pub dictionary_bytes: u64,
    pub active: bool,
    pub pinned_version: String,
    pub update_available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub configured: bool,
    pub installed: Vec<InstalledView>,
    pub active: Option<Edition>,
    pub free_bytes: Option<u64>,
    pub operation: Option<OperationSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Configuration {
    directory: PathBuf,
    resource_dir: PathBuf,
}

struct Manager {
    configuration: Option<Configuration>,
    manifest: DiskManifest,
    operation: Option<OperationSnapshot>,
    cancel: Option<Arc<AtomicBool>>,
    next_id: u64,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            configuration: None,
            manifest: DiskManifest::default(),
            operation: None,
            cancel: None,
            next_id: 1,
        }
    }
}

static MANAGER: LazyLock<Mutex<Manager>> = LazyLock::new(|| Mutex::new(Manager::default()));

pub fn configure(
    data_dir: String,
    resource_dir: String,
    legacy_preference: Edition,
) -> Result<Snapshot, ErrorCode> {
    let configuration = Configuration {
        directory: PathBuf::from(data_dir),
        resource_dir: PathBuf::from(resource_dir),
    };
    if !configuration.directory.is_absolute() || !configuration.resource_dir.is_absolute() {
        return Err(ErrorCode::NotConfigured);
    }
    {
        let manager = MANAGER.lock().expect("dictionary manager lock");
        if manager.configuration.as_ref() == Some(&configuration) {
            return Ok(snapshot_locked(&manager));
        }
        if is_running(manager.operation.as_ref()) {
            return Err(ErrorCode::Busy);
        }
        if manager.configuration.is_some() {
            return Err(ErrorCode::NotConfigured);
        }
    }
    fs::create_dir_all(&configuration.directory).map_err(|_| ErrorCode::Io)?;
    let id = begin_operation(configuration.clone(), OperationKind::Recover, None)?;
    analyzer::mark_loading();
    if std::thread::Builder::new()
        .name("kashiyomi-dictionary-recovery".into())
        .spawn(move || recover_worker(id, configuration, legacy_preference))
        .is_err()
    {
        finish(id, OperationState::Failed, Some(ErrorCode::Io));
        return Err(ErrorCode::Io);
    }
    Ok(status())
}

pub fn status() -> Snapshot {
    snapshot_locked(&MANAGER.lock().expect("dictionary manager lock"))
}

pub fn install(edition: Edition) -> Result<u64, ErrorCode> {
    let (id, configuration, cancel) = start(edition, OperationKind::Install)?;
    if std::thread::Builder::new()
        .name(format!("kashiyomi-install-{}", edition.as_str()))
        .spawn(move || install_worker(id, configuration, edition, cancel))
        .is_err()
    {
        finish(id, OperationState::Failed, Some(ErrorCode::Io));
        return Err(ErrorCode::Io);
    }
    Ok(id)
}

pub fn activate(edition: Edition) -> Result<u64, ErrorCode> {
    let (id, configuration, _) = start(edition, OperationKind::Activate)?;
    if std::thread::Builder::new()
        .name(format!("kashiyomi-activate-{}", edition.as_str()))
        .spawn(move || activate_worker(id, configuration, edition))
        .is_err()
    {
        finish(id, OperationState::Failed, Some(ErrorCode::Io));
        return Err(ErrorCode::Io);
    }
    Ok(id)
}

pub fn remove(edition: Edition) -> Result<u64, ErrorCode> {
    let (id, configuration, _) = start(edition, OperationKind::Remove)?;
    if std::thread::Builder::new()
        .name(format!("kashiyomi-remove-{}", edition.as_str()))
        .spawn(move || remove_worker(id, configuration, edition))
        .is_err()
    {
        finish(id, OperationState::Failed, Some(ErrorCode::Io));
        return Err(ErrorCode::Io);
    }
    Ok(id)
}

pub fn cancel(operation_id: u64) -> bool {
    let manager = MANAGER.lock().expect("dictionary manager lock");
    let accepted = manager.operation.as_ref().is_some_and(|operation| {
        operation.id == operation_id
            && matches!(operation.state, OperationState::Running)
            && operation.cancellable
    });
    if accepted {
        if let Some(cancel) = &manager.cancel {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    accepted
}

fn begin_operation(
    configuration: Configuration,
    kind: OperationKind,
    edition: Option<Edition>,
) -> Result<u64, ErrorCode> {
    let mut manager = MANAGER.lock().expect("dictionary manager lock");
    if is_running(manager.operation.as_ref()) {
        return Err(ErrorCode::Busy);
    }
    if manager.configuration.is_none() {
        manager.configuration = Some(configuration);
    }
    let id = manager.next_id;
    manager.next_id += 1;
    manager.cancel = Some(Arc::new(AtomicBool::new(false)));
    manager.operation = Some(OperationSnapshot {
        id,
        kind,
        edition,
        state: OperationState::Running,
        phase: OperationPhase::Starting,
        done: 0,
        total: 0,
        cancellable: false,
        error_code: None,
    });
    Ok(id)
}

fn start(
    edition: Edition,
    kind: OperationKind,
) -> Result<(u64, Configuration, Arc<AtomicBool>), ErrorCode> {
    let configuration = {
        let manager = MANAGER.lock().expect("dictionary manager lock");
        manager
            .configuration
            .clone()
            .ok_or(ErrorCode::NotConfigured)?
    };
    if matches!(kind, OperationKind::Activate | OperationKind::Remove) {
        let manager = MANAGER.lock().expect("dictionary manager lock");
        if !manager.manifest.installed.contains_key(&edition) {
            return Err(ErrorCode::NotInstalled);
        }
    }
    let id = begin_operation(configuration.clone(), kind, Some(edition))?;
    let cancel = MANAGER
        .lock()
        .expect("dictionary manager lock")
        .cancel
        .as_ref()
        .expect("new operation cancellation token")
        .clone();
    Ok((id, configuration, cancel))
}

fn snapshot_locked(manager: &Manager) -> Snapshot {
    let active = manager.manifest.active;
    let installed = manager
        .manifest
        .installed
        .iter()
        .map(|(edition, record)| {
            let pinned = release(*edition);
            InstalledView {
                edition: *edition,
                version: record.version.clone(),
                dictionary_bytes: record.dictionary_bytes,
                active: active == Some(*edition),
                pinned_version: pinned.version.clone(),
                update_available: record.version.as_deref() != Some(pinned.version.as_str()),
            }
        })
        .collect();
    Snapshot {
        configured: manager.configuration.is_some(),
        installed,
        active,
        free_bytes: manager
            .configuration
            .as_ref()
            .and_then(|configuration| storage::free_space(&configuration.directory)),
        operation: manager.operation.clone(),
    }
}

fn progress(id: u64, phase: OperationPhase, done: u64, total: u64, cancellable: bool) {
    let mut manager = MANAGER.lock().expect("dictionary manager lock");
    if let Some(operation) = manager.operation.as_mut() {
        if operation.id == id && matches!(operation.state, OperationState::Running) {
            operation.phase = phase;
            operation.done = done;
            operation.total = total;
            operation.cancellable = cancellable;
        }
    }
}

fn finish(id: u64, state: OperationState, error_code: Option<ErrorCode>) {
    let mut manager = MANAGER.lock().expect("dictionary manager lock");
    if let Some(operation) = manager.operation.as_mut() {
        if operation.id == id {
            operation.state = state;
            operation.cancellable = false;
            operation.error_code = error_code;
        }
    }
    manager.cancel = None;
}

fn replace_manifest(manifest: DiskManifest) {
    MANAGER.lock().expect("dictionary manager lock").manifest = manifest;
}

fn current_manifest() -> DiskManifest {
    MANAGER
        .lock()
        .expect("dictionary manager lock")
        .manifest
        .clone()
}

fn recover_worker(id: u64, configuration: Configuration, preference: Edition) {
    progress(id, OperationPhase::Cleaning, 0, 0, false);
    storage::cleanup_staging(&configuration.directory);
    let mut manifest = match storage::load_manifest(&configuration.directory) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            progress(id, OperationPhase::Validating, 0, 0, false);
            match storage::migrate_legacy(
                &configuration.directory,
                preference,
                &mut |done, total| progress(id, OperationPhase::Validating, done, total, false),
            ) {
                Ok(manifest) => manifest,
                Err(_) => return fail_recovery(id, ErrorCode::Io),
            }
        }
        Err(_) => return fail_recovery(id, ErrorCode::Manifest),
    };
    let changed = storage::reconcile_missing(&configuration.directory, &mut manifest);
    let mut order = Vec::new();
    if let Some(active) = manifest.active {
        order.push(active);
    }
    for edition in [preference, Edition::Core, Edition::Full] {
        if manifest.installed.contains_key(&edition) && !order.contains(&edition) {
            order.push(edition);
        }
    }
    let mut loaded = None;
    for edition in order {
        let Some(record) = manifest.installed.get(&edition) else {
            continue;
        };
        let Ok(path) = storage::dictionary_path(&configuration.directory, record) else {
            continue;
        };
        progress(
            id,
            OperationPhase::Validating,
            0,
            record.dictionary_bytes,
            false,
        );
        if let Ok(candidate) = analyzer::load_candidate(
            &path.to_string_lossy(),
            &configuration.resource_dir.to_string_lossy(),
        ) {
            loaded = Some((edition, candidate));
            break;
        }
    }
    match loaded {
        Some((edition, candidate)) => {
            manifest.active = Some(edition);
            if changed
                || storage::load_manifest(&configuration.directory)
                    .ok()
                    .flatten()
                    .is_none()
            {
                if storage::save_manifest(&configuration.directory, &manifest).is_err() {
                    return fail_recovery(id, ErrorCode::Manifest);
                }
            } else if storage::save_manifest(&configuration.directory, &manifest).is_err() {
                return fail_recovery(id, ErrorCode::Manifest);
            }
            analyzer::activate(candidate);
            replace_manifest(manifest.clone());
            finish(id, OperationState::Succeeded, None);
        }
        None if manifest.installed.is_empty() => {
            manifest.active = None;
            if storage::save_manifest(&configuration.directory, &manifest).is_err() {
                return fail_recovery(id, ErrorCode::Manifest);
            }
            analyzer::deactivate();
            replace_manifest(manifest);
            finish(id, OperationState::Succeeded, None);
        }
        None => {
            manifest.active = None;
            let _ = storage::save_manifest(&configuration.directory, &manifest);
            replace_manifest(manifest);
            analyzer::mark_failed("no installed dictionary could be loaded".into());
            finish(id, OperationState::Failed, Some(ErrorCode::LoadFailed));
        }
    }
}

fn fail_recovery(id: u64, code: ErrorCode) {
    analyzer::mark_failed("dictionary recovery failed".into());
    finish(id, OperationState::Failed, Some(code));
}

fn install_worker(
    id: u64,
    configuration: Configuration,
    edition: Edition,
    cancelled: Arc<AtomicBool>,
) {
    let pinned = release(edition).clone();
    let required = pinned
        .sources
        .iter()
        .map(|source| source.archive_bytes)
        .max()
        .unwrap_or(0)
        + pinned.dictionary_bytes
        + SAFETY_MARGIN;
    if storage::free_space(&configuration.directory).is_some_and(|free| free < required) {
        return finish(id, OperationState::Failed, Some(ErrorCode::DiskSpace));
    }
    let archive = storage::stage_path(&configuration.directory, edition, id, "download");
    let extracted = storage::stage_path(&configuration.directory, edition, id, "extracting");
    let downloaded_source = download_first(&pinned.sources, |source| {
        let _ = fs::remove_file(&archive);
        progress(
            id,
            OperationPhase::Connecting,
            0,
            source.archive_bytes,
            true,
        );
        download::download_to(source, &archive, &cancelled, &mut |done, total| {
            progress(id, OperationPhase::Downloading, done, total, true)
        })
    });
    let source = match downloaded_source {
        Ok(source) => source,
        Err(DownloadError::Cancelled) => {
            let _ = fs::remove_file(&archive);
            return finish(id, OperationState::Cancelled, None);
        }
        Err(error) => {
            let _ = fs::remove_file(&archive);
            return finish(
                id,
                OperationState::Failed,
                Some(download_error_code(&error)),
            );
        }
    };
    progress(
        id,
        OperationPhase::Extracting,
        0,
        pinned.dictionary_bytes,
        true,
    );
    let extraction = storage::extract_verified(
        &archive,
        &source.member,
        &extracted,
        pinned.dictionary_bytes,
        &pinned.dictionary_sha256,
        &cancelled,
        &mut |done, total| progress(id, OperationPhase::Extracting, done, total, true),
    );
    if let Err(error) = extraction {
        let _ = fs::remove_file(&archive);
        let _ = fs::remove_file(&extracted);
        return match error {
            StorageError::Cancelled => finish(id, OperationState::Cancelled, None),
            StorageError::Failed(message) => finish(
                id,
                OperationState::Failed,
                Some(storage_error_code(&message)),
            ),
        };
    }
    let final_name = storage::final_file_name(edition, &pinned.version, &pinned.dictionary_sha256);
    let final_path = configuration.directory.join(&final_name);
    let created_final = if final_path.exists() {
        let size_matches = final_path
            .metadata()
            .is_ok_and(|metadata| metadata.len() == pinned.dictionary_bytes);
        let hash_matches = size_matches
            && storage::hash_file(&final_path, &AtomicBool::new(false), &mut |_, _| {})
                .is_ok_and(|hash| hash.eq_ignore_ascii_case(&pinned.dictionary_sha256));
        if hash_matches {
            let _ = fs::remove_file(&extracted);
            false
        } else {
            let referenced = current_manifest()
                .installed
                .values()
                .any(|record| record.file == final_name);
            if referenced
                || fs::remove_file(&final_path).is_err()
                || fs::rename(&extracted, &final_path).is_err()
            {
                let _ = fs::remove_file(&archive);
                let _ = fs::remove_file(&extracted);
                return finish(id, OperationState::Failed, Some(ErrorCode::DictionaryHash));
            }
            true
        }
    } else if fs::rename(&extracted, &final_path).is_ok() {
        true
    } else {
        let _ = fs::remove_file(&archive);
        let _ = fs::remove_file(&extracted);
        return finish(id, OperationState::Failed, Some(ErrorCode::Io));
    };
    progress(
        id,
        OperationPhase::Validating,
        0,
        pinned.dictionary_bytes,
        false,
    );
    let candidate = match analyzer::load_candidate(
        &final_path.to_string_lossy(),
        &configuration.resource_dir.to_string_lossy(),
    ) {
        Ok(candidate) => candidate,
        Err(_) => {
            if created_final {
                let _ = fs::remove_file(&final_path);
            }
            let _ = fs::remove_file(&archive);
            return finish(id, OperationState::Failed, Some(ErrorCode::LoadFailed));
        }
    };
    let mut next = current_manifest();
    let old = next.installed.insert(
        edition,
        InstalledRecord {
            version: Some(pinned.version.clone()),
            file: final_name,
            dictionary_bytes: pinned.dictionary_bytes,
            dictionary_sha256: pinned.dictionary_sha256.clone(),
        },
    );
    next.active = Some(edition);
    progress(id, OperationPhase::Activating, 0, 0, false);
    if storage::save_manifest(&configuration.directory, &next).is_err() {
        if created_final {
            let _ = fs::remove_file(&final_path);
        }
        let _ = fs::remove_file(&archive);
        return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
    }
    analyzer::activate(candidate);
    replace_manifest(next.clone());
    progress(id, OperationPhase::Cleaning, 0, 0, false);
    let _ = fs::remove_file(&archive);
    if let Some(old) = old {
        if old.file != next.installed[&edition].file {
            if let Ok(old_path) = storage::dictionary_path(&configuration.directory, &old) {
                let _ = fs::remove_file(old_path);
            }
        }
    }
    finish(id, OperationState::Succeeded, None);
}

fn activate_worker(id: u64, configuration: Configuration, edition: Edition) {
    let manifest = current_manifest();
    let Some(record) = manifest.installed.get(&edition) else {
        return finish(id, OperationState::Failed, Some(ErrorCode::NotInstalled));
    };
    let Ok(path) = storage::dictionary_path(&configuration.directory, record) else {
        return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
    };
    progress(
        id,
        OperationPhase::Validating,
        0,
        record.dictionary_bytes,
        false,
    );
    let candidate = match analyzer::load_candidate(
        &path.to_string_lossy(),
        &configuration.resource_dir.to_string_lossy(),
    ) {
        Ok(candidate) => candidate,
        Err(_) => return finish(id, OperationState::Failed, Some(ErrorCode::LoadFailed)),
    };
    let mut next = manifest;
    next.active = Some(edition);
    progress(id, OperationPhase::Activating, 0, 0, false);
    if storage::save_manifest(&configuration.directory, &next).is_err() {
        return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
    }
    analyzer::activate(candidate);
    replace_manifest(next);
    finish(id, OperationState::Succeeded, None);
}

fn remove_worker(id: u64, configuration: Configuration, edition: Edition) {
    let original = current_manifest();
    let Some(record) = original.installed.get(&edition).cloned() else {
        return finish(id, OperationState::Failed, Some(ErrorCode::NotInstalled));
    };
    let Ok(path) = storage::dictionary_path(&configuration.directory, &record) else {
        return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
    };
    progress(id, OperationPhase::Activating, 0, 0, false);
    if original.active == Some(edition) {
        if let Some(fallback_record) = original.installed.get(&edition.other()) {
            let Ok(fallback_path) =
                storage::dictionary_path(&configuration.directory, fallback_record)
            else {
                return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
            };
            let fallback = match analyzer::load_candidate(
                &fallback_path.to_string_lossy(),
                &configuration.resource_dir.to_string_lossy(),
            ) {
                Ok(candidate) => candidate,
                Err(_) => return finish(id, OperationState::Failed, Some(ErrorCode::LoadFailed)),
            };
            let mut switched = original.clone();
            switched.active = Some(edition.other());
            if storage::save_manifest(&configuration.directory, &switched).is_err() {
                return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
            }
            analyzer::activate(fallback);
            replace_manifest(switched);
        } else {
            let reload = analyzer::load_candidate(
                &path.to_string_lossy(),
                &configuration.resource_dir.to_string_lossy(),
            )
            .ok();
            let mut empty = original.clone();
            empty.active = None;
            empty.installed.remove(&edition);
            if storage::save_manifest(&configuration.directory, &empty).is_err() {
                return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
            }
            analyzer::deactivate();
            if fs::remove_file(&path).is_err() {
                if let Some(candidate) = reload {
                    analyzer::activate(candidate);
                }
                let _ = storage::save_manifest(&configuration.directory, &original);
                replace_manifest(original);
                return finish(id, OperationState::Failed, Some(ErrorCode::DeleteFailed));
            }
            replace_manifest(empty);
            return finish(id, OperationState::Succeeded, None);
        }
    }
    progress(
        id,
        OperationPhase::Cleaning,
        0,
        record.dictionary_bytes,
        false,
    );
    let rollback = current_manifest();
    let mut next = rollback.clone();
    next.installed.remove(&edition);
    if storage::save_manifest(&configuration.directory, &next).is_err() {
        return finish(id, OperationState::Failed, Some(ErrorCode::Manifest));
    }
    if fs::remove_file(&path).is_err() {
        let _ = storage::save_manifest(&configuration.directory, &rollback);
        replace_manifest(rollback);
        return finish(id, OperationState::Failed, Some(ErrorCode::DeleteFailed));
    }
    replace_manifest(next);
    finish(id, OperationState::Succeeded, None);
}

fn is_running(operation: Option<&OperationSnapshot>) -> bool {
    operation.is_some_and(|operation| matches!(operation.state, OperationState::Running))
}

fn download_error_code(error: &DownloadError) -> ErrorCode {
    match error {
        DownloadError::Cancelled => ErrorCode::Offline,
        DownloadError::Network(_) => ErrorCode::Offline,
        DownloadError::Http(_) => ErrorCode::Http,
        DownloadError::SizeMismatch => ErrorCode::ArchiveSize,
        DownloadError::HashMismatch => ErrorCode::ArchiveHash,
        DownloadError::Io(_) => ErrorCode::Io,
        #[cfg(not(windows))]
        DownloadError::Unsupported => ErrorCode::Unsupported,
    }
}

fn download_first(
    sources: &[crate::releases::ArchiveSource],
    mut attempt: impl FnMut(&crate::releases::ArchiveSource) -> Result<(), DownloadError>,
) -> Result<crate::releases::ArchiveSource, DownloadError> {
    let mut last = None;
    for source in sources {
        match attempt(source) {
            Ok(()) => return Ok(source.clone()),
            Err(DownloadError::Cancelled) => return Err(DownloadError::Cancelled),
            Err(error) => {
                eprintln!(
                    "[kashiyomi] dictionary source failed: {}",
                    error.technical_summary()
                );
                last = Some(error);
            }
        }
    }
    Err(last.unwrap_or_else(|| DownloadError::Network("no configured source".into())))
}

fn storage_error_code(message: &str) -> ErrorCode {
    if message.contains("member missing") {
        ErrorCode::DictionaryMissing
    } else if message.contains("dictionary size") {
        ErrorCode::DictionarySize
    } else if message.contains("dictionary hash") {
        ErrorCode::DictionaryHash
    } else if message.contains("archive") {
        ErrorCode::ArchiveInvalid
    } else {
        ErrorCode::Io
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_separates_installed_from_active_and_pin_age() {
        let mut manager = Manager::default();
        manager.manifest.installed.insert(
            Edition::Core,
            InstalledRecord {
                version: None,
                file: "kashiyomi-core-legacy-aaaaaaaa.dic".into(),
                dictionary_bytes: 1,
                dictionary_sha256: "a".repeat(64),
            },
        );
        manager.manifest.installed.insert(
            Edition::Full,
            InstalledRecord {
                version: Some(release(Edition::Full).version.clone()),
                file: "kashiyomi-full-current-bbbbbbbb.dic".into(),
                dictionary_bytes: 2,
                dictionary_sha256: "b".repeat(64),
            },
        );
        manager.manifest.active = Some(Edition::Full);
        let snapshot = snapshot_locked(&manager);
        assert_eq!(snapshot.installed.len(), 2);
        assert!(
            snapshot
                .installed
                .iter()
                .find(|item| item.edition == Edition::Core)
                .unwrap()
                .update_available
        );
        assert!(
            snapshot
                .installed
                .iter()
                .find(|item| item.edition == Edition::Full)
                .unwrap()
                .active
        );
    }

    #[test]
    fn cancel_requires_the_live_operation_id_and_phase_permission() {
        let mut manager = MANAGER.lock().unwrap();
        *manager = Manager::default();
        manager.operation = Some(OperationSnapshot {
            id: 42,
            kind: OperationKind::Install,
            edition: Some(Edition::Core),
            state: OperationState::Running,
            phase: OperationPhase::Downloading,
            done: 1,
            total: 2,
            cancellable: true,
            error_code: None,
        });
        manager.cancel = Some(Arc::new(AtomicBool::new(false)));
        drop(manager);
        assert!(!cancel(41));
        assert!(cancel(42));
    }

    #[test]
    fn source_fallback_stops_at_the_first_verified_artifact() {
        let sources = release(Edition::Core).sources.clone();
        let mut attempts = 0;
        let selected = download_first(&sources, |_| {
            attempts += 1;
            if attempts < 2 {
                Err(DownloadError::Network("offline".into()))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts, 2);
        assert_eq!(selected.url, sources[1].url);
    }

    #[test]
    fn cancellation_never_falls_through_to_another_source() {
        let sources = release(Edition::Core).sources.clone();
        let mut attempts = 0;
        let result = download_first(&sources, |_| {
            attempts += 1;
            Err(DownloadError::Cancelled)
        });
        assert!(matches!(result, Err(DownloadError::Cancelled)));
        assert_eq!(attempts, 1);
    }
}
