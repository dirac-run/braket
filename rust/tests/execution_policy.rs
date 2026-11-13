use braket::classify;

#[test]
fn ambient_hooks_and_helpers_do_not_grant_execution() {
    for command in [
        "git status",
        "git status -sb",
        "git diff",
        "git log -p",
        "git hash-object file",
        "man ls",
    ] {
        assert_eq!(classify(command), 3, "{command}");
    }
    for command in [
        "git commit -m message",
        "git checkout main",
        "git status >output",
        "git hash-object -w --no-filters file",
    ] {
        assert_eq!(classify(command), 7, "{command}");
    }
    assert_eq!(classify("systemctl daemon-reload"), 940310528);
    assert_eq!(classify("pip config edit"), 1835015);
    assert_eq!(classify("rsync --daemon"), 15);
}

#[test]
fn explicit_programs_and_project_code_keep_execution() {
    for command in [
        "python -c 'print(1)'",
        "git hook run pre-commit",
        "git -p hook run pre-commit",
        "git rebase --exec helper",
        "man -P helper ls",
        "pip config edit --editor helper",
        "make",
        "make -n",
        "pytest",
        "npm test",
        "npm install",
        "npm pack",
        "uv lock",
        "cargo check",
        "openssl list -provider legacy",
    ] {
        let value = classify(command);
        assert_ne!(value, -1, "{command}");
        assert_eq!(value & 3584, 512, "{command}");
    }
    assert_eq!(classify("git status; python -c 'print(1)'"), 515);
}

#[test]
fn unresolved_explicit_overrides_do_not_silently_drop_execution() {
    for command in [
        "man -c -P helper ls",
        "man -P helper -c ls",
        "pip config --editor helper edit",
        "git hash-object --stdin",
        "git hash-object --stdin --no-filters",
        "git status; unknown_command_xyz",
    ] {
        assert_eq!(classify(command), -1, "{command}");
    }
}
