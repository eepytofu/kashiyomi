//! The reviewed dictionary release manifest embedded in the DLL.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    Core,
    Full,
}

impl Edition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::Full => "full",
        }
    }

    pub fn other(self) -> Self {
        match self {
            Self::Core => Self::Full,
            Self::Full => Self::Core,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSource {
    pub url: String,
    pub archive_bytes: u64,
    pub archive_sha256: String,
    pub member: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub dictionary_bytes: u64,
    pub dictionary_sha256: String,
    pub sources: Vec<ArchiveSource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    schema_version: u32,
    editions: BTreeMap<Edition, Release>,
}

fn manifest() -> &'static ReleaseManifest {
    static MANIFEST: OnceLock<ReleaseManifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        let parsed: ReleaseManifest =
            serde_json::from_str(include_str!("../../dictionary-releases.json"))
                .expect("embedded dictionary release manifest must be valid JSON");
        validate(&parsed).expect("embedded dictionary release manifest must be valid");
        parsed
    })
}

pub fn release(edition: Edition) -> &'static Release {
    manifest()
        .editions
        .get(&edition)
        .expect("embedded manifest must contain both dictionary editions")
}

fn validate(manifest: &ReleaseManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("unsupported release manifest schema".into());
    }
    for edition in [Edition::Core, Edition::Full] {
        let release = manifest
            .editions
            .get(&edition)
            .ok_or_else(|| format!("missing {} release", edition.as_str()))?;
        if release.version.is_empty()
            || release.dictionary_bytes == 0
            || !is_sha256(&release.dictionary_sha256)
            || release.sources.is_empty()
        {
            return Err(format!("invalid {} release", edition.as_str()));
        }
        for source in &release.sources {
            if !source.url.starts_with("https://")
                || source.url.contains('@')
                || source.archive_bytes == 0
                || !is_sha256(&source.archive_sha256)
                || source.member.is_empty()
                || source.member.starts_with('/')
                || source.member.contains("..")
            {
                return Err(format!("invalid {} source", edition.as_str()));
            }
        }
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_has_reviewed_sources_for_both_editions() {
        for edition in [Edition::Core, Edition::Full] {
            let pinned = release(edition);
            assert_eq!(pinned.version, "20260723");
            assert!(pinned.dictionary_bytes > 200_000_000);
            assert!(pinned
                .sources
                .iter()
                .all(|source| source.url.starts_with("https://")));
        }
        assert!(release(Edition::Core).sources[0]
            .url
            .contains("cloudfront.net"));
        assert!(release(Edition::Full).sources[0]
            .url
            .contains("cloudfront.net"));
    }
}
