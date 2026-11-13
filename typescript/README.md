# BraKet

Classify Bash command effects without executing them. Available as the
`braket-cli` npm package, with a library API and the `braket` executable.

Requires Node.js 24 or later. ESM. Zero runtime dependencies.

## Install

```sh
npm install -g braket-cli
```

For library use:

```sh
npm install braket-cli
```

## CLI

```text
braket [--json] [--] [COMMAND]
```

Pass a quoted command or read it from stdin:

```console
$ braket 'pwd'
3

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

## Library API

```js
import { classify, classifyReadable } from 'braket-cli';

const mask = classify('ls -la');           // 3
const effects = classifyReadable('rm report.txt'); // { filesystem: 'mutate' }
```

`classifyReadable()` returns a capability map with `"use"`, `"read"`, or `"mutate"`
values. The highest access level wins for each capability. An empty result is
`{}`. If any part of the input is unknown, the whole result is `"unknown"`.

`classify()` returns a branded number (`Decision`): `-1` for unknown input, `0`
for an empty result. Each capability occupies three bits: `0` absent, `1` use,
`3` read, `7` mutate. Field order, from the least significant bits:

```text
filesystem, network, processes, execution, credentials, software,
configuration, devices, remote_resources, system
```

For a known result, read field i with `(mask >>> (i * 3)) & 7`.

Exported types: `Decision`, `ReadableDecision`, `Capability`, and `AccessLevel`.
`ReadableDecision` is a capability map or `"unknown"`.

## Performance

Median time per direct integer API call:

| Workload | TypeScript / Node.js | Rust |
| --- | ---: | ---: |
| Single command | 1.936 µs | 0.550 µs |
| Compound input: 2–32 commands, averaging 10 | 11.659 µs | 2.474 µs |
| Long input: averaging about 18,000 characters | 126.080 µs | 13.057 µs |

AMD Ryzen 7 3800X, Linux x86-64, Node.js 24.11.0, Rust 1.98.1 (release).
Seven samples of 20,000 calls per workload, following 5,000 warmup calls.

From a source checkout in this directory:

```sh
npm ci
npm run build
BENCH_SAMPLES=7 BENCH_ITERATIONS=20000 node .build/bench/benchmark.js /tmp/braket-node-results.json
```

[Methodology and Rust benchmarks](https://github.com/dirac-run/braket/blob/main/docs/benchmarks.md)

## Classification rules

- Effects accumulate across pipelines, substitutions, redirections, and branches.
- Unsupported syntax, command identities, and option combinations return unknown.
- Execution includes selected programs and plugins, project scripts, tests, and
  package build backends. Ambient hooks and ordinary helpers are excluded.
- Filesystem writes cover explicit outputs. Temporary working files and compiler
  caches are excluded. Literal output redirection to `/dev/null` adds no effect.
- `find` actions such as `-delete` and `-fprint` contribute writes; `-exec` and
  related actions contribute execution.
- Sed programs carry possible file writes and execution. Sandbox/POSIX modes
  suppress execution.
- Imported command programs, including Curl configuration files, Nmap resume logs,
  and Redis operations, return unknown.
- Explicit PATH and dynamic-loader changes can make later command identities
  unknown. Array operands to `[[ -v ... ]]` and variable-dependent arithmetic
  also return unknown.

## Development

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run package:smoke
```

Run the local CLI with `node dist/cli.js`. Import the local library from
`./dist/index.js`. Builds use `data/classifier.bin`.

| Directory | Contents |
| --- | --- |
| `src/` | Classifier, CLI, binary loader |
| `data/` | Command data and build report |
| `build/` | Data compiler and correction rules |
| `test/` | Runtime and data tests |
| `bench/` | Benchmarks and measurements |
| `scripts/` | Build staging and package checks |
| `dist/` | Generated JavaScript and declarations |
| `.build/` | Generated tests and tooling |

### Packaging

`npm pack` includes compiled JavaScript, declarations, `data/classifier.bin`, this
README, and license files. Command data is loaded once at import.

### Command data

`classifier.bin` uses format UCAP0009 and contains 1,199,390 bytes. Command records
are 12 bytes; option bindings are 6 bytes. The build report records source hashes,
grammar profiles, and rating corrections. The TypeScript and Rust copies must match.

Data regeneration requires the frozen source corpus:

```sh
npm run data:rebuild -- --corpus-root /absolute/path/to/corpus-repository
CLASSIFIER_CORPUS_ROOT=/absolute/path/to/corpus-repository npm run test:integration
```

The compiler writes `data/classifier.bin` and `data/build-report.json`. Correction
rules are in `build/audited-corrections.ts`, `build/execution-policy.ts`, and
`build/utility-compatibility.ts`.

## License

[Apache-2.0](LICENSE). Unbash attribution: [NOTICE](NOTICE) and
[LICENSE.unbash](LICENSE.unbash).
