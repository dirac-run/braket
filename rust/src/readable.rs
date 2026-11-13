use std::collections::BTreeMap;
use std::fmt::Write;

const CAPABILITIES: [&str; 10] = [
    "filesystem",
    "network",
    "processes",
    "execution",
    "credentials",
    "software",
    "configuration",
    "devices",
    "remote_resources",
    "system",
];

/// Named effects, or unknown for the entire input. Absent capabilities are
/// omitted. Values are "use", "read", or "mutate".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadableDecision {
    Capabilities(BTreeMap<&'static str, &'static str>),
    Unknown,
}

impl ReadableDecision {
    fn from_decision(decision: i32) -> Self {
        if decision == -1 {
            return Self::Unknown;
        }
        let mut capabilities = BTreeMap::new();
        for (i, name) in CAPABILITIES.iter().enumerate() {
            let level = (decision >> (i * 3)) & 7;
            let value = match level {
                0 => continue,
                7 => "mutate",
                3 => "read",
                _ => "use",
            };
            capabilities.insert(*name, value);
        }
        Self::Capabilities(capabilities)
    }

    /// Serialize to JSON using only the standard library.
    pub fn to_json(&self) -> String {
        let Self::Capabilities(capabilities) = self else {
            return String::from("\"unknown\"");
        };
        let mut json = String::from("{");
        for (i, (name, value)) in capabilities.iter().enumerate() {
            if i != 0 {
                json.push(',');
            }
            push_json_string(&mut json, name);
            json.push(':');
            push_json_string(&mut json, value);
        }
        json.push('}');
        json
    }
}

fn push_json_string(output: &mut String, value: &str) {
    output.push('"');
    for c in value.chars() {
        match c {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{0}'..='\u{1f}' => write!(output, "\\u{:04x}", c as u32).unwrap(),
            _ => output.push(c),
        }
    }
    output.push('"');
}

/// Classify without executing the input and return named effects.
/// Readable decoding happens only when this opt-in API is called.
pub fn classify_readable(source: &str) -> ReadableDecision {
    ReadableDecision::from_decision(crate::classify(source))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_capability_and_level_decodes_at_its_own_offset() {
        for (i, name) in CAPABILITIES.iter().enumerate() {
            for (level, text) in [(1, "use"), (3, "read"), (7, "mutate")] {
                let result = ReadableDecision::from_decision(level << (i * 3));
                assert_eq!(
                    result,
                    ReadableDecision::Capabilities(BTreeMap::from([(*name, text)]))
                );
            }
        }
        assert_eq!(
            ReadableDecision::from_decision(0x3fffffff),
            ReadableDecision::Capabilities(CAPABILITIES.map(|name| (name, "mutate")).into())
        );
    }

    #[test]
    fn json_escapes_public_string_fields() {
        let result = ReadableDecision::Capabilities(BTreeMap::from([(
            "\"\\\n\r\t\u{0}\u{1f}é",
            "\"\\\n\r\t\u{0}\u{1f}é",
        )]));
        assert_eq!(
            result.to_json(),
            "{\"\\\"\\\\\\n\\r\\t\\u0000\\u001fé\":\"\\\"\\\\\\n\\r\\t\\u0000\\u001fé\"}"
        );
    }
}
