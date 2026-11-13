# BraKet

**Classify shell command effects in microseconds. TypeScript and Rust.**

BraKet analyzes Bash commands without executing them. It reports filesystem,
network, process, and other capabilities for use in coding-agent permissions.
The command data covers **906 root commands and 8,194 command paths**.

## Performance

Median time per direct integer API call:

| Workload | TypeScript / Node.js | Rust |
| --- | ---: | ---: |
| Single command | 1.936 µs | 0.550 µs |
| Compound input: 2–32 commands, averaging 10 | 11.659 µs | 2.474 µs |
| Long input: averaging about 18,000 characters | 126.080 µs | 13.057 µs |

AMD Ryzen 7 3800X, Linux x86-64, Node.js 24.11.0, Rust 1.98.1 (release).
Seven samples of 20,000 calls per workload, following 5,000 warmup calls.

[Reproduce the benchmarks](docs/benchmarks.md) ·
[Node.js results](typescript/bench/integer-api-results.json) ·
[Rust results](rust/benches/integer-api-results.json)

## Install

Node.js 24 or later:

```sh
npm install -g braket-cli
```

For library use:

```sh
npm install braket-cli
```

The Rust library can be added as a local Cargo dependency:

```toml
[dependencies]
braket = { path = "/path/to/BraKet/rust" }
```

## CLI

```text
braket [--json] [--] [COMMAND]
```

Pass a quoted command or read it from stdin:

```console
$ braket 'pwd'
3

$ braket --json 'pwd' 
{"filesystem":"read"}

$ printf '%s' 'rg -n "TODO" src/ | head -20' | braket --json
{"filesystem":"read"}

$ braket --json "find . -name '*.log' -delete"
{"filesystem":"mutate"}

$ braket --json 'ps'
{"processes":"read"}

$ braket --json 'curl -o result.json https://example.com/data'
{"filesystem":"mutate","network":"use","remote_resources":"read"}

$ braket --json 'npm install'
{"filesystem":"mutate","network":"use","execution":"use","software":"mutate","remote_resources":"read"}

$ braket --json 'git config --global user.name'
{"configuration":"read"}

$ braket --json 'kubectl get pods'
{"network":"use","remote_resources":"read"}

$ braket --json 'zip backup.zip notes.txt'
{"filesystem":"mutate"}

$ braket --json 'python -c "print(1)"'
{"execution":"use"}

$ braket --json 'gpg --list-keys'
{"credentials":"read"}

$ braket --json 'lsblk'
{"devices":"read"}

$ braket --json 'uname -a'
{"system":"read"}

$ braket --json 'true'
{}

$ braket --json 'du -sh src/; unknown_command_xyz'
"unknown"
```

Results exit with status 0. Usage and I/O errors exit with status 2.

From a local checkout, use `node typescript/dist/cli.js` or
`rust/target/debug/braket` after building the respective implementation.

## Library API

```js
import { classify, classifyReadable } from 'braket-cli';

const mask = classify('ls -la');           // 3
const effects = classifyReadable('rm report.txt'); // { filesystem: 'mutate' }
```

```rust
use braket::{classify, classify_readable};

let mask = classify("df -h"); // 3
println!("{}", classify_readable("chmod 644 report.txt").to_json());
// {"filesystem":"mutate"}
```

Readable results use `"use"`, `"read"`, and `"mutate"`. The highest access level wins
for each capability. An empty result is `{}`. If any part of the input is unknown,
the whole result is `"unknown"`.

Rust returns `ReadableDecision::Capabilities(map)` or `ReadableDecision::Unknown`;
`to_json()` serializes either result.

### Integer format

`classify()` returns `-1` for unknown input and `0` for an empty result. Each
capability occupies three bits: `0` absent, `1` use, `3` read, `7` mutate.

| Capability | Bit offset |
| --- | ---: |
| `filesystem` | 0 |
| `network` | 3 |
| `processes` | 6 |
| `execution` | 9 |
| `credentials` | 12 |
| `software` | 15 |
| `configuration` | 18 |
| `devices` | 21 |
| `remote_resources` | 24 |
| `system` | 27 |

```js
if (mask !== -1) {
  const filesystem = mask & 7;
  const network = (mask >>> 3) & 7;
}
```

## Classification rules

Effects accumulate across pipelines, substitutions, redirections, and branches.
Unsupported syntax and unresolved command or option combinations return unknown.

`execution` covers selected programs, plugins, project scripts, tests, and package
build backends. Ambient hooks and ordinary helpers are excluded. Filesystem
mutation covers output files and explicit writes; temporary working files and
compiler caches are excluded. Literal output redirection to `/dev/null` adds no
effect.

[TypeScript reference](typescript/README.md) · [Rust reference](rust/README.md)

## Why this exists

To alleviate coding agent permission fatigue.

[Dirac](https://github.com/dirac-run/dirac) originally used a primitive static allowlist of safe commands, which was neither safe nor comprehensive. I kept thinking it would be neat to give permissions like “filesystem read” or “network use.”

To do that, you need a Bash parser to accurately identify the commands and flags. I initially tried Tree-sitter and [mvdan/sh](https://github.com/mvdan/sh). Both were functional, but took more time and resources than I could justify for a high-volume command evaluator.

Then I looked for a parser I could customize and repurpose specifically for this use case. I found [Unbash](https://github.com/webpro-nl/unbash), tested it, and it worked well. So I used it as the starting point for a parser dedicated to classifying command effects.

It worked so well that I decided to create a Rust implementation too.

## Development

```sh
# TypeScript
cd typescript
npm ci
npm run typecheck
npm test
npm run package:smoke

# Rust
cd ../rust
cargo test --offline --locked
cargo test --offline --locked --release
cargo build --offline --locked --release --bin classify-batch

# Shared reference fixtures
cd ..
python3 scripts/verify-parity.py
```

Validation includes 217 TypeScript tests, Rust debug and release tests, and
36,953 shared reference inputs. Builds use the checked-in command data.

## License and acknowledgment

[Apache-2.0](LICENSE). Shell recognition derives from
[Unbash](https://github.com/webpro-nl/unbash) by Lars Kappert and contributors.
Its ISC license is preserved in [LICENSE.unbash](LICENSE.unbash), with attribution
in [NOTICE](NOTICE).
