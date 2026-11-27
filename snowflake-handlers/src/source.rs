use std::ops::Range;

/// Why a single-quoted body could not be decoded, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct EncodingError {
    /// What is wrong with the escape or apostrophe.
    pub message: &'static str,
    /// The offending text, as a byte range in the SQL.
    pub range: Range<usize>,
}

impl std::fmt::Display for EncodingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Range { start, end } = self.range;
        write!(f, "{} at bytes {start}..{end}", self.message)
    }
}

impl std::error::Error for EncodingError {}

/// Decoded UTF-8 text with byte positions in the original SQL file.
#[derive(Debug, Clone)]
pub struct HandlerSource {
    text: String,
    // The SQL byte offset of the first body byte.
    start: usize,
    // Only the decoded runs that differ from their source, in output order.
    // Every other byte sits at a fixed distance from the escape before it, or
    // from `start`, so a dollar-quoted body needs no entries at all.
    escapes: Vec<Escape>,
    end: usize,
}

/// One escape or doubled apostrophe: the output bytes it decoded to and the
/// SQL bytes it was written as.
#[derive(Debug, Clone)]
struct Escape {
    output: Range<usize>,
    source: Range<usize>,
}

impl HandlerSource {
    /// The body without its delimiters, with escapes decoded.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Map an output byte offset, including EOF, to an absolute SQL byte offset.
    /// An offset inside a decoded Unicode character maps to its source start.
    #[must_use]
    pub fn source_offset(&self, offset: usize) -> Option<usize> {
        if offset == self.text.len() {
            Some(self.end)
        } else {
            self.origin(offset).map(|range| range.start)
        }
    }

    /// Map a half-open output range. Escapes are included in their entirety.
    /// Empty ranges map to an empty range at the corresponding source position.
    #[must_use]
    pub fn source_range(&self, range: Range<usize>) -> Option<Range<usize>> {
        if range.start > range.end || range.end > self.text.len() {
            return None;
        }
        let start = self.source_offset(range.start)?;
        let end = if range.is_empty() {
            start
        } else {
            self.origin(range.end - 1)?.end
        };
        Some(start..end)
    }

    // The SQL bytes behind one output byte: the whole escape that produced it,
    // or the single byte it was copied from.
    fn origin(&self, offset: usize) -> Option<Range<usize>> {
        if offset >= self.text.len() {
            return None;
        }
        let after = self.escapes.partition_point(|e| e.output.start <= offset);
        let start = match self.escapes[..after].last() {
            Some(escape) if offset < escape.output.end => return Some(escape.source.clone()),
            Some(escape) => escape.source.end + (offset - escape.output.end),
            None => self.start + offset,
        };
        Some(start..start + 1)
    }

    pub(crate) fn verbatim(text: &str, start: usize) -> Self {
        Self {
            text: text.to_owned(),
            start,
            escapes: Vec::new(),
            end: start + text.len(),
        }
    }

    /// Decode only content already bounded by a valid `string_body` node. Numeric
    /// escapes may span the grammar's escape node and its following content node.
    pub(crate) fn quoted(text: &str, start: usize) -> Result<Self, EncodingError> {
        let mut result = Self {
            text: String::with_capacity(text.len()),
            start,
            escapes: Vec::new(),
            end: start + text.len(),
        };
        let mut i = 0;
        while i < text.len() {
            let begin = i;
            let c = text[i..].chars().next().unwrap();
            i += c.len_utf8();
            // The offending text runs from this character to `end`.
            let fail = |message, end| EncodingError {
                message,
                range: start + begin..start + end,
            };
            if c == '\'' {
                if !text[i..].starts_with('\'') {
                    return Err(fail("Unpaired apostrophe in body content", i));
                }
                i += 1;
                result.push('\'', start + begin..start + i);
            } else if c == '\\' {
                let escaped = text[i..]
                    .chars()
                    .next()
                    .ok_or_else(|| fail("Incomplete escape", i))?;
                i += escaped.len_utf8();
                let decoded = match escaped {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'b' => '\u{8}',
                    'f' => '\u{c}',
                    'x' | 'u' => {
                        let count = if escaped == 'x' { 2 } else { 4 };
                        // Where the digits would end, kept on a character boundary.
                        let end = i + text[i..]
                            .chars()
                            .take(count)
                            .map(char::len_utf8)
                            .sum::<usize>();
                        let digits = text
                            .get(i..i + count)
                            .ok_or_else(|| fail("Incomplete numeric escape", end))?;
                        // `from_str_radix` alone would accept a leading `+`.
                        if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
                            return Err(fail("Invalid numeric escape", end));
                        }
                        let value = u32::from_str_radix(digits, 16)
                            .map_err(|_| fail("Invalid numeric escape", end))?;
                        i += count;
                        if escaped == 'x' && value > 0x7f {
                            return Err(fail(
                                "Non-ASCII hexadecimal escape is not supported; use a Unicode escape",
                                i,
                            ));
                        }
                        char::from_u32(value)
                            .ok_or_else(|| fail("Escape is not a Unicode scalar value", i))?
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
                            return Err(fail(
                                "Expected a three-digit ASCII octal escape or \\0",
                                i,
                            ));
                        }
                        char::from_u32(value).ok_or_else(|| fail("Invalid octal escape", i))?
                    }
                    // Snowflake discards the backslash for unrecognized escapes.
                    other => other,
                };
                result.push(decoded, start + begin..start + i);
            } else {
                result.text.push(c);
            }
        }
        Ok(result)
    }

    fn push(&mut self, c: char, source: Range<usize>) {
        let begin = self.text.len();
        self.text.push(c);
        self.escapes.push(Escape {
            output: begin..self.text.len(),
            source,
        });
    }
}

/// A zero-based row and UTF-8 byte column, matching tree-sitter coordinates.
#[must_use]
pub fn source_point(sql: &str, offset: usize) -> Option<tree_sitter::Point> {
    let prefix = sql.as_bytes().get(..offset)?;
    // Splitting on newlines yields one more piece than there are newlines.
    let row = prefix.split(|&b| b == b'\n').count() - 1;
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

    fn decode(body: &str) -> Result<HandlerSource, EncodingError> {
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
    fn errors_report_the_offending_sql_bytes() {
        for (body, message, range) in [
            ("ab'cd", "Unpaired apostrophe in body content", 2..3),
            ("ab\\", "Incomplete escape", 2..3),
            (r"ab\x4", "Incomplete numeric escape", 2..5),
            ("ab\\x4\u{e9}z", "Incomplete numeric escape", 2..7),
            (r"ab\x+fz", "Invalid numeric escape", 2..6),
            (r"ab\xffz", "Non-ASCII hexadecimal", 2..6),
            (r"ab\ud800z", "not a Unicode scalar value", 2..8),
            (r"ab\12z", "three-digit ASCII octal", 2..5),
        ] {
            let error = decode(body).unwrap_err();
            assert!(error.message.contains(message), "{body:?}: {error}");
            assert_eq!(
                error.range,
                START + range.start..START + range.end,
                "{body:?}"
            );
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

    #[test]
    fn only_escapes_take_an_entry_in_the_offset_map() {
        assert!(
            HandlerSource::verbatim("a''b", START).escapes.is_empty(),
            "a dollar-quoted body maps by offset alone"
        );
        assert_eq!(decode(r"abc''def\ng").unwrap().escapes.len(), 2);
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
