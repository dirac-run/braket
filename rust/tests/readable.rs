use braket::{ReadableDecision, classify, classify_readable};
use std::collections::BTreeMap;
use std::io::Write;
use std::process::{Command, Output, Stdio};

#[test]
fn readable_api_distinguishes_effects_none_and_unknown() {
    for (source, effects) in [
        ("cat input", vec![("filesystem", "read")]),
        ("cat input > output", vec![("filesystem", "mutate")]),
        (
            "cat input; python -c \"pass\"",
            vec![("filesystem", "read"), ("execution", "use")],
        ),
        ("cat input; rm output", vec![("filesystem", "mutate")]),
        ("true", vec![]),
        ("", vec![]),
    ] {
        let result = classify_readable(source);
        assert_eq!(
            result,
            ReadableDecision::Capabilities(effects.into_iter().collect::<BTreeMap<_, _>>()),
            "{source}"
        );
    }
    for source in [
        "unknown_command_xyz",
        "cat input; unknown_command_xyz",
        "unknown_command_xyz; cat input",
        "cat input | unknown_command_xyz",
        "cat \"$(unknown_command_xyz)\"",
        "cat \"",
    ] {
        assert_eq!(
            classify_readable(source),
            ReadableDecision::Unknown,
            "{source}"
        );
        assert_eq!(classify_readable(source).to_json(), "\"unknown\"");
    }
    let ReadableDecision::Capabilities(mut result) = classify_readable("cat input") else {
        panic!("cat input should be known");
    };
    result.insert("filesystem", "mutate");
    assert_eq!(
        classify_readable("cat input"),
        ReadableDecision::Capabilities(BTreeMap::from([("filesystem", "read")]))
    );
    assert_eq!(classify("cat input"), 3);
    assert_eq!(
        classify_readable("cat input").to_json(),
        "{\"filesystem\":\"read\"}"
    );
    assert_eq!(classify_readable("true").to_json(), "{}");
    assert_eq!(
        classify_readable("unknown_command_xyz").to_json(),
        "\"unknown\""
    );
}

fn run(args: &[&str], input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_braket"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn cli_supports_integer_json_stdin_and_literal_arguments() {
    for source in [
        "cat input",
        "cat input > output",
        "true",
        "",
        "unknown_command_xyz",
        "cat \"",
        "cat \"é.txt\"; python -c \"pass\"",
        "cat input\ntrue",
        "--json",
    ] {
        for output in [run(&["--", source], ""), run(&[], source)] {
            assert!(output.status.success(), "{:?}", output.stderr);
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{}\n", classify(source))
            );
        }
        for output in [run(&["--json", "--", source], ""), run(&["--json"], source)] {
            assert!(output.status.success(), "{:?}", output.stderr);
            assert!(output.stderr.is_empty());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{}\n", classify_readable(source).to_json())
            );
        }
    }
    let help = run(&["--help"], "");
    assert!(help.status.success());
    assert!(
        String::from_utf8(help.stdout)
            .unwrap()
            .contains("Usage: braket")
    );
    for args in [vec!["--bad"], vec!["cat", "input"]] {
        let output = run(&args, "");
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .starts_with("braket:")
        );
    }
}

#[test]
fn cli_does_not_execute_shell_operations() {
    let marker = std::env::temp_dir().join(format!("braket-must-not-exist-{}", std::process::id()));
    assert!(!marker.exists());
    let source = format!("touch '{}'", marker.display());
    let output = run(&["--json", &source], "");
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "{\"filesystem\":\"mutate\"}\n"
    );
    assert!(!marker.exists());
}
