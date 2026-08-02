//! Text measurement helpers for the JS boundary.

/// Length of `text` in UTF-16 code units (JS string indexing).
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
mod tests {
    use super::utf16_len;

    #[test]
    fn ascii_is_one_unit_each() {
        assert_eq!(utf16_len("abc"), 3);
    }

    #[test]
    fn bmp_cjk_is_one_unit_each() {
        assert_eq!(utf16_len("夢見ては"), 4);
    }

    #[test]
    fn supplementary_plane_is_two_units() {
        // 𠮟 (U+20B9F) and emoji take surrogate pairs in UTF-16.
        assert_eq!(utf16_len("𠮟"), 2);
        assert_eq!(utf16_len("🎵"), 2);
        assert_eq!(utf16_len("a𠮟b"), 4);
    }
}
