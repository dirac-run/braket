// Separate process, separate allocator: instrumentation never affects throughput.
#[path = "../tests/support/mod.rs"]
mod support;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering::Relaxed};

struct Counting;
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static REALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static DEALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static REQUESTED: AtomicU64 = AtomicU64::new(0);
static LIVE: AtomicI64 = AtomicI64::new(0);
static PEAK: AtomicI64 = AtomicI64::new(0);

fn add_live(bytes: i64) {
    let current = LIVE.fetch_add(bytes, Relaxed) + bytes;
    PEAK.fetch_max(current, Relaxed);
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            ALLOCATIONS.fetch_add(1, Relaxed);
            REQUESTED.fetch_add(layout.size() as u64, Relaxed);
            add_live(layout.size() as i64);
        }
        ptr
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if !ptr.is_null() {
            ALLOCATIONS.fetch_add(1, Relaxed);
            REQUESTED.fetch_add(layout.size() as u64, Relaxed);
            add_live(layout.size() as i64);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        DEALLOCATIONS.fetch_add(1, Relaxed);
        LIVE.fetch_sub(layout.size() as i64, Relaxed);
        unsafe { System.dealloc(ptr, layout) };
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(ptr, layout, new_size) };
        if !result.is_null() {
            REALLOCATIONS.fetch_add(1, Relaxed);
            REQUESTED.fetch_add(new_size as u64, Relaxed);
            add_live(new_size as i64 - layout.size() as i64);
        }
        result
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn main() {
    let iterations: usize = std::env::var("ALLOCATION_ITERATIONS")
        .map(|s| s.parse().expect("positive iteration count"))
        .unwrap_or(20000);
    assert!(iterations > 0);
    let mut workloads = support::workloads();
    workloads.push((
        "utility_compatibility",
        support::fixtures(include_str!("../tests/fixtures/utility-compatibility.tsv"))
            .into_iter()
            .map(|(_, command)| command)
            .collect(),
    ));
    // Initialize stdout buffering and fixtures before taking snapshots.
    println!(
        "{{\"method\":\"Separate process counting successful System allocator calls and requested sizes; fixture construction, stdout initialization and 5000 warmup calls per workload excluded. Live and peak bytes count allocator-requested bytes, not RSS or allocator bookkeeping.\",\"workloads\":{{"
    );
    let mut checksum = 0i32;
    for (index, (name, inputs)) in workloads.iter().enumerate() {
        for i in 0..5000 {
            checksum = checksum.wrapping_add(black_box(braket::classify(black_box(
                &inputs[i % inputs.len()],
            ))));
        }
        let allocations = ALLOCATIONS.load(Relaxed);
        let reallocations = REALLOCATIONS.load(Relaxed);
        let deallocations = DEALLOCATIONS.load(Relaxed);
        let requested = REQUESTED.load(Relaxed);
        let before_live = LIVE.load(Relaxed);
        PEAK.store(before_live, Relaxed);
        for i in 0..iterations {
            checksum = checksum.wrapping_add(black_box(braket::classify(black_box(
                &inputs[i % inputs.len()],
            ))));
        }
        let allocated = ALLOCATIONS.load(Relaxed) - allocations;
        let reallocated = REALLOCATIONS.load(Relaxed) - reallocations;
        let deallocated = DEALLOCATIONS.load(Relaxed) - deallocations;
        let bytes = REQUESTED.load(Relaxed) - requested;
        let retained = LIVE.load(Relaxed) - before_live;
        let peak = PEAK.load(Relaxed) - before_live;
        if index != 0 {
            println!(",");
        }
        print!(
            "\"{name}\":{{\"calls\":{iterations},\"allocations\":{allocated},\"reallocations\":{reallocated},\"deallocations\":{deallocated},\"requestedBytes\":{bytes},\"retainedBytesDelta\":{retained},\"peakLiveBytesAboveBaseline\":{peak}}}"
        );
    }
    println!("}},\"checksum\":{}}}", black_box(checksum));
}
