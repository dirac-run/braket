use braket::classify;

#[test]
fn literal_null_output_sinks_add_no_capability() {
    for redirect in [
        ">/dev/null",
        "2>/dev/null",
        ">>/dev/null",
        "2>>/dev/null",
        ">|/dev/null",
        "&>/dev/null",
        "&>>/dev/null",
        ">&/dev/null",
        ">/dev/null 2>&1",
        "2>&1 >/dev/null",
        "<>/dev/null",
    ] {
        assert_eq!(classify(&format!("true {redirect}")), 0, "{redirect}");
        assert_eq!(classify(&format!("ls {redirect}")), 3, "{redirect}");
    }
    for path in [
        "'/dev/null'",
        "\"/dev/null\"",
        "/dev/\"null\"",
        "/dev/n\\ull",
        "/dev/nu\\\nll",
    ] {
        assert_eq!(classify(&format!("true >{path}")), 0, "{path}");
    }
}

#[test]
fn null_sinks_preserve_other_effects_and_do_not_guess_paths() {
    for (command, expected) in [
        ("rm file >/dev/null 2>&1", 7),
        ("python -c 'print(1)' >/dev/null", 512),
        ("ls 2>/dev/null >output", 7),
        ("true >output 2>/dev/null", 7),
        ("true >/dev/null <input", 3),
        ("true </dev/null", 3),
        ("X=\"$(rm file)\" true >/dev/null", 7),
        ("unknown_command_xyz >/dev/null", -1),
        ("true >/dev/null >", -1),
    ] {
        assert_eq!(classify(command), expected, "{command}");
    }
    for path in [
        "/dev/nullx",
        "/dev/null/file",
        "/dev/null/",
        "/dev/nu",
        "/dev/null.log",
        "/tmp/dev/null",
        "./dev/null",
        "/dev/./null",
    ] {
        assert_eq!(classify(&format!("true >{path}")), 7, "{path}");
    }
    for path in [
        "\"$DEST\"",
        "/dev/\"$NAME\"",
        "\"$(echo /dev/null)\"",
        "/dev/n*",
        "~/null",
    ] {
        assert_eq!(classify(&format!("true >{path}")), -1, "{path}");
    }
}
