//! Mapping from Sudachi (UniDic-style) part-of-speech arrays to the
//! analyzer-neutral categories the frontend consumes.
//!
//! Sudachi POS arrays have six fields: 品詞1..4, 活用型, 活用形.

pub fn map_pos(raw: &[String]) -> (&'static str, Vec<&'static str>) {
    let field = |i: usize| raw.get(i).map(String::as_str).unwrap_or("");
    let top = field(0);
    let sub1 = field(1);
    let sub2 = field(2);

    let part_of_speech = match top {
        "名詞" => "noun",
        "代名詞" => "pronoun",
        "動詞" => "verb",
        "助動詞" => "auxiliaryVerb",
        "助詞" => "particle",
        "接尾辞" => "suffix",
        _ => "other",
    };

    let mut features = Vec::new();
    if top == "助詞" && sub1 == "接続助詞" {
        features.push("conjunctiveParticle");
    }
    if sub1 == "非自立可能" {
        features.push("nonIndependent");
    }
    if top == "接尾辞" {
        features.push("suffix");
    }
    if sub1 == "数詞" {
        features.push("numeric");
    }
    if sub1 == "助数詞" || sub2 == "助数詞" || sub2 == "助数詞可能" {
        features.push("counter");
    }
    if sub1 == "固有名詞" {
        features.push("properName");
    }

    (part_of_speech, features)
}

#[cfg(test)]
mod tests {
    use super::map_pos;

    fn pos(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn maps_common_categories() {
        assert_eq!(
            map_pos(&pos(&["名詞", "普通名詞", "一般", "*", "*", "*"])).0,
            "noun"
        );
        assert_eq!(
            map_pos(&pos(&["代名詞", "*", "*", "*", "*", "*"])).0,
            "pronoun"
        );
        assert_eq!(
            map_pos(&pos(&[
                "動詞",
                "一般",
                "*",
                "*",
                "五段-ラ行",
                "終止形-一般"
            ]))
            .0,
            "verb"
        );
        assert_eq!(
            map_pos(&pos(&["助動詞", "*", "*", "*", "*", "*"])).0,
            "auxiliaryVerb"
        );
        assert_eq!(
            map_pos(&pos(&["助詞", "格助詞", "*", "*", "*", "*"])).0,
            "particle"
        );
        assert_eq!(
            map_pos(&pos(&["接尾辞", "名詞的", "*", "*", "*", "*"])).0,
            "suffix"
        );
        assert_eq!(
            map_pos(&pos(&["形容詞", "一般", "*", "*", "*", "*"])).0,
            "other"
        );
    }

    #[test]
    fn maps_features() {
        let (_, features) = map_pos(&pos(&["助詞", "接続助詞", "*", "*", "*", "*"]));
        assert_eq!(features, vec!["conjunctiveParticle"]);

        let (_, features) = map_pos(&pos(&["動詞", "非自立可能", "*", "*", "*", "*"]));
        assert_eq!(features, vec!["nonIndependent"]);

        let (_, features) = map_pos(&pos(&["名詞", "数詞", "*", "*", "*", "*"]));
        assert_eq!(features, vec!["numeric"]);

        let (_, features) = map_pos(&pos(&["接尾辞", "名詞的", "助数詞", "*", "*", "*"]));
        assert_eq!(features, vec!["suffix", "counter"]);

        let (_, features) = map_pos(&pos(&["名詞", "固有名詞", "人名", "一般", "*", "*"]));
        assert_eq!(features, vec!["properName"]);
    }
}
