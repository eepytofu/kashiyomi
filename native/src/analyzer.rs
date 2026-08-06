//! Sudachi tokenizer lifecycle and line analysis.
//!
//! The full dictionary is ~360MB, so loading happens on a background thread;
//! `analyze_lines` reports NotReady until it finishes. Tokenization itself is
//! cheap and runs synchronously on the caller's thread.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use sudachi::analysis::stateless_tokenizer::StatelessTokenizer;
use sudachi::analysis::{Mode, Tokenize};
use sudachi::config::Config;
use sudachi::dic::dictionary::JapaneseDictionary;

use crate::pos;
use crate::text::utf16_len;

enum State {
    Uninitialized,
    Loading,
    Ready(Arc<JapaneseDictionary>),
    Failed(String),
}

pub enum StateView {
    Uninitialized,
    Loading,
    Ready,
    Failed(String),
}

pub enum AnalyzeError {
    NotReady,
    Tokenize(String),
}

/// Token shape shared with the TypeScript side. Offsets are UTF-16 code units
/// into the analyzed line, matching JS string indexing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub surface: String,
    pub start: usize,
    pub end: usize,
    pub reading_kana: String,
    pub part_of_speech: &'static str,
    pub morphology_features: Vec<&'static str>,
    pub base_form: String,
    pub conjugation_type: String,
    pub conjugation_form: String,
    pub oov: bool,
    pub raw_pos: Vec<String>,
}

fn state_cell() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::Uninitialized))
}

pub fn state() -> StateView {
    match &*state_cell().lock().expect("analyzer state lock") {
        State::Uninitialized => StateView::Uninitialized,
        State::Loading => StateView::Loading,
        State::Ready(_) => StateView::Ready,
        State::Failed(message) => StateView::Failed(message.clone()),
    }
}

pub fn begin_init(dict_path: String, resource_dir: String) {
    {
        let mut guard = state_cell().lock().expect("analyzer state lock");
        match &*guard {
            State::Loading | State::Ready(_) => return,
            State::Uninitialized | State::Failed(_) => *guard = State::Loading,
        }
    }
    spawn_load(dict_path, resource_dir);
}

/// Replace a dictionary already in memory, for switching edition or updating.
///
/// `begin_init` returns early once a dictionary is loaded, which is right for
/// an idempotent startup call and useless for changing dictionaries — calling
/// it again with a different path silently does nothing. This is the only way
/// to swap without restarting NCM, and no restart is needed: the DLL is loaded
/// once at startup, but the `.dic` it reads is not.
///
/// Two things it does deliberately:
///
///   - **Refuses while a load is already running**, rather than racing it. Two
///     threads replacing the same state is how a half-loaded dictionary would
///     happen, and the caller can simply try again when the state settles.
///   - **Drops the old dictionary before spawning.** That releases the Windows
///     file handle, and without that the previous `.dic` cannot be deleted or
///     overwritten — which is exactly what an in-place update has to do.
///
/// Returns false when it declined, so the caller can tell "busy" from "started".
pub fn begin_reload(dict_path: String, resource_dir: String) -> bool {
    {
        let mut guard = state_cell().lock().expect("analyzer state lock");
        if matches!(&*guard, State::Loading) {
            return false;
        }
        *guard = State::Loading;
    }
    spawn_load(dict_path, resource_dir);
    true
}

fn spawn_load(dict_path: String, resource_dir: String) {
    thread::Builder::new()
        .name("kashiyomi-dict-load".into())
        .spawn(move || {
            let result = load_dictionary(&dict_path, &resource_dir);
            let mut guard = state_cell().lock().expect("analyzer state lock");
            *guard = match result {
                Ok(dictionary) => State::Ready(Arc::new(dictionary)),
                Err(message) => State::Failed(message),
            };
        })
        .expect("spawn dictionary loader thread");
}

fn load_dictionary(dict_path: &str, resource_dir: &str) -> Result<JapaneseDictionary, String> {
    let config = Config::new(
        None,
        Some(PathBuf::from(resource_dir)),
        Some(PathBuf::from(dict_path)),
    )
    .map_err(|e| format!("sudachi config: {e}"))?;
    JapaneseDictionary::from_cfg(&config).map_err(|e| format!("dictionary load: {e}"))
}

fn ready_dictionary() -> Option<Arc<JapaneseDictionary>> {
    match &*state_cell().lock().expect("analyzer state lock") {
        State::Ready(dictionary) => Some(Arc::clone(dictionary)),
        _ => None,
    }
}

pub fn analyze_lines(lines: &[String]) -> Result<Vec<Vec<Token>>, AnalyzeError> {
    let dictionary = ready_dictionary().ok_or(AnalyzeError::NotReady)?;
    let tokenizer = StatelessTokenizer::new(dictionary.as_ref());
    // One pathological line (too long, tokenizer error) must not take the
    // whole batch down; it just gets no tokens, and the frontend leaves that
    // line unannotated.
    Ok(lines
        .iter()
        .map(|line| analyze_line(&tokenizer, line).unwrap_or_default())
        .collect())
}

fn analyze_line(
    tokenizer: &StatelessTokenizer<&JapaneseDictionary>,
    line: &str,
) -> Result<Vec<Token>, AnalyzeError> {
    if line.is_empty() {
        return Ok(Vec::new());
    }
    let morphemes = tokenizer
        .tokenize(line, Mode::C, false)
        .map_err(|e| AnalyzeError::Tokenize(format!("tokenize: {e}")))?;

    let mut tokens = Vec::with_capacity(morphemes.len());
    // Morphemes come back in source order; convert byte offsets to UTF-16
    // incrementally so each gap is scanned once.
    let mut prev_byte = 0usize;
    let mut prev_utf16 = 0usize;
    for morpheme in morphemes.iter() {
        let begin_byte = morpheme.begin();
        let end_byte = morpheme.end();
        if begin_byte < prev_byte || end_byte < begin_byte || end_byte > line.len() {
            return Err(AnalyzeError::Tokenize(format!(
                "morpheme range out of order: {begin_byte}..{end_byte}"
            )));
        }
        let start = prev_utf16 + utf16_len(&line[prev_byte..begin_byte]);
        let end = start + utf16_len(&line[begin_byte..end_byte]);
        prev_byte = end_byte;
        prev_utf16 = end;

        let raw_pos: Vec<String> = morpheme.part_of_speech().to_vec();
        let (part_of_speech, morphology_features) = pos::map_pos(&raw_pos);
        let oov = morpheme.is_oov();
        let surface = morpheme.surface().to_string();
        // An OOV "reading" is just the surface echoed back, and the dictionary
        // gives punctuation and Latin runs literal readings such as キゴウ for
        // parentheses. Report those as unknown so the frontend abstains.
        let reading = morpheme.reading_form();
        let reading_kana = if oov || !has_cjk(&surface) || !is_kana_only(reading) {
            String::new()
        } else {
            reading.to_string()
        };

        tokens.push(Token {
            start,
            end,
            reading_kana,
            part_of_speech,
            morphology_features,
            base_form: morpheme.dictionary_form().to_string(),
            conjugation_type: raw_pos.get(4).cloned().unwrap_or_default(),
            conjugation_form: raw_pos.get(5).cloned().unwrap_or_default(),
            oov,
            raw_pos,
            surface,
        });
    }
    Ok(tokens)
}

fn has_cjk(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(c,
            '\u{3005}' | '\u{3006}' // 々 〆
            | '\u{3041}'..='\u{3096}' // hiragana
            | '\u{30A1}'..='\u{30FA}' // katakana
            | '\u{30FC}' // prolonged sound mark
            | '\u{3400}'..='\u{9FFF}' // Han
            | '\u{F900}'..='\u{FAFF}' // Han compatibility
        )
    }) || text.chars().any(|c| matches!(c as u32, 0x20000..=0x2FFFF))
}

fn is_kana_only(text: &str) -> bool {
    !text.is_empty()
        && text.chars().all(|c| {
            matches!(c,
                '\u{3041}'..='\u{3096}' // hiragana
                | '\u{30A1}'..='\u{30FA}' // katakana
                | '\u{30FC}' // prolonged sound mark
                | '\u{309D}' | '\u{309E}' | '\u{30FD}' | '\u{30FE}' // iteration marks
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Requires assets/dict/system_core.dic (npm run fetch-dict).
    /// Run with: cargo test -- --ignored
    #[test]
    #[ignore]
    fn smoke_real_dictionary() {
        let root = env!("CARGO_MANIFEST_DIR");
        let dict = format!("{root}/../assets/dict/system_core.dic");
        let resources = format!("{root}/../assets/sudachi");
        assert!(std::path::Path::new(&dict).exists(), "dictionary missing: {dict}");

        begin_init(dict, resources);
        for _ in 0..1200 {
            match state() {
                StateView::Ready => break,
                StateView::Failed(message) => panic!("dictionary load failed: {message}"),
                _ => thread::sleep(Duration::from_millis(100)),
            }
        }
        assert!(matches!(state(), StateView::Ready), "dictionary did not load in time");

        let line = "灯篭の灯に照らされてゆく".to_string();
        let lines = analyze_lines(std::slice::from_ref(&line))
            .unwrap_or_else(|_| panic!("analyze failed"));
        let tokens = &lines[0];
        assert!(!tokens.is_empty());

        // Tokens must exactly tile the line in UTF-16 space.
        let mut cursor = 0usize;
        let mut reconstructed = String::new();
        for token in tokens {
            assert_eq!(token.start, cursor, "gap before {}", token.surface);
            assert!(token.end > token.start);
            cursor = token.end;
            reconstructed.push_str(&token.surface);
        }
        assert_eq!(reconstructed, line);
        assert_eq!(cursor, utf16_len(&line));

        let readings: Vec<&str> = tokens.iter().map(|t| t.reading_kana.as_str()).collect();
        let joined = readings.join("|");
        assert!(joined.contains("トウロウ"), "灯篭 reading missing: {joined}");
        assert!(joined.contains("テラ"), "照らさ reading missing: {joined}");

        // The particles must be POS-tagged so romaji can special-case them.
        let particle_count = tokens.iter().filter(|t| t.part_of_speech == "particle").count();
        assert!(particle_count >= 2, "expected の and に as particles: {joined}");
    }
}
