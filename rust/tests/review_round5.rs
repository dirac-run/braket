use braket::classify;

// Independent semantic requirements, not outputs copied from the TS oracle.
// These strings are never executed.
fn includes(command: &str, required: i32) {
    let actual = classify(command);
    assert_ne!(actual, -1, "{command}");
    assert_eq!(actual & required, required, "{command}: {actual}");
}

#[test]
fn explicit_providers_and_package_backends_have_execution() {
    for command in [
        "openssl s_client -connect example.com:443 -provider /tmp/provider.so",
        "openssl list -providers -provider /tmp/provider.so",
        "uv tool upgrade --all",
    ] {
        includes(command, 512);
    }
}

#[test]
fn package_flags_preserve_the_underlying_operations() {
    includes("npm rebuild --offline", 512 | 7);
    includes("npm outdated --json", 8 | (3 << 24));
    includes("npm init --yes", 7);
    includes("uv export --format requirements-txt", 512 | 7);
    includes(
        "pip config set global.index-url https://example.com/simple",
        7 | (7 << 18),
    );
    includes("wall input", 3 | (1 << 21));
}

#[test]
fn unsupported_delayed_expansion_and_loader_state_are_unknown() {
    for command in [
        "a=(zero); [[ -v 'a[$(touch /tmp/probe)]' ]]",
        "LD_AUDIT=/tmp/plugin.so cat file",
        "LD_DEBUG_OUTPUT=/tmp/trace LD_DEBUG=libs cat file",
    ] {
        assert_eq!(classify(command), -1, "{command}");
        assert_eq!(classify("cat file"), 3, "state leaked after {command}");
        assert_eq!(classify("true"), 0, "state leaked after {command}");
    }
}

#[test]
fn explicit_suppression_and_read_controls() {
    for command in ["git hash-object --no-filters file.txt"] {
        let actual = classify(command);
        assert_ne!(actual, -1, "{command}");
        assert_eq!(actual & (7 << 9), 0, "{command}");
    }
    for command in [
        "git hash-object --stdin",
        "git hash-object --stdin file.txt",
        "git hash-object --stdin --path=file.txt",
    ] {
        assert_eq!(classify(command), -1, "{command}");
    }
    for command in ["pip config get global.index-url", "pip config list"] {
        let actual = classify(command);
        assert_ne!(actual, -1, "{command}");
        assert_ne!(actual & 7, 7, "{command}");
        assert_ne!((actual >> 18) & 7, 7, "{command}");
    }
}
