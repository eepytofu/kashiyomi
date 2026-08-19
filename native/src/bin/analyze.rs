//! Debug CLI: run the plugin's analyzer over lines and print what Sudachi
//! returns. Use this to check a reading without launching NetEase.
//!
//!   cargo run --release --bin analyze -- "磊々落々 反戦国家"
//!   echo 夜ニ紛レ | cargo run --release --bin analyze
//!
//! Add --json to print the exact payload the frontend receives.

use kashiyomi_backend::analyzer::{activate, analyze_lines, load_candidate};
use std::io::{self, Read};

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    args.retain(|a| a != "--json");

    let lines: Vec<String> = if args.is_empty() {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer).expect("read stdin");
        buffer
            .lines()
            .map(str::to_string)
            .filter(|l| !l.trim().is_empty())
            .collect()
    } else {
        args
    };
    if lines.is_empty() {
        eprintln!("usage: analyze [--json] <line>...   (or pipe lines on stdin)");
        std::process::exit(2);
    }

    let root = env!("CARGO_MANIFEST_DIR");
    // KASHIYOMI_DICT swaps the dictionary without a rebuild, so the same binary
    // can read the same lines through full, core and small and the difference
    // is the dictionary rather than anything else.
    let dict = std::env::var("KASHIYOMI_DICT")
        .unwrap_or_else(|_| format!("{root}/../assets/dict/system_core.dic"));
    let resources = format!("{root}/../assets/sudachi");
    if !std::path::Path::new(&dict).exists() {
        eprintln!("dictionary missing: {dict}\nrun: npm run fetch-dict");
        std::process::exit(1);
    }
    let candidate = load_candidate(&dict, &resources).unwrap_or_else(|message| {
        eprintln!("dictionary load failed: {message}");
        std::process::exit(1);
    });
    activate(candidate);

    let analyzed = match analyze_lines(&lines) {
        Ok(analyzed) => analyzed,
        Err(_) => {
            eprintln!("analyzer not ready");
            std::process::exit(1);
        }
    };

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&analyzed).expect("serialize")
        );
        return;
    }

    for (line, tokens) in lines.iter().zip(analyzed.iter()) {
        println!("{line}");
        for token in tokens {
            let reading = if token.reading_kana.is_empty() {
                "(no reading)".to_string()
            } else {
                token.reading_kana.clone()
            };
            println!(
                "  {:<10} {:<12} {:<14} {}{}",
                token.surface,
                reading,
                token.part_of_speech,
                token.raw_pos.join(","),
                if token.oov { "  [OOV]" } else { "" },
            );
        }
        println!();
    }
}
