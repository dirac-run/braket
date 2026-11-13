// Offline public-API differential endpoint: one UTF-8 hex command per line,
// one signed i32 decision per output line. No JSON parser or external runtime.
#[path = "../tests/support/mod.rs"]
mod support;
use std::io::{self, BufRead, Write};
fn main() -> io::Result<()> {
    let input = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in input.lock().lines() {
        let source = support::decode_hex(&line?)
            .map_err(|s| io::Error::new(io::ErrorKind::InvalidInput, s))?;
        writeln!(output, "{}", braket::classify(&source))?;
    }
    Ok(())
}
