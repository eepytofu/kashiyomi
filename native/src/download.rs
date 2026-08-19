//! WinHTTP dictionary transport. The renderer never sees archive bytes.

#[cfg(windows)]
use std::fs::File;
#[cfg(windows)]
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::AtomicBool;
#[cfg(windows)]
use std::sync::atomic::Ordering;

#[cfg(windows)]
use sha2::{Digest, Sha256};

use crate::releases::ArchiveSource;

#[cfg(windows)]
const CHUNK: usize = 1 << 20;

#[derive(Debug)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum DownloadError {
    Cancelled,
    Network(String),
    Http(u32),
    SizeMismatch,
    HashMismatch,
    Io(String),
    #[cfg(not(windows))]
    Unsupported,
}

impl From<std::io::Error> for DownloadError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl DownloadError {
    pub fn technical_summary(&self) -> String {
        match self {
            Self::Cancelled => "cancelled".into(),
            Self::Network(message) => format!("network: {message}"),
            Self::Http(status) => format!("http status {status}"),
            Self::SizeMismatch => "archive size mismatch".into(),
            Self::HashMismatch => "archive hash mismatch".into(),
            Self::Io(message) => format!("io: {message}"),
            #[cfg(not(windows))]
            Self::Unsupported => "unsupported transport".into(),
        }
    }
}

#[cfg(windows)]
pub fn download_to(
    source: &ArchiveSource,
    destination: &Path,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DownloadError> {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Networking::WinHttp::*;

    let parsed = ParsedUrl::parse(&source.url).map_err(DownloadError::Network)?;
    let agent = wide("Kashiyomi/0.1 dictionary downloader");
    let host = wide(parsed.host);
    let path = wide(parsed.path);
    let method = wide("GET");

    struct Handle(*mut c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { WinHttpCloseHandle(self.0) };
            }
        }
    }

    let session = Handle(unsafe {
        WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            null(),
            null(),
            0,
        )
    });
    if session.0.is_null() {
        return Err(last_network_error("open WinHTTP session"));
    }
    if unsafe { WinHttpSetTimeouts(session.0, 15_000, 15_000, 15_000, 30_000) } == 0 {
        return Err(last_network_error("set WinHTTP timeouts"));
    }

    let connection = Handle(unsafe { WinHttpConnect(session.0, host.as_ptr(), 443, 0) });
    if connection.0.is_null() {
        return Err(last_network_error("connect"));
    }
    let request = Handle(unsafe {
        WinHttpOpenRequest(
            connection.0,
            method.as_ptr(),
            path.as_ptr(),
            null(),
            null(),
            null(),
            WINHTTP_FLAG_SECURE,
        )
    });
    if request.0.is_null() {
        return Err(last_network_error("open request"));
    }
    let redirect_policy = WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP;
    if unsafe {
        WinHttpSetOption(
            request.0,
            WINHTTP_OPTION_REDIRECT_POLICY,
            (&redirect_policy as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    } == 0
    {
        return Err(last_network_error("set redirect policy"));
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(DownloadError::Cancelled);
    }
    if unsafe { WinHttpSendRequest(request.0, null(), 0, null_mut(), 0, 0, 0) } == 0 {
        return Err(last_network_error("send request"));
    }
    if unsafe { WinHttpReceiveResponse(request.0, null_mut()) } == 0 {
        return Err(last_network_error("receive response"));
    }

    let mut status = 0u32;
    let mut status_bytes = std::mem::size_of::<u32>() as u32;
    let status_ok = unsafe {
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            (&mut status as *mut u32).cast(),
            &mut status_bytes,
            null_mut(),
        )
    };
    if status_ok == 0 {
        return Err(last_network_error("read response status"));
    }
    if status != 200 {
        return Err(DownloadError::Http(status));
    }

    let mut output = BufWriter::new(File::create(destination)?);
    let mut hasher = Sha256::new();
    let mut done = 0u64;
    let mut buffer = vec![0u8; CHUNK];
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }
        let mut available = 0u32;
        if unsafe { WinHttpQueryDataAvailable(request.0, &mut available) } == 0 {
            return Err(last_network_error("query response data"));
        }
        if available == 0 {
            break;
        }
        let requested = available.min(CHUNK as u32);
        let mut read = 0u32;
        if unsafe { WinHttpReadData(request.0, buffer.as_mut_ptr().cast(), requested, &mut read) }
            == 0
        {
            return Err(last_network_error("read response data"));
        }
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read as usize])?;
        hasher.update(&buffer[..read as usize]);
        done += read as u64;
        if done > source.archive_bytes {
            return Err(DownloadError::SizeMismatch);
        }
        progress(done, source.archive_bytes);
    }
    output.flush()?;
    output.get_ref().sync_all()?;
    if done != source.archive_bytes {
        return Err(DownloadError::SizeMismatch);
    }
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(&source.archive_sha256) {
        return Err(DownloadError::HashMismatch);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn download_to(
    _source: &ArchiveSource,
    _destination: &Path,
    _cancelled: &AtomicBool,
    _progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DownloadError> {
    Err(DownloadError::Unsupported)
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(Some(0))
        .collect()
}

#[cfg(windows)]
fn last_network_error(action: &str) -> DownloadError {
    DownloadError::Network(format!("{action}: {}", std::io::Error::last_os_error()))
}

#[cfg(any(windows, test))]
struct ParsedUrl<'a> {
    host: &'a str,
    path: &'a str,
}

#[cfg(any(windows, test))]
impl<'a> ParsedUrl<'a> {
    fn parse(url: &'a str) -> Result<Self, String> {
        let rest = url
            .strip_prefix("https://")
            .ok_or_else(|| "dictionary source must use HTTPS".to_string())?;
        if rest.contains('@') {
            return Err("dictionary source may not contain credentials".into());
        }
        let slash = rest.find('/').unwrap_or(rest.len());
        let host = &rest[..slash];
        if host.is_empty() || host.contains(':') {
            return Err("dictionary source has an invalid host".into());
        }
        let path = if slash == rest.len() {
            "/"
        } else {
            &rest[slash..]
        };
        Ok(Self { host, path })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_https_sources_are_accepted() {
        let parsed = ParsedUrl::parse("https://example.com/a/b").unwrap();
        assert_eq!(parsed.host, "example.com");
        assert_eq!(parsed.path, "/a/b");
        assert!(ParsedUrl::parse("http://example.com/a").is_err());
        assert!(ParsedUrl::parse("https://user@example.com/a").is_err());
        assert!(ParsedUrl::parse("https://example.com:443/a").is_err());
    }
}
