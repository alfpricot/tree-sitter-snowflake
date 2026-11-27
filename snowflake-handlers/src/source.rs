use std::ops::Range;

/// Decoded UTF-8 text with byte positions in the original SQL file.
#[derive(Debug, Clone)]
pub struct HandlerSource {
    text: String,
    // Each output byte maps to the entire input character/escape that produced it.
    origins: Vec<Range<usize>>,
    end: usize,
}

impl HandlerSource {
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Map an output byte offset, including EOF, to an absolute SQL byte offset.
    /// An offset inside a decoded Unicode character maps to its source start.
    pub fn source_offset(&self, offset: usize) -> Option<usize> {
        if offset == self.text.len() {
            Some(self.end)
        } else {
            self.origins.get(offset).map(|range| range.start)
        }
    }

    /// Map a half-open output range. Escapes are included in their entirety.
    /// Empty ranges map to an empty range at the corresponding source position.
    pub fn source_range(&self, range: Range<usize>) -> Option<Range<usize>> {
        if range.start > range.end || range.end > self.text.len() {
            return None;
        }
        let start = self.source_offset(range.start)?;
        let end = if range.is_empty() {
            start
        } else {
            self.origins.get(range.end - 1)?.end
        };
        Some(start..end)
    }

    pub(crate) fn verbatim(text: &str, start: usize) -> Self {
        Self {
            text: text.to_owned(),
            origins: (start..start + text.len()).map(|i| i..i + 1).collect(),
            end: start + text.len(),
        }
    }

    /// Decode only content already bounded by a valid string_body node. Numeric
    /// escapes may span the grammar's escape node and its following content node.
    pub(crate) fn quoted(text: &str, start: usize) -> Result<Self, String> {
        let mut result = Self {
            text: String::with_capacity(text.len()),
            origins: Vec::with_capacity(text.len()),
            end: start + text.len(),
        };
        let mut i = 0;
        while i < text.len() {
            let begin = i;
            let c = text[i..].chars().next().unwrap();
            i += c.len_utf8();
            if c == '\'' {
                if !text[i..].starts_with('\'') {
                    return Err("Unpaired apostrophe in body content".into());
                }
                i += 1;
                result.push('\'', start + begin..start + i);
            } else if c == '\\' {
                let escaped = text[i..].chars().next().ok_or("Incomplete escape")?;
                i += escaped.len_utf8();
                let decoded = match escaped {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'b' => '\u{8}',
                    'f' => '\u{c}',
                    'x' | 'u' => {
                        let count = if escaped == 'x' { 2 } else { 4 };
                        let digits = text.get(i..i + count).ok_or("Incomplete numeric escape")?;
                        // `from_str_radix` alone would accept a leading `+`.
                        if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
                            return Err("Invalid numeric escape".into());
                        }
                        let value = u32::from_str_radix(digits, 16)
                            .map_err(|_| "Invalid numeric escape")?;
                        i += count;
                        if escaped == 'x' && value > 0x7f {
                            return Err("Non-ASCII hexadecimal escape is not supported; use a Unicode escape".into());
                        }
                        char::from_u32(value).ok_or("Escape is not a Unicode scalar value")?
                    }
                    '0'..='7' => {
                        let mut value = escaped.to_digit(8).unwrap();
                        let mut count = 1;
                        while count < 3 {
                            let Some(digit) = text[i..].chars().next().and_then(|c| c.to_digit(8))
                            else {
                                break;
                            };
                            value = value * 8 + digit;
                            i += 1;
                            count += 1;
                        }
                        if (count != 3 && !(escaped == '0' && count == 1)) || value > 0x7f {
                            return Err("Expected a three-digit ASCII octal escape or \\0".into());
                        }
                        char::from_u32(value).ok_or("Invalid octal escape")?
                    }
                    // Snowflake discards the backslash for unrecognized escapes.
                    other => other,
                };
                result.push(decoded, start + begin..start + i);
            } else {
                result.text.push(c);
                result
                    .origins
                    .extend((start + begin..start + i).map(|j| j..j + 1));
            }
        }
        Ok(result)
    }

    fn push(&mut self, c: char, origin: Range<usize>) {
        self.text.push(c);
        self.origins
            .extend(std::iter::repeat_n(origin, c.len_utf8()));
    }
}

/// A zero-based row and UTF-8 byte column, matching tree-sitter coordinates.
pub fn source_point(sql: &str, offset: usize) -> Option<tree_sitter::Point> {
    let prefix = sql.as_bytes().get(..offset)?;
    let row = prefix.iter().filter(|&&b| b == b'\n').count();
    let column = prefix
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(offset, |i| offset - i - 1);
    Some(tree_sitter::Point::new(row, column))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Where the decoded body starts in the pretend SQL file.
    const START: usize = 7;

    fn decode(body: &str) -> Result<HandlerSource, String> {
        HandlerSource::quoted(body, START)
    }

    #[test]
    fn decodes_escapes_and_doubled_apostrophes() {
        for (body, text) in [
            ("", ""),
            ("a''", "a'"),
            ("''''", "''"),
            (r"\n\r\t\b\f", "\n\r\t\u{8}\u{c}"),
            (r"\x41\u00e9\101\0", "A\u{e9}A\0"),
            (r"\q\\\'", "q\\'"),
            ("é", "é"),
        ] {
            assert_eq!(decode(body).unwrap().text(), text, "{body:?}");
        }
    }

    #[test]
    fn rejects_malformed_escapes() {
        for body in [
            "'", "a\\", r"\x4", r"\u041", r"\x+f", r"\u+041", r"\x-1", "\\x4é", "\\xé", "\\u00é",
            r"\xff", r"\ud800", r"\12", r"\1", r"\200",
        ] {
            assert!(decode(body).is_err(), "{body:?} decoded");
        }
    }

    #[test]
    fn offsets_inside_escapes_and_characters_map_to_their_start() {
        // é written as an escape (two output bytes, six source bytes), then raw.
        let source = decode("\\u00e9é").unwrap();
        assert_eq!(source.text(), "éé");
        assert_eq!(source.source_offset(0), Some(START));
        assert_eq!(source.source_offset(1), Some(START));
        assert_eq!(source.source_offset(2), Some(START + 6));
        assert_eq!(source.source_offset(3), Some(START + 7));
        assert_eq!(source.source_offset(4), Some(START + 8));
        assert_eq!(source.source_offset(5), None);
        assert_eq!(source.source_offset(usize::MAX), None);
        assert_eq!(source.source_range(1..2), Some(START..START + 6));
        assert_eq!(source.source_range(0..4), Some(START..START + 8));
        assert_eq!(source.source_range(4..4), Some(START + 8..START + 8));
        assert_eq!(source.source_range(0..5), None);
    }

    #[test]
    fn verbatim_text_maps_byte_for_byte() {
        let source = HandlerSource::verbatim("aé\\n", START);
        assert_eq!(source.text(), "aé\\n");
        assert_eq!(source.source_range(1..3), Some(START + 1..START + 3));
        assert_eq!(source.source_offset(5), Some(START + 5));
    }

    /// The offset map's invariant: the SQL slice behind any run of whole
    /// output characters decodes to exactly that run.
    #[test]
    fn every_mapped_slice_decodes_to_the_text_it_maps_from() {
        const ALPHABET: [&str; 17] = [
            "a", "'", "\\", "n", "x", "u", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "é",
        ];
        // Every string up to four characters, plus longer escapes around them.
        let mut bodies = vec![String::new()];
        let mut previous = bodies.clone();
        for _ in 0..4 {
            previous = previous
                .iter()
                .flat_map(|body| ALPHABET.iter().map(move |c| format!("{body}{c}")))
                .collect();
            bodies.extend_from_slice(&previous);
        }
        for pair in ALPHABET {
            for escape in ["\\u00e9", "\\x41", "\\101", "''", "\\0"] {
                bodies.push(format!("{pair}{escape}{pair}"));
                bodies.push(format!("{escape}{pair}{escape}"));
            }
        }
        let mut decoded = 0;
        for body in &bodies {
            let Ok(source) = decode(body) else { continue };
            decoded += 1;
            let text = source.text();
            let boundaries: Vec<_> = (0..=text.len())
                .filter(|&i| text.is_char_boundary(i))
                .collect();
            for (index, &from) in boundaries.iter().enumerate() {
                for &to in &boundaries[index..] {
                    let mapped = source.source_range(from..to).unwrap();
                    let slice = &body[mapped.start - START..mapped.end - START];
                    assert_eq!(
                        decode(slice).unwrap().text(),
                        &text[from..to],
                        "{body:?} {from}..{to}"
                    );
                }
            }
        }
        assert!(decoded > 10_000, "only {decoded} bodies decoded");
    }
}
