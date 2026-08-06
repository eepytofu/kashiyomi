//! Kashiyomi native backend.
//!
//! Exposes one JS-callable API, `kashiyomi.dispatch`, that takes a JSON command
//! string and returns a JSON result string. The C ABI follows what BetterNCM's
//! loader expects from a `native_plugin` DLL: an exported `BetterNCMPluginMain`
//! receiving a `PluginAPI` with an `add_native_api` registrar.
//!
//! BetterNCM copies the returned C string immediately and never frees it, so
//! `dispatch` hands out a pointer into a static buffer that lives until the
//! next call.

pub mod analyzer;
mod api;
pub mod install;
pub mod pos;
pub mod text;

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::panic;
use std::ptr;
use std::sync::{LazyLock, Mutex};

#[repr(i32)]
#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum NcmProcessType {
    Undetected = 0x0,
    Main = 0x0001,
    Renderer = 0x10,
    GpuProcess = 0x100,
    Utility = 0x1000,
}

#[repr(i32)]
#[allow(dead_code)]
pub enum NativeApiType {
    Int,
    Boolean,
    Double,
    String,
    V8Value,
}

pub type NativeFunction = unsafe extern "C" fn(args: *mut *mut c_void) -> *mut c_char;
pub type AddNativeApiFn = extern "C" fn(
    args: *const NativeApiType,
    args_num: c_int,
    identifier: *const c_char,
    function: NativeFunction,
) -> c_int;

#[repr(C)]
pub struct PluginApi {
    pub add_native_api: AddNativeApiFn,
    pub betterncm_version: *const c_char,
    pub process_type: NcmProcessType,
    pub ncm_version: *const [u16; 3],
}

static RETURN_BUFFER: LazyLock<Mutex<CString>> = LazyLock::new(|| Mutex::new(CString::default()));

fn safe_call<F, T>(func: F) -> T
where
    F: FnOnce() -> T + panic::UnwindSafe,
    T: Default,
{
    panic::catch_unwind(func).unwrap_or_default()
}

unsafe fn read_string_arg(args: *mut *mut c_void, index: usize) -> Option<String> {
    if args.is_null() {
        return None;
    }
    let ptr = unsafe { *args.add(index) };
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { CStr::from_ptr(ptr.cast::<c_char>()).to_string_lossy().into_owned() })
}

/// # Safety
/// Called by BetterNCM with a single C-string argument.
#[no_mangle]
pub unsafe extern "C" fn dispatch(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        let command = unsafe { read_string_arg(args, 0) }.unwrap_or_default();
        let result = api::handle(&command);
        let Ok(mut buffer) = RETURN_BUFFER.lock() else {
            return ptr::null_mut();
        };
        *buffer = CString::new(result).unwrap_or_default();
        buffer.as_ptr().cast_mut()
    })
}

const DISPATCH_ARGS: [NativeApiType; 1] = [NativeApiType::String];

/// # Safety
/// Called once by the BetterNCM loader with a valid `PluginApi` pointer.
#[no_mangle]
pub unsafe extern "C" fn BetterNCMPluginMain(api: *mut PluginApi) -> c_int {
    safe_call(|| {
        if api.is_null() {
            return -1;
        }
        let api = unsafe { &*api };
        if api.process_type != NcmProcessType::Renderer {
            return 0;
        }
        let Ok(identifier) = CString::new("kashiyomi.dispatch") else {
            return -1;
        };
        (api.add_native_api)(
            DISPATCH_ARGS.as_ptr(),
            DISPATCH_ARGS.len() as c_int,
            identifier.as_ptr(),
            dispatch,
        );
        0
    })
}
