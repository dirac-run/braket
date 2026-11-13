use std::io::{self, Read, Write};

const USAGE: &str = "Usage: braket [--json] [--] [COMMAND]\n\n\
Pass one quoted Bash command, or omit COMMAND to read all of stdin.\n\
Prints an integer by default; --json prints named capabilities.\n\
Input is classified without being executed.\n";

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut json = false;
    let mut options = true;
    let mut command = None;
    for arg in std::env::args().skip(1) {
        if options && arg == "--" {
            options = false;
        } else if options && arg == "--json" {
            json = true;
        } else if options && (arg == "--help" || arg == "-h") {
            print!("{USAGE}");
            return Ok(());
        } else if options && arg.starts_with('-') {
            return Err(format!("Unknown option: {arg}").into());
        } else if command.is_some() {
            return Err("Pass the command as one quoted argument.".into());
        } else {
            command = Some(arg);
        }
    }
    let source = match command {
        Some(command) => command,
        None => {
            let mut source = String::new();
            io::stdin().read_to_string(&mut source)?;
            source
        }
    };
    let mut output = io::stdout().lock();
    if json {
        writeln!(output, "{}", braket::classify_readable(&source).to_json())?;
    } else {
        writeln!(output, "{}", braket::classify(&source))?;
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("braket: {error}");
        std::process::exit(2);
    }
}
