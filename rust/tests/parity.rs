mod support;
use braket::classify;

fn check(name: &str, source: &str, expected_count: usize) {
    let cases = support::fixtures(source);
    assert_eq!(cases.len(), expected_count, "fixture count: {name}");
    let mut mismatches = Vec::new();
    let mut total = 0;
    for (i, (expected, command)) in cases.iter().enumerate() {
        let actual = std::panic::catch_unwind(|| classify(command))
            .unwrap_or_else(|_| panic!("{name} record {} panicked for command {command:?}", i + 1));
        if actual != *expected {
            total += 1;
            if mismatches.len() < 40 {
                mismatches.push(format!(
                    "{name} record {}: expected {expected}, actual {actual}, command {command:?}",
                    i + 1
                ));
            }
        }
    }
    assert_eq!(
        total,
        0,
        "{total} parity mismatches (first {}):\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

#[test]
fn benchmark_examples() {
    check("benchmark", support::BENCHMARK, 76);
}

#[test]
fn existing_runtime_regressions() {
    let count = support::fixture_count("regression");
    assert!(count >= 1230);
    check("regression", support::REGRESSION, count);
}

#[test]
fn every_frozen_canonical_path() {
    let count = support::fixture_count("canonical");
    assert!(count >= 8188);
    check("canonical", support::CANONICAL, count);
}

#[test]
fn deterministic_syntax_options_unicode_and_truncations() {
    let count = support::fixture_count("variation");
    assert!(count >= 10000);
    check("variation", support::VARIATION, count);
}

#[test]
fn repeated_calls_do_not_leak_parser_state() {
    let cases = support::fixtures(support::REGRESSION);
    for pass in 0..4 {
        for offset in 0..cases.len() {
            let i = if pass % 2 == 0 {
                offset
            } else {
                cases.len() - 1 - offset
            };
            let (expected, command) = &cases[i];
            assert_eq!(
                classify(command),
                *expected,
                "pass {pass}, case {i}, command {command:?}"
            );
            for (probe, result) in [
                ("pwd", 3),
                ("unknown_command_xyz", -1),
                ("true", 0),
                ("PATH=/tmp echo hello", 0),
                ("printf hello", 0),
            ] {
                assert_eq!(
                    classify(probe),
                    result,
                    "after {command:?}, probe {probe:?}"
                );
            }
        }
    }
}

#[test]
fn concurrent_calls_match_the_same_oracle() {
    let cases = support::fixtures(support::BENCHMARK);
    std::thread::scope(|scope| {
        for shift in 0..4 {
            let cases = &cases;
            scope.spawn(move || {
                for i in 0..cases.len() * 4 {
                    let (expected, source) = &cases[(i + shift) % cases.len()];
                    assert_eq!(classify(source), *expected, "parallel input {source:?}");
                }
            });
        }
    });
}
