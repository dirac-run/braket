# Benchmarks

Median direct `classify()` timings. Raw measurements:

- [TypeScript / Node.js](../typescript/bench/integer-api-results.json)
- [Rust](../rust/benches/integer-api-results.json)

## Workloads

| Workload | Inputs | Size or composition |
| --- | ---: | --- |
| Single command | 50 | One invocation; 16.76 characters on average |
| Compound input | 4 | 2–32 invocations; 10 on average |
| Long input | 4 | 17,926.5 characters on average |

Single-command inputs use indices 3–36, 50–64, and 67 from the 76-case reference
inventory. Compound inputs contain 3, 2, 3, and 32 named command invocations across
conditionals, substitutions, pipelines, and command lists. Long inputs cover
filenames, assignments, comments, and command arguments.

Workload definitions:
[TypeScript bench/cases.ts](../typescript/bench/cases.ts),
[Rust tests/support/mod.rs](../rust/tests/support/mod.rs).

## Measurement

AMD Ryzen 7 3800X, Linux x86-64, Node.js 24.11.0, Rust 1.98.1. Rust uses release
optimization, thin LTO, and one codegen unit. The implementations ran sequentially
on the same host.

Each workload has 5,000 warmup calls followed by seven samples of 20,000 calls:
420,000 timed calls per implementation. The table reports the median sample
average. Imports, initialization, JSON formatting, and output occur outside the
timed loop.

Reports contain `samplesNsPerCall` and `nsPerCall.median` in nanoseconds.
The Node.js report also includes cold-import and memory measurements.

## Reproduce

From the repository root:

```sh
npm --prefix typescript ci
npm --prefix typescript run build
BENCH_SAMPLES=7 BENCH_ITERATIONS=20000 node typescript/.build/bench/benchmark.js /tmp/braket-node-results.json
BENCH_SAMPLES=7 BENCH_ITERATIONS=20000 cargo bench --offline --locked --manifest-path rust/Cargo.toml --bench throughput > /tmp/braket-rust-results.json
```

Run the timing commands sequentially. Benchmark tooling is in the source checkout;
the Rust crate also includes its runner and fixtures.

Environment and data versions:

```sh
git rev-parse HEAD
node --version
rustc --version
sha256sum typescript/data/classifier.bin rust/data/classifier.bin
```

## Allocation probe

The Rust probe counts System allocator calls and requested live bytes over five
workloads, with 5,000 warmup calls and 20,000 measured calls each.
[The recorded run](../rust/benches/utility-compatibility-allocations.json)
contains 100,000 measured calls with zero allocations or reallocations.

```sh
cargo run --offline --locked --release --manifest-path rust/Cargo.toml --bin allocation-probe
```
