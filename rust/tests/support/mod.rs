#![allow(dead_code)]

pub const BENCHMARK: &str = include_str!("../fixtures/benchmark.tsv");
pub const REGRESSION: &str = include_str!("../fixtures/regression.tsv");
pub const CANONICAL: &str = include_str!("../fixtures/canonical.tsv");
pub const VARIATION: &str = include_str!("../fixtures/variation.tsv");
pub const METADATA: &str = include_str!("../fixtures/metadata.json");

pub fn fixture_count(name: &str) -> usize {
    let key = format!("\"{name}\":");
    METADATA
        .lines()
        .find_map(|line| line.trim().strip_prefix(&key))
        .expect("fixture count in metadata")
        .trim()
        .trim_end_matches(',')
        .parse()
        .expect("integer fixture count")
}

pub fn decode_hex(hex: &str) -> Result<String, String> {
    if hex.len() % 2 != 0 {
        return Err("odd number of hex digits".into());
    }
    fn nibble(b: u8) -> Result<u8, String> {
        match b {
            b'0'..=b'9' => Ok(b - b'0'),
            b'a'..=b'f' => Ok(b - b'a' + 10),
            b'A'..=b'F' => Ok(b - b'A' + 10),
            _ => Err("invalid hex digit".into()),
        }
    }
    let bytes = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|p| Ok(nibble(p[0])? * 16 + nibble(p[1])?))
        .collect::<Result<Vec<u8>, String>>()?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

pub fn fixtures(text: &str) -> Vec<(i32, String)> {
    text.lines()
        .filter(|line| !line.starts_with('#') && !line.is_empty())
        .map(|line| {
            // An omitted command field represents empty input without a trailing tab.
            let (expected, hex) = line.split_once('\t').unwrap_or((line, ""));
            (
                expected.parse().expect("i32 expected result"),
                decode_hex(hex).expect("valid UTF-8 hex command"),
            )
        })
        .collect()
}

/// Throughput inputs match TypeScript's three public benchmark workloads.
pub fn throughput_workloads() -> Vec<(&'static str, Vec<String>)> {
    let examples = fixtures(BENCHMARK);
    let single = examples
        .into_iter()
        .enumerate()
        .filter_map(|(i, (_, source))| matches!(i, 3..=36 | 50..=64 | 67).then_some(source))
        .collect();
    let mut result = workloads();
    result.retain(|(name, _)| *name != "known" && *name != "unknown");
    result.insert(0, ("single", single));
    result
}

// Preserve the historical allocation probe's five workloads and call counts.
pub fn workloads() -> Vec<(&'static str, Vec<String>)> {
    let examples = fixtures(BENCHMARK);
    vec![
        (
            "known",
            examples
                .iter()
                .filter(|(v, _)| *v >= 0)
                .map(|(_, s)| s.clone())
                .collect(),
        ),
        (
            "unknown",
            examples
                .iter()
                .filter(|(v, _)| *v == -1)
                .map(|(_, s)| s.clone())
                .collect(),
        ),
        (
            "compound",
            vec![
                "if true; then cat input; else rm out; fi".into(),
                "X=\"$(cat input)\"; curl --version >out".into(),
                "(ls /tmp | cat input) && rm out".into(),
                vec!["cat input"; 32].join("; "),
            ],
        ),
        (
            "long",
            vec![
                format!("ls {}", "filename".repeat(1024)),
                format!("X={}", "x".repeat(16384)),
                format!("#{}", "comment".repeat(4096)),
                format!("unknown_command_xyz {}", "argument ".repeat(2048)),
            ],
        ),
    ]
}
