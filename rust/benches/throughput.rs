#[path = "../tests/support/mod.rs"]
mod support;
use braket::classify;
use std::{hint::black_box, time::Instant};

fn setting(name: &str, default: usize, minimum: usize) -> usize {
    let value = std::env::var(name)
        .map(|s| {
            s.parse::<usize>()
                .expect("positive integer benchmark setting")
        })
        .unwrap_or(default);
    assert!(value >= minimum, "{name} must be >= {minimum}");
    value
}

fn main() {
    let samples = setting("BENCH_SAMPLES", 7, 3);
    let iterations = setting("BENCH_ITERATIONS", 20000, 1);
    let mut checksum = 0i32;
    println!(
        "{{\"endpoint\":\"Rust public braket::classify(&str)\",\"samples\":{samples},\"iterationsPerSample\":{iterations},\"steadyState\":{{"
    );
    for (index, (name, inputs)) in support::throughput_workloads().into_iter().enumerate() {
        for i in 0..2000.max(iterations / 4) {
            checksum =
                checksum.wrapping_add(black_box(classify(black_box(&inputs[i % inputs.len()]))));
        }
        let mut timings = Vec::with_capacity(samples);
        for sample in 0..samples {
            let start = Instant::now();
            for i in 0..iterations {
                checksum = checksum.wrapping_add(black_box(classify(black_box(
                    &inputs[(i + sample) % inputs.len()],
                ))));
            }
            timings.push(start.elapsed().as_nanos() as f64 / iterations as f64);
        }
        let known = inputs.iter().filter(|s| classify(s) != -1).count();
        let positive = inputs.iter().filter(|s| classify(s) > 0).count();
        let zero = inputs.iter().filter(|s| classify(s) == 0).count();
        let chars = inputs
            .iter()
            .map(|s| s.encode_utf16().count())
            .sum::<usize>() as f64
            / inputs.len() as f64;
        let mut sorted = timings.clone();
        sorted.sort_by(f64::total_cmp);
        let median = sorted[(samples - 1) / 2];
        let p90 = sorted[((samples - 1) as f64 * 0.9).floor() as usize];
        if index != 0 {
            println!(",");
        }
        print!(
            "\"{name}\":{{\"inputs\":{},\"knownDecisionInputs\":{known},\"positiveDecisionInputs\":{positive},\"zeroEffectInputs\":{zero},\"unknownDecisionInputs\":{},\"averageInputCharacters\":{chars},\"iterationsPerSample\":{iterations},\"nsPerCall\":{{\"min\":{},\"median\":{median},\"p90\":{p90},\"max\":{}}},\"samplesNsPerCall\":{:?}}}",
            inputs.len(),
            inputs.len() - known,
            sorted[0],
            sorted[samples - 1],
            timings
        );
    }
    println!("}},\"checksum\":{}}}", black_box(checksum));
}
