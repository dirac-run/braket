//! Allocation-free decoding of shell word spans. Ported from classifier/src/word.ts.

pub(crate) const WORD_DYNAMIC: u32 = 1;
pub(crate) const WORD_MAY_SPLIT: u32 = 2;
pub(crate) const WORD_MAY_EXPAND: u32 = 4;
pub(crate) const WORD_QUOTED: u32 = 8;

/// A borrowed byte cursor: ASCII shell syntax is decoded and UTF-8 payload stays opaque.
pub(crate) struct WordCursor<'a> {
    source: &'a [u8],
    position: usize,
    end: usize,
    quote: u8,
}

impl<'a> WordCursor<'a> {
    #[inline]
    pub(crate) fn new(source: &'a [u8], start: usize, end: usize) -> Self {
        Self {
            source,
            position: start,
            // A shell lexer may step beyond EOF while recognizing a dangling escape.
            end: end.min(source.len()),
            quote: 0,
        }
    }

    #[inline]
    pub(crate) fn next_char(&mut self) -> i32 {
        while self.position < self.end {
            let mut c = self.source[self.position];
            self.position += 1;
            if c == b'\'' && self.quote != b'"' {
                self.quote = if self.quote == b'\'' { 0 } else { b'\'' };
                continue;
            }
            if c == b'"' && self.quote != b'\'' {
                self.quote = if self.quote == b'"' { 0 } else { b'"' };
                continue;
            }
            if c == b'\\' && self.quote != b'\'' && self.position < self.end {
                let next = self.source[self.position];
                if self.quote == 0 || matches!(next, b'$' | b'`' | b'"' | b'\\' | b'\n') {
                    self.position += 1;
                    if next == b'\n' {
                        continue;
                    }
                    c = next;
                }
            }
            return i32::from(c);
        }
        -1
    }
}

#[inline]
pub(crate) fn word_char_at(source: &[u8], start: usize, end: usize, index: usize) -> i32 {
    let mut cursor = WordCursor::new(source, start, end);
    for _ in 0..index {
        if cursor.next_char() < 0 {
            return -1;
        }
    }
    cursor.next_char()
}

#[inline]
pub(crate) fn word_length(source: &[u8], start: usize, end: usize) -> usize {
    let mut cursor = WordCursor::new(source, start, end);
    let mut length = 0;
    while cursor.next_char() >= 0 {
        length += 1;
    }
    length
}

/// Decoded prefix length before an unescaped expansion makes identity unknown.
#[inline]
pub(crate) fn static_word_prefix(source: &[u8], start: usize, end: usize) -> usize {
    let end = end.min(source.len());
    let mut quote = 0;
    let mut length = 0;
    let mut position = start;
    while position < end {
        let c = source[position];
        position += 1;
        if c == b'\'' && quote != b'"' {
            quote = if quote == b'\'' { 0 } else { b'\'' };
            continue;
        }
        if c == b'"' && quote != b'\'' {
            quote = if quote == b'"' { 0 } else { b'"' };
            continue;
        }
        if c == b'\\' && quote != b'\'' && position < end {
            let next = source[position];
            if quote == 0 || matches!(next, b'$' | b'`' | b'"' | b'\\' | b'\n') {
                position += 1;
                if next != b'\n' {
                    length += 1;
                }
                continue;
            }
        }
        if quote != b'\'' && matches!(c, b'$' | b'`') {
            return length;
        }
        length += 1;
    }
    length
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quotes_and_escapes() {
        for (source, decoded) in [
            (&b"ab'cd'\"ef\""[..], &b"abcdef"[..]),
            (&b"a\\\nb\\ c"[..], &b"ab c"[..]),
            (&b"'a\\b'\"c\\qd\\$\""[..], &b"a\\bc\\qd$"[..]),
            (&b"end\\"[..], &b"end\\"[..]),
        ] {
            let mut cursor = WordCursor::new(source, 0, source.len());
            for &byte in decoded {
                assert_eq!(cursor.next_char(), i32::from(byte));
            }
            assert_eq!(cursor.next_char(), -1);
            assert_eq!(word_length(source, 0, source.len()), decoded.len());
            assert_eq!(word_char_at(source, 0, source.len(), decoded.len()), -1);
        }
    }

    #[test]
    fn static_prefix_respects_quote_context() {
        for (source, prefix) in [
            (&b"--file=\"$path\""[..], 7),
            (&b"'literal$'"[..], 8),
            (&b"\\$ok"[..], 3),
            (&b"a\\\nb`cmd`"[..], 2),
        ] {
            assert_eq!(static_word_prefix(source, 0, source.len()), prefix);
        }
    }

    #[test]
    fn incomplete_shell_spans_stop_at_source_end() {
        let source = b"echo > \\";
        let start = source.len() - 1;
        let end = source.len() + 1;
        let mut cursor = WordCursor::new(source, start, end);
        assert_eq!(cursor.next_char(), i32::from(b'\\'));
        assert_eq!(cursor.next_char(), -1);
        assert_eq!(word_length(source, start, end), 1);
        assert_eq!(static_word_prefix(source, start, end), 1);
        assert_eq!(word_char_at(source, start, end, 1), -1);
        assert_eq!(word_length(source, end, usize::MAX), 0);
        assert_eq!(static_word_prefix(source, end, usize::MAX), 0);
    }
}
