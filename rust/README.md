# BraKet — Rust

Classify Bash command effects without executing them. Standard library only;
command data is embedded in the compiled library.

## Use

```toml
[dependencies]
braket = { path = "/path/to/BraKet/rust" }
```

```rust
use braket::{classify, classify_readable};

let mask = classify("df -h"); // 3
println!("{}", classify_readable("chmod 644 report.txt").to_json());
// {"filesystem":"mutate"}
```

`classify(&str) -> i32` returns `-1` for unknown input and `0` for an empty result.
Each capability occupies three bits: `0` absent, `1` use, `3` read, `7` mutate.
Field order, from the least significant bits:

```text
filesystem, network, processes, execution, credentials, software,
configuration, devices, remote_resources, system
```

`classify_readable(&str)` returns `ReadableDecision::Capabilities(map)` or
`ReadableDecision::Unknown`. The map is a `BTreeMap<&'static str, &'static str>`
with `"use"`, `"read"`, and `"mutate"` values. `to_json()` serializes the result.
An empty result is `{}`. If any part of the input is unknown, the whole result
is `"unknown"`.

Calls are thread-safe. Each thread reuses parser scratch storage.

## CLI

```sh
cargo build --offline --locked --bin braket
```

```text
braket [--json] [--] [COMMAND]
```

Pass a quoted command or read it from stdin:

```console
$ target/debug/braket 'pwd'
3

$ printf '%s' 'rg -n "TODO" src/ | head -20' | target/debug/braket --json
{"filesystem":"read"}

$ target/debug/braket --json "find . -name '*.log' -delete"
{"filesystem":"mutate"}

$ target/debug/braket --json 'ps'
{"processes":"read"}

$ target/debug/braket --json 'curl -o result.json https://example.com/data'
{"filesystem":"mutate","network":"use","remote_resources":"read"}

$ target/debug/braket --json 'npm install'
{"execution":"use","filesystem":"mutate","network":"use","remote_resources":"read","software":"mutate"}

$ target/debug/braket --json 'git config --global user.name'
{"configuration":"read"}

$ target/debug/braket --json 'kubectl get pods'
{"network":"use","remote_resources":"read"}

$ target/debug/braket --json 'zip backup.zip notes.txt'
{"filesystem":"mutate"}

$ target/debug/braket --json 'python -c "print(1)"'
{"execution":"use"}

$ target/debug/braket --json 'gpg --list-keys'
{"credentials":"read"}

$ target/debug/braket --json 'lsblk'
{"devices":"read"}

$ target/debug/braket --json 'uname -a'
{"system":"read"}

$ target/debug/braket --json 'true'
{}

$ target/debug/braket --json 'du -sh src/; unknown_command_xyz'
"unknown"
```

Results exit with status 0. Usage and I/O errors exit with status 2.

## Performance

Median time per direct integer API call:

| Workload | TypeScript / Node.js | Rust |
| --- | ---: | ---: |
| Single command | 1.936 µs | 0.550 µs |
| Compound input: 2–32 commands, averaging 10 | 11.659 µs | 2.474 µs |
| Long input: averaging about 18,000 characters | 126.080 µs | 13.057 µs |

AMD Ryzen 7 3800X, Linux x86-64, Node.js 24.11.0, Rust 1.98.1 (release).
Seven samples of 20,000 calls per workload, following 5,000 warmup calls.

```sh
BENCH_SAMPLES=7 BENCH_ITERATIONS=20000 cargo bench --offline --locked --bench throughput > /tmp/braket-rust-results.json
```

[Methodology and Node.js benchmarks](https://github.com/dirac-run/braket/blob/main/docs/benchmarks.md)

## Build and test

```sh
cargo build --offline --locked --release --lib
cargo test --offline --locked
cargo test --offline --locked --release
cargo run --offline --locked --release --bin allocation-probe
```

Tests cover 36,953 reference inputs, repeated calls, and concurrent calls.
`tools/classify_batch.rs` accepts one UTF-8 hex command per line and prints its
integer classification. `tools/check_oracle.py` compares those results with the
fixtures.

## Implementation

The parser scans borrowed source spans. Command and option lookups use compressed
tries over embedded UCAP0009 data. The library validates the data once.
`data/build-report.json` records source hashes and corrections.

Effects accumulate across pipelines, substitutions, redirections, and branches.
Unsupported syntax, command identities, and option combinations return unknown.
Execution includes selected programs and plugins, project scripts, tests, and
package build backends. Ambient hooks and ordinary helpers are excluded.
Filesystem writes cover explicit outputs; temporary working files and compiler
caches are excluded. Literal output redirection to `/dev/null` adds no effect.
Recursive syntax and parameter expansion have a depth limit of 256.

The TypeScript implementation's
[classification rules](https://github.com/dirac-run/braket/blob/main/typescript/README.md#classification-rules)
apply to both libraries.

| Directory | Contents |
| --- | --- |
| `src/` | Classifier and CLI |
| `data/` | Embedded command data and build report |
| `tests/` | Fixtures and regression tests |
| `benches/` | Throughput benchmark and measurements |
| `tools/` | Batch comparison, fixture capture, allocation probe |

## License

[Apache-2.0](LICENSE). Unbash attribution: [NOTICE](NOTICE) and
[LICENSE.unbash](LICENSE.unbash).
